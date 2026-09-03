import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/** Where an alternate address came from. Kept so a bad mapping can be traced back. */
export type AliasSource = 'preferred_username' | 'upn' | 'email';

/** One address the directory handed us, with the claim it arrived on. */
export type DirectoryAddress = {
  email: string;
  source: AliasSource;
};

/**
 * The addresses a human answers to, as the directory reports them (card 1.30,
 * PREVENT).
 *
 * The duplicate this card exists for was not made by a login. Entra gives the
 * owner `userPrincipalName = phulgur@csnhc.com` and `mail =
 * Prithviraj_Hulgur@csnhc.com`, and the login resolves the UPN — so it lands on
 * the right row every time. The twin came from intake or inbound email, which
 * see the `mail` form on a sent message or a form response and have no way to
 * know it is the same person.
 *
 * The token already carries both forms and the app was throwing them away.
 * Recording them at login gives the other two paths the mapping, for anyone who
 * has ever signed in.
 *
 * NOTHING HERE COMPARES THE SHAPE OF TWO ADDRESSES. Every mapping in this
 * service was handed to us by the directory. Guessing that one address
 * abbreviates another is DuplicateAccountService's job, it is for raising
 * suspicion only, and it must never be used to resolve a requester.
 */
@Injectable()
export class UserIdentityService {
  private readonly logger = new Logger(UserIdentityService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Remember the addresses a token presented for this human.
   *
   * NEVER THROWS. This runs on the login path, and a login must not fail
   * because we could not write a convenience mapping.
   *
   * An address already claimed by a DIFFERENT user is left alone rather than
   * stolen: the unique constraint on `UserEmailAlias.email` is what keeps
   * resolution unambiguous, so a conflict is a fact to log, not to resolve.
   */
  async recordAddresses(
    userId: string,
    addresses: DirectoryAddress[],
  ): Promise<void> {
    const seen = new Set<string>();
    const wanted: DirectoryAddress[] = [];
    for (const address of addresses) {
      const email = address.email.trim().toLowerCase();
      if (email === '' || !email.includes('@') || seen.has(email)) continue;
      seen.add(email);
      wanted.push({ email, source: address.source });
    }
    if (wanted.length === 0) return;

    try {
      const existing = await this.prisma.userEmailAlias.findMany({
        where: { email: { in: wanted.map((a) => a.email) } },
        select: { email: true, userId: true },
      });
      const owner = new Map(existing.map((row) => [row.email, row.userId]));
      for (const address of wanted) {
        const claimedBy = owner.get(address.email);
        if (claimedBy === userId) continue;
        if (claimedBy !== undefined) {
          this.logger.warn(
            `Address ${address.email} is already recorded against a different user (${claimedBy}); leaving it alone rather than reassigning it.`,
          );
          continue;
        }
        await this.prisma.userEmailAlias
          .create({
            data: { userId, email: address.email, source: address.source },
          })
          .catch((error) => {
            // A concurrent login can win the race for the same address. That is
            // the constraint doing its job, not an error worth surfacing.
            this.logger.debug(
              `Could not record alias ${address.email}: ${(error as Error).message}`,
            );
          });
      }
    } catch (error) {
      this.logger.error(
        `Failed to record directory addresses for ${userId}`,
        (error as Error).stack,
      );
    }
  }

  /**
   * The user who owns this address, by a mapping the directory gave us.
   *
   * Returns null rather than throwing, and null simply means "not recognised" —
   * the caller then provisions as it always has. Resolution must never be able
   * to block provisioning: refusing would drop an inbound email or reject an
   * intake form, which is worse than a duplicate row.
   */
  async findUserIdByAlias(email: string): Promise<string | null> {
    const normalized = email.trim().toLowerCase();
    if (normalized === '') return null;
    try {
      const alias = await this.prisma.userEmailAlias.findUnique({
        where: { email: normalized },
        select: { userId: true },
      });
      return alias?.userId ?? null;
    } catch (error) {
      this.logger.error(
        `Alias lookup failed for ${normalized}; treating it as unrecognised`,
        (error as Error).stack,
      );
      return null;
    }
  }
}
