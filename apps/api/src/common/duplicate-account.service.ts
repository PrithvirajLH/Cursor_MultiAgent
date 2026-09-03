import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  assessProbableDuplicate,
  type DuplicateCandidate,
} from './duplicate-account.util';

/** The audit row type an operator filters on to see how often this happens. */
export const PROBABLE_DUPLICATE_ACCOUNT_EVENT = 'PROBABLE_DUPLICATE_ACCOUNT';

const SEPARATORS = ['_', '.', '-'];

/**
 * Notices when a newly provisioned address looks like a human we already have
 * (card 1.30).
 *
 * One human becomes two accounts because all three provisioning paths — login
 * (`auth.guard`), inbound email and the intake endpoint — take whatever address
 * arrives and match it as an exact string. In production the same person is
 * `phulgur@csnhc.com` as AGENT and `prithviraj_hulgur@csnhc.com` as EMPLOYEE,
 * and which of the two a ticket lands on decides who can see it: card 1.36's
 * rules all key off `requesterId`, which is one of those rows and not the other.
 *
 * This only ever REPORTS. It never merges and never blocks: see
 * `assessProbableDuplicate` for why merging cannot be automatic, and `flag()`
 * for why it cannot be allowed to fail.
 */
@Injectable()
export class DuplicateAccountService {
  private readonly logger = new Logger(DuplicateAccountService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Record that this address may be a second account for an existing human.
   *
   * NEVER THROWS, and never returns anything the caller must act on. Refusing
   * to provision would drop an inbound email or reject an intake form, and a
   * lost message is a worse failure than a duplicate row — so every error in
   * here is swallowed after being logged. Call it after the user is created.
   */
  async flag(email: string, role: string): Promise<void> {
    try {
      const candidates = await this.findCandidates(email);
      if (candidates.length === 0) return;
      const assessment = assessProbableDuplicate(email, candidates);
      if (assessment.verdict === 'none') return;

      const others = assessment.matches
        .map((match) => `${match.email} (${match.role})`)
        .join(', ');
      // Both addresses and both roles, because the roles are the part that
      // decides who can see what and the part a human needs to choose between.
      this.logger.warn(
        assessment.verdict === 'ambiguous'
          ? `Address ${email} (${role}) abbreviates to ${assessment.key}, which more than one existing account could also abbreviate to: ${others}. NOT a duplicate to act on - two different people can share a short form. Left alone.`
          : `Address ${email} (${role}) looks like a second account for an existing human: ${others}. Provisioned anyway. Merge with merge-duplicate-user.mjs only after confirming they are the same person.`,
      );

      await this.prisma.adminAuditEvent.create({
        data: {
          type: PROBABLE_DUPLICATE_ACCOUNT_EVENT,
          payload: {
            verdict: assessment.verdict,
            key: assessment.key,
            provisioned: { email, role },
            existing: assessment.matches.map((match) => ({
              id: match.id,
              email: match.email,
              role: match.role,
            })),
          },
          // No createdById: nobody did this on purpose, and the address that
          // triggered it is in the payload. actorEmail keeps it searchable.
          actorEmail: email,
        },
      });
    } catch (error) {
      this.logger.error(
        `Failed to record a probable duplicate for ${email}`,
        (error as Error).stack,
      );
    }
  }

  /**
   * The few rows worth comparing against, rather than the whole User table.
   *
   * Two directions, because either address can arrive first: the abbreviation
   * of a long form is an exact lookup, while finding the long forms behind an
   * abbreviation needs a suffix match on the surname. The suffix queries are
   * also what surfaces a SECOND long form — `john_smith@` when `jane_smith@` is
   * being created — which is exactly the case that must come back ambiguous.
   */
  private async findCandidates(email: string): Promise<DuplicateCandidate[]> {
    const at = email.trim().toLowerCase().lastIndexOf('@');
    if (at <= 0) return [];
    const local = email.trim().toLowerCase().slice(0, at);
    const domain = email.trim().toLowerCase().slice(at + 1);
    if (domain === '') return [];

    const parts = local.split(/[._-]+/).filter((part) => part !== '');
    const surname =
      parts.length >= 2 ? parts[parts.length - 1] : local.slice(1);
    if (surname.length < 2) return [];
    const initial = parts.length >= 2 ? parts[0][0] : local[0];

    const where = {
      email: {
        in: [`${initial}${surname}@${domain}`],
      },
    };
    const suffixes = SEPARATORS.map(
      (separator) => `${separator}${surname}@${domain}`,
    );
    const rows = await this.prisma.user.findMany({
      where: {
        OR: [
          where,
          ...suffixes.map((suffix) => ({ email: { endsWith: suffix } })),
        ],
      },
      select: { id: true, email: true, role: true },
      // A sane ceiling: a surname shared by dozens of people is not a signal,
      // and this runs on every login.
      take: 20,
    });
    return rows.map((row) => ({
      id: row.id,
      email: row.email,
      role: String(row.role),
    }));
  }
}
