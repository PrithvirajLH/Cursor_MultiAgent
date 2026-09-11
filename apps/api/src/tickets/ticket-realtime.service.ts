import { Injectable, Logger } from '@nestjs/common';
import { MessageType, Prisma, TeamRole, UserRole } from '@prisma/client';
import type { AuthUser } from '../auth/current-user.decorator';
import { AccessControlService } from '../common/access-control.service';
import { stripQuotedReply } from '../notifications/quoted-reply.util';
import { PrismaService } from '../prisma/prisma.service';
import {
  RealtimeService,
  type TicketChangedPayload,
} from '../realtime/realtime.service';

export type TicketRealtimeReason =
  | 'ticket_created'
  | 'message_added'
  | 'assigned'
  | 'transferred'
  | 'status_changed'
  | 'priority_changed'
  | 'category_changed'
  | 'followers_changed'
  // A link to another ticket was added or removed (card 1.6). Emitted on BOTH
  // tickets, because a link is visible from either end.
  | 'links_changed'
  | 'attachment_added'
  | 'attachment_scan_status_changed'
  | 'automation_rule_executed'
  | 'deleted'
  | 'restored'
  | 'edited'
  // The SLA worker changed this ticket's breach or at-risk state. The payload
  // carries no SLA fields, so the web re-reads the row - see card 1.27.
  | 'sla_changed';

type TicketRealtimeAudienceTicket = {
  id: string;
  requesterId: string;
  assigneeId: string | null;
  assignedTeamId: string | null;
  followers: Array<{ userId: string }>;
  accessGrants: Array<{ teamId: string }>;
};

type RealtimeAudienceCandidateUser = {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
  primaryTeamId: string | null;
  teamMemberships: Array<{
    teamId: string;
    role: TeamRole;
    createdAt: Date;
    team: {
      name: string;
    };
  }>;
};

@Injectable()
export class TicketRealtimeService {
  private readonly logger = new Logger(TicketRealtimeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
    private readonly accessControl: AccessControlService,
  ) {}

  async safeRealtime(task: () => Promise<void>) {
    try {
      await task();
    } catch (error) {
      this.logger.error(
        `Realtime publish failed: ${(error as Error).message}`,
        (error as Error).stack,
      );
    }
  }

  async emitTicketRealtimeEvent(params: {
    ticketId: string;
    reason: TicketRealtimeReason;
    actorId: string | null;
    extraTeamIds?: Array<string | null | undefined>;
    extraUserIds?: Array<string | null | undefined>;
    message?: TicketChangedPayload['message'];
  }) {
    if (!this.realtime.isEnabled()) {
      return;
    }

    const ticket = await this.prisma.ticket.findUnique({
      where: { id: params.ticketId },
      select: {
        id: true,
        status: true,
        priority: true,
        updatedAt: true,
        assignedTeamId: true,
        assignedTeam: {
          select: {
            id: true,
            name: true,
          },
        },
        requesterId: true,
        assigneeId: true,
        assignee: {
          select: {
            id: true,
            email: true,
            displayName: true,
          },
        },
        followers: {
          select: {
            userId: true,
          },
        },
        accessGrants: {
          select: {
            teamId: true,
          },
        },
      },
    });

    if (!ticket) {
      return;
    }

    const actor =
      params.actorId == null
        ? null
        : await this.prisma.user.findUnique({
            where: { id: params.actorId },
            select: {
              id: true,
              email: true,
              displayName: true,
            },
          });

    const userIds = await this.resolveAuthorizedUserIds(ticket, {
      actorId: params.actorId,
      extraTeamIds: params.extraTeamIds,
      extraUserIds: params.extraUserIds,
    });

    await this.realtime.publishTicketChanged(
      {
        ticketId: ticket.id,
        reason: params.reason,
        actorId: params.actorId,
        status: ticket.status,
        priority: ticket.priority,
        updatedAt: ticket.updatedAt.toISOString(),
        assignedTeamId: ticket.assignedTeamId,
        assignedTeam: ticket.assignedTeam,
        assigneeId: ticket.assigneeId,
        assignee: ticket.assignee,
        followerCount: ticket.followers.length,
        actor,
        message: params.message,
      },
      { userIds },
    );
  }

  toRealtimeMessagePayload(message: {
    id: string;
    body: string;
    type: MessageType;
    createdAt: Date;
    author: {
      id: string;
      email: string;
      displayName: string;
    };
  }): NonNullable<TicketChangedPayload['message']> {
    return {
      id: message.id,
      // ⚠️ CARD 1.75. THE SECOND READ PATH, AND IT MUST TRIM LIKE THE FIRST.
      //
      // Card 1.62 wired `stripQuotedReply` into `listMessages`, describing it as
      // "the single message-read path". It is not. This socket push is the other
      // one, and it was left raw - so a reply arrived on an OPEN ticket carrying
      // the entire quoted thread, both signatures, our own pilot-mode notice and
      // the tenant's confidentiality footer, and then silently corrected itself
      // on the next page load. Observed in production 2026-09-11 on
      // PA_20260910_381: 1655 characters pushed where 192 were fetched.
      //
      // Whoever has the ticket OPEN sees the ugly copy; whoever opens it later
      // sees the clean one. Two places that must agree - the same shape as cards
      // 1.36, 1.38, 1.47, 1.50, 1.61 and 1.70.
      //
      // ⚠️ Display only, exactly as on the fetch path: this transforms what is
      // SENT to a viewer, never what is stored. `TicketMessage.body` keeps the
      // whole thing, so nothing an audit needs is lost.
      body: stripQuotedReply(message.body),
      type: message.type,
      createdAt: message.createdAt.toISOString(),
      author: {
        id: message.author.id,
        email: message.author.email,
        displayName: message.author.displayName,
      },
    };
  }

  async publishAutomationRealtimeUpdate(
    ticketId: string,
    actorId: string | null,
  ) {
    await this.safeRealtime(() =>
      this.emitTicketRealtimeEvent({
        ticketId,
        reason: 'automation_rule_executed',
        actorId,
      }),
    );
  }

  async publishTicketTypingForTicket(params: {
    ticket: TicketRealtimeAudienceTicket;
    actor: Pick<AuthUser, 'id' | 'email' | 'displayName'>;
    isTyping: boolean;
    extraTeamIds?: Array<string | null | undefined>;
    extraUserIds?: Array<string | null | undefined>;
  }) {
    if (!this.realtime.isEnabled()) {
      return;
    }

    const userIds = await this.resolveAuthorizedUserIds(params.ticket, {
      actorId: params.actor.id,
      extraTeamIds: params.extraTeamIds,
      extraUserIds: params.extraUserIds,
    });

    await this.realtime.publishTicketTyping(
      {
        ticketId: params.ticket.id,
        actorId: params.actor.id,
        actorDisplayName: params.actor.displayName,
        actorEmail: params.actor.email,
        isTyping: params.isTyping,
      },
      { userIds },
    );
  }

  isEnabled() {
    return this.realtime.isEnabled();
  }

  /**
   * Announce that somebody has a ticket open (card 1.9).
   *
   * The audience is resolveAuthorizedUserIds, exactly as for typing. That is a
   * security boundary rather than a convenience: it is the same set of people
   * who may open the ticket.
   */
  async publishTicketViewingForTicket(params: {
    ticket: TicketRealtimeAudienceTicket;
    actor: Pick<AuthUser, 'id' | 'email' | 'displayName'>;
    isViewing: boolean;
  }) {
    if (!this.realtime.isEnabled()) {
      return;
    }

    const userIds = await this.resolveAuthorizedUserIds(params.ticket, {
      actorId: params.actor.id,
    });

    await this.realtime.publishTicketViewing(
      {
        ticketId: params.ticket.id,
        actorId: params.actor.id,
        actorDisplayName: params.actor.displayName,
        actorEmail: params.actor.email,
        isViewing: params.isViewing,
      },
      { userIds },
    );
  }

  private async resolveAuthorizedUserIds(
    ticket: TicketRealtimeAudienceTicket,
    params: {
      actorId?: string | null;
      extraTeamIds?: Array<string | null | undefined>;
      extraUserIds?: Array<string | null | undefined>;
    },
  ) {
    const candidateTeamIds = this.uniqueIds([
      ticket.assignedTeamId,
      ...ticket.accessGrants.map((grant) => grant.teamId),
      ...(params.extraTeamIds ?? []),
    ]);
    const directUserIds = this.uniqueIds([
      ticket.requesterId,
      ticket.assigneeId,
      params.actorId,
      ...ticket.followers.map((follower) => follower.userId),
      ...(params.extraUserIds ?? []),
    ]);

    const candidateFilters: Prisma.UserWhereInput[] = [];

    if (directUserIds.length > 0) {
      candidateFilters.push({ id: { in: directUserIds } });
    }
    if (candidateTeamIds.length > 0) {
      candidateFilters.push({ primaryTeamId: { in: candidateTeamIds } });
      candidateFilters.push({
        teamMemberships: {
          some: {
            teamId: { in: candidateTeamIds },
          },
        },
      });
    }

    if (candidateFilters.length === 0) {
      return [] as string[];
    }

    const candidateUsers = await this.prisma.user.findMany({
      where: { OR: candidateFilters },
      select: {
        id: true,
        email: true,
        displayName: true,
        role: true,
        primaryTeamId: true,
        teamMemberships: {
          orderBy: { createdAt: 'asc' },
          select: {
            teamId: true,
            role: true,
            createdAt: true,
            team: {
              select: {
                name: true,
              },
            },
          },
        },
      },
    });

    return candidateUsers
      .filter((candidate) =>
        this.accessControl.canViewTicket(this.toAuthUser(candidate), ticket),
      )
      .map((candidate) => candidate.id);
  }

  private toAuthUser(candidate: RealtimeAudienceCandidateUser): AuthUser {
    const preferredTeamRole = this.preferredTeamRole(candidate.role);
    let membership =
      candidate.primaryTeamId == null
        ? null
        : (candidate.teamMemberships.find(
            (item) => item.teamId === candidate.primaryTeamId,
          ) ?? null);

    if (!membership && preferredTeamRole) {
      membership =
        candidate.teamMemberships.find(
          (item) => item.role === preferredTeamRole,
        ) ?? null;
    }

    if (!membership) {
      membership = candidate.teamMemberships[0] ?? null;
    }

    return {
      id: candidate.id,
      email: candidate.email,
      displayName: candidate.displayName,
      role: candidate.role,
      teamId: membership?.teamId ?? candidate.primaryTeamId ?? null,
      teamName: membership?.team.name ?? null,
      teamRole: membership?.role ?? null,
      primaryTeamId: candidate.primaryTeamId ?? null,
    };
  }

  private preferredTeamRole(role: UserRole) {
    switch (role) {
      case UserRole.LEAD:
        return TeamRole.LEAD;
      case UserRole.AGENT:
        return TeamRole.AGENT;
      case UserRole.TEAM_ADMIN:
        return TeamRole.ADMIN;
      default:
        return null;
    }
  }

  private uniqueIds(values: Array<string | null | undefined>) {
    return [
      ...new Set(
        values.filter((value): value is string => Boolean(value?.trim())),
      ),
    ];
  }
}
