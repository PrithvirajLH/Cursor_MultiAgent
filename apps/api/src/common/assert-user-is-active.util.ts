import { BadRequestException } from '@nestjs/common';

/**
 * Refuse a deactivated account, wherever it is being given something.
 *
 * ⚠️ ONE RULE, TWO CALLERS, AND THE SECOND ONE IS WHY THIS FILE EXISTS.
 * Card 1.89 wrote this at `addMember`, because a deactivated person could be
 * put straight back onto a team. Card 1.110 found the identical question
 * UNANSWERED one method over at `applyAssigneeInTx`: no assignment path checked
 * `isActive` at all, with or without a team. The same question answered in one
 * place and not the other is the recurring failure of this project in its
 * plainest form, so the answer now lives in exactly one file.
 *
 * `action` completes the sentence, so each caller says what was actually being
 * attempted rather than sharing one vague message.
 *
 * ⚠️ Kept as a LEAF: it imports one Nest exception and nothing else. Card
 * 1.103 spent a batch breaking a cycle that began with a helper reaching into a
 * feature module.
 */
export function assertUserIsActive(
  user: { displayName: string | null; email: string; isActive: boolean },
  action: string,
): void {
  if (user.isActive) {
    return;
  }
  throw new BadRequestException(
    `${user.displayName || user.email} is deactivated. Reactivate the account before ${action}.`,
  );
}
