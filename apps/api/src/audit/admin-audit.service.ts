import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthUser } from '../auth/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Writes the admin audit trail (card 1.95).
 *
 * ⚠️ ONE HELPER, CALLED FROM FIVE PLACES — not five implementations. Six
 * services already wrote `AdminAuditEvent` directly and each shaped its payload
 * a little differently; adding five more copies of that is how a trail becomes
 * unqueryable. Everything new goes through here.
 *
 * ⚠️ CALL IT **AFTER** THE CHANGE HAS SUCCEEDED, or inside the same transaction
 * by passing `tx`. An audit row written first says a thing happened that may
 * then fail, which is worse than no row at all: the trail is only worth having
 * if it cannot claim something that did not occur.
 */
@Injectable()
export class AdminAuditService {
  private readonly logger = new Logger(AdminAuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Record one administrative change.
   *
   * ⚠️ A FAILED WRITE IS LOGGED AT ERROR AND DOES NOT BREAK THE ADMIN ACTION,
   * and that is a deliberate, uncomfortable choice worth stating. Failing closed
   * — refusing the change when the trail cannot be written — is the stronger
   * position for a healthcare audit trail. It is not taken here because
   * `AdminAuditEvent` is not guaranteed to exist: `audit.service.ts` and
   * `automation.service.ts` both carry a runtime `information_schema` check for
   * it, which means an environment has been seen without the table. Throwing
   * would turn a missing table into "no admin can change anything".
   *
   * So the gap is made LOUD rather than silent — and the existing writers that
   * swallow quietly are reported as a finding rather than changed here.
   */
  async record(
    input: {
      /** SCREAMING_SNAKE, matching the convention of the existing writers. */
      type: string;
      actor: AuthUser;
      payload: Record<string, unknown>;
      /** The team the change belongs to, when it belongs to one. */
      teamId?: string | null;
    },
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const client = tx ?? this.prisma;
    try {
      await client.adminAuditEvent.create({
        data: {
          type: input.type,
          payload: input.payload as Prisma.InputJsonValue,
          createdById: input.actor.id,
          // Snapshot fields: the model keeps these so attribution survives the
          // user or team being deleted. Filling only createdById would lose the
          // name the moment the account goes.
          actorEmail: input.actor.email,
          actorName: input.actor.displayName ?? null,
          teamId: input.teamId ?? null,
        },
      });
    } catch (error) {
      // ⚠️ Inside a caller's transaction this rethrows by design: the caller
      // chose atomicity, so a failed audit row must roll the change back with
      // it. Outside one, the change has already committed and there is nothing
      // left to undo.
      this.logger.error(
        `Failed to write admin audit event ${input.type} for ${input.actor.email}: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
      if (tx) {
        throw error;
      }
    }
  }
}
