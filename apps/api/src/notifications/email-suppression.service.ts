import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/** How the address failed. Plain strings, matching CustomField.fieldType's style. */
export type EmailSuppressionKind = 'HARD' | 'SOFT';

/**
 * Soft failures needed before an address stops receiving mail.
 *
 * A full mailbox or a greylisting is temporary, and suppressing on the first one
 * would lose real mail from someone who is simply away. Five in a row is a
 * pattern rather than an accident.
 */
const SOFT_FAILURE_LIMIT = 5;

@Injectable()
export class EmailSuppressionService {
  private readonly logger = new Logger(EmailSuppressionService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Addresses are compared lowercased; SMTP local parts are case-sensitive in theory and never in practice. */
  private normalize(address: string): string {
    return address.trim().toLowerCase();
  }

  /**
   * Is this address currently refused?
   *
   * A HARD failure counts from the first one. A SOFT one only once it has
   * happened SOFT_FAILURE_LIMIT times.
   */
  async isSuppressed(address: string): Promise<boolean> {
    const record = await this.prisma.emailSuppression.findUnique({
      where: { address: this.normalize(address) },
    });
    if (record === null) {
      return false;
    }
    return (
      record.kind === 'HARD' || record.failureCount >= SOFT_FAILURE_LIMIT
    );
  }

  /** Every currently refused address, worst first. For the owner-facing list. */
  async listSuppressed(): Promise<
    Array<{
      address: string;
      kind: string;
      failureCount: number;
      lastReason: string | null;
      firstSeenAt: Date;
      lastSeenAt: Date;
    }>
  > {
    const records = await this.prisma.emailSuppression.findMany({
      orderBy: [{ kind: 'asc' }, { lastSeenAt: 'desc' }],
      select: {
        address: true,
        kind: true,
        failureCount: true,
        lastReason: true,
        firstSeenAt: true,
        lastSeenAt: true,
      },
    });
    return records;
  }

  /**
   * Record one delivery failure.
   *
   * A HARD failure overwrites a SOFT one - a mailbox that has started rejecting
   * outright is no longer merely full - but never the other way round, so a
   * single soft failure after a hard one cannot quietly un-suppress an address.
   */
  async recordFailure(
    address: string,
    kind: EmailSuppressionKind,
    reason: string,
  ): Promise<void> {
    const normalized = this.normalize(address);
    const now = new Date();
    try {
      const existing = await this.prisma.emailSuppression.findUnique({
        where: { address: normalized },
      });
      if (existing === null) {
        await this.prisma.emailSuppression.create({
          data: {
            address: normalized,
            kind,
            failureCount: 1,
            lastReason: reason,
            firstSeenAt: now,
            lastSeenAt: now,
          },
        });
        return;
      }
      await this.prisma.emailSuppression.update({
        where: { address: normalized },
        data: {
          kind: existing.kind === 'HARD' ? 'HARD' : kind,
          failureCount: existing.failureCount + 1,
          lastReason: reason,
          lastSeenAt: now,
        },
      });
    } catch (error) {
      // Never let bookkeeping fail a send path. The address simply is not
      // suppressed yet, which is the same position we were in before 1.23.
      this.logger.error(
        'Failed to record an email suppression',
        (error as Error).stack,
      );
    }
  }

  /**
   * Let an address receive mail again.
   *
   * Someone whose mailbox was full for a week must not be permanently
   * unreachable with no way back, so this deletes the row outright rather than
   * zeroing a counter: a fresh failure should start from scratch.
   */
  async clear(address: string): Promise<boolean> {
    const normalized = this.normalize(address);
    const deleted = await this.prisma.emailSuppression.deleteMany({
      where: { address: normalized },
    });
    return deleted.count > 0;
  }
}
