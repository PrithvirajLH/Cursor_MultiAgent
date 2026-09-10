import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TicketStatus, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AccessControlService } from '../common/access-control.service';
import { EmailQueueService } from './email-queue.service';
import { OutboxService } from './outbox.service';
import { buildLeadDigestEmail } from './lead-digest-email.util';

/** How often the timer fires when the switch is on. Once a morning. */
const DEFAULT_INTERVAL_MS = 24 * 60 * 60 * 1000;
/** Statuses that mean nobody needs to act. */
const CLOSED_STATUSES = [TicketStatus.RESOLVED, TicketStatus.CLOSED];
/** A due date inside this window counts as "at risk" rather than breached. */
const AT_RISK_WINDOW_MS = 60 * 60 * 1000;
/** Never put more than this many tickets in one section of the email. */
const MAX_ROWS_PER_SECTION = 20;

/** One lead's worth of digest content, independent of how it is delivered. */
export type LeadDigest = {
  leadId: string;
  leadEmail: string;
  leadName: string;
  breached: DigestTicket[];
  atRisk: DigestTicket[];
  unassigned: DigestTicket[];
};

export type DigestTicket = {
  id: string;
  /** Nullable in the schema: a very old row may predate display ids. */
  displayId: string | null;
  subject: string;
  dueAt: Date | null;
};

/** What one pass did, for the operations console. */
export type LeadDigestRunSummary = {
  ranAt: string;
  leadsConsidered: number;
  digestsQueued: number;
  leadsWithNothingToSay: number;
  enabled: boolean;
};

/**
 * One email per lead per morning: what breached, what is at risk, what is
 * unassigned on their team (card 1.16).
 *
 * ⚠️ THIS SITS AGAINST CARD 1.42, WHICH REMOVED STAFF EMAIL ENTIRELY -
 * *"agents, leads and owners get no email at all; they work on the platform."*
 * A digest emailed to a lead is staff email, so the exception is deliberate:
 * 1.42 was aimed at PER-TICKET noise, an email per message and per status
 * change, and one scheduled summary is a different animal.
 *
 * ✅ **DECIDED BY THE OWNER, 2026-09-10: keep the email digest.** An in-app
 * digest on the operations console was offered as the alternative and was not
 * taken. Do not reopen this - it is a settled product decision, not an
 * oversight, and the argument has already been had in both directions.
 *
 * The switch stays OFF by default regardless. That is now a deployment
 * question rather than a design one: production has no SMTP configured at all
 * (`docs/azure-env-inventory.md`), so enabling it before that is resolved
 * would queue mail that cannot leave.
 *
 * ⚠️ **It does not touch 1.42's staff exclusion.** `notifications.service.ts`
 * filters staff out of per-ticket recipients and is untouched: this is a wholly
 * separate send path with its own event type. Nothing here can leak a per-ticket
 * email back to an agent.
 *
 * ⚠️ **The CONTENT is computed separately from the DELIVERY**, deliberately.
 * `collectDigests()` returns data and sends nothing, so a second surface would
 * be a new reader rather than a rewrite. Worth keeping even now the email is
 * settled: it is what makes the three sections below reusable.
 *
 * 📝 **KNOWN FOLLOW-UP, deferred on purpose (owner, 2026-09-10).** Those three
 * sections - breached, at risk, unassigned - are a SECOND definition of "what
 * needs attention"; the sidebar counts are the first. Two definitions of one
 * rule is the drift behind cards 1.36, 1.38, 1.47, 1.50 and 1.55, so this
 * should eventually read from the same helpers the sidebar uses. Not urgent
 * while the switch is off and nothing consumes it. **If you are about to turn
 * this on for real, do that first** - the moment leads act on these numbers,
 * two definitions that disagree become a support question.
 *
 * Scope comes from `AccessControlService.operationalTeamIds`, the one
 * chokepoint, rather than a second definition of "my team". Card 1.55 is the
 * live reminder of what happens when that function is second-guessed.
 */
@Injectable()
export class LeadDigestService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LeadDigestService.name);
  private timer: NodeJS.Timeout | null = null;
  private lastRunAt: string | null = null;
  private lastSummary: LeadDigestRunSummary | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly outbox: OutboxService,
    private readonly emailQueue: EmailQueueService,
    private readonly accessControl: AccessControlService,
  ) {}

  /** Whether the digest is switched on. `LEAD_DIGEST_ENABLED`, off by default. */
  isEnabled(): boolean {
    return this.config.get<string>('LEAD_DIGEST_ENABLED') === 'true';
  }

  /** Interval between automatic runs, for the operations console. */
  getIntervalMs(): number {
    const raw = this.config.get<string>('LEAD_DIGEST_INTERVAL_MS');
    const parsed = Number.parseInt(raw ?? '', 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_INTERVAL_MS;
  }

  /** Last-run state for the operations console. In memory only. */
  getLastRun(): { at: string | null; summary: LeadDigestRunSummary | null } {
    return { at: this.lastRunAt, summary: this.lastSummary };
  }

  onModuleInit(): void {
    if (!this.isEnabled()) {
      this.logger.log(
        'Lead daily digest disabled (LEAD_DIGEST_ENABLED is not true)',
      );
      return;
    }
    const intervalMs = this.getIntervalMs();
    this.logger.log(`Lead daily digest enabled (every ${intervalMs} ms)`);
    this.timer = setInterval(() => {
      this.runOnce().catch((error) => {
        this.logger.error('Lead digest run failed', (error as Error).stack);
      });
    }, intervalMs);
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Build every lead's digest and queue the ones with something in them.
   *
   * ⚠️ **A lead with nothing to report gets NO EMAIL AT ALL** - not an empty
   * one. An empty digest every morning is precisely the fatigue card 1.42
   * removed, and the fastest way to have the whole feature switched off.
   *
   * Safe to call when disabled: it reports `enabled: false` and queues nothing,
   * so the operations console's Run now button cannot send mail behind the
   * switch's back.
   */
  async runOnce(): Promise<LeadDigestRunSummary> {
    const enabled = this.isEnabled();
    const digests = enabled ? await this.collectDigests() : [];
    let queued = 0;
    for (const digest of digests) {
      if (!this.hasContent(digest)) {
        continue;
      }
      const email = buildLeadDigestEmail(digest);
      const row = await this.outbox.createEmail({
        toEmail: digest.leadEmail,
        toUserId: digest.leadId,
        // ⚠️ No ticketId: a digest is about many tickets, and pinning it to one
        // would put it in that ticket's email thread.
        ticketId: null,
        subject: email.subject,
        body: email.text,
        // ⚠️ `eventType` is a plain String column, NOT the NotificationType
        // enum - so this fifth kind of mail needs no migration and no enum
        // value. The enum governs in-app Notification rows, which a digest
        // does not create.
        eventType: 'LEAD_DAILY_DIGEST',
        emailContent: { html: email.html },
      });
      await this.emailQueue.enqueue(row.id);
      queued += 1;
    }
    const summary: LeadDigestRunSummary = {
      ranAt: new Date().toISOString(),
      leadsConsidered: digests.length,
      digestsQueued: queued,
      leadsWithNothingToSay: digests.length - queued,
      enabled,
    };
    this.lastRunAt = summary.ranAt;
    this.lastSummary = summary;
    this.logger.log(JSON.stringify(summary));
    return summary;
  }

  /**
   * The content, for every lead, with nothing sent.
   *
   * Public so a future in-app digest can read exactly what the email reads.
   */
  async collectDigests(): Promise<LeadDigest[]> {
    const leads = await this.prisma.user.findMany({
      where: { role: UserRole.LEAD, isActive: true },
      select: {
        id: true,
        email: true,
        displayName: true,
        role: true,
        primaryTeamId: true,
        teamMemberships: { select: { teamId: true } },
      },
    });
    const digests: LeadDigest[] = [];
    for (const lead of leads) {
      // ⚠️ Through the access-control chokepoint, not a second definition of
      // "my team". `operationalTeamIds` prefers roster rows and falls back to
      // the session team - see card 1.55 for why that fallback is deliberate.
      const teamIds = this.accessControl.operationalTeamIds({
        id: lead.id,
        email: lead.email,
        displayName: lead.displayName,
        role: lead.role,
        teamId: lead.primaryTeamId,
        primaryTeamId: lead.primaryTeamId,
        memberTeamIds: lead.teamMemberships.map((row) => row.teamId),
      });
      if (teamIds.length === 0) {
        continue;
      }
      digests.push({
        leadId: lead.id,
        leadEmail: lead.email,
        leadName: lead.displayName,
        ...(await this.collectForTeams(teamIds)),
      });
    }
    return digests;
  }

  /** The three sections, for one set of teams. */
  private async collectForTeams(teamIds: string[]): Promise<{
    breached: DigestTicket[];
    atRisk: DigestTicket[];
    unassigned: DigestTicket[];
  }> {
    const now = new Date();
    const open = {
      deletedAt: null,
      assignedTeamId: { in: teamIds },
      status: { notIn: CLOSED_STATUSES },
    };
    const select = {
      id: true,
      displayId: true,
      subject: true,
      dueAt: true,
    };
    const [breached, atRisk, unassigned] = await Promise.all([
      this.prisma.ticket.findMany({
        where: { ...open, dueAt: { lt: now } },
        select,
        orderBy: { dueAt: 'asc' },
        take: MAX_ROWS_PER_SECTION,
      }),
      this.prisma.ticket.findMany({
        where: {
          ...open,
          dueAt: { gte: now, lte: new Date(now.getTime() + AT_RISK_WINDOW_MS) },
        },
        select,
        orderBy: { dueAt: 'asc' },
        take: MAX_ROWS_PER_SECTION,
      }),
      this.prisma.ticket.findMany({
        where: { ...open, assigneeId: null },
        select,
        orderBy: { createdAt: 'asc' },
        take: MAX_ROWS_PER_SECTION,
      }),
    ]);
    return { breached, atRisk, unassigned };
  }

  /** Is there anything worth an email? */
  private hasContent(digest: LeadDigest): boolean {
    return (
      digest.breached.length > 0 ||
      digest.atRisk.length > 0 ||
      digest.unassigned.length > 0
    );
  }
}
