import { Reflector } from '@nestjs/core';
import type { ConfigService } from '@nestjs/config';
import { UserRole } from '@prisma/client';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { AdminAuditService } from '../audit/admin-audit.service';
import type { ApiKeysService } from '../api-keys/api-keys.service';
import { AuthGuard } from './auth.guard';
import type { DuplicateAccountService } from '../common/duplicate-account.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { UserIdentityService } from '../common/user-identity.service';

const BOOTSTRAP = 'founder@example.com';

/**
 * Card 1.113 — a bootstrap owner could not be demoted, and the list was cached.
 *
 * ⚠️ ON EVERY LOGIN, an address in `AUTH_BOOTSTRAP_OWNER_EMAILS` had
 * `updateData.role = UserRole.OWNER` applied unconditionally. So an admin who
 * demoted that person saw it succeed, and their next sign-in silently put them
 * back. The demotion was audited; the re-promotion was not.
 *
 * ⚠️ AND THE SET WAS MEMOISED FOR THE LIFE OF THE PROCESS, so removing
 * somebody from the variable needed an App Service restart to take effect —
 * card 1.104's bug in a different file three days later.
 *
 * ⚠️ MEASURED: THE VARIABLE IS NOT SET IN PRODUCTION, so none of this could
 * happen today. It was a trap armed for whoever set it, most likely during a
 * disaster — the worst moment to discover a role cannot be taken back.
 */
describe('bootstrap owner promotion (card 1.113)', () => {
  const build = (options: {
    bootstrapEmails: string;
    activeOwners: number;
    role?: UserRole;
  }) => {
    const update = jest.fn().mockImplementation(({ data }) =>
      Promise.resolve({ id: 'u1', email: BOOTSTRAP, ...data }),
    );
    const record = jest.fn().mockResolvedValue(undefined);
    let bootstrapEmails = options.bootstrapEmails;
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'u1',
          email: BOOTSTRAP,
          displayName: 'Founder',
          role: options.role ?? UserRole.AGENT,
          department: null,
          location: null,
          isActive: true,
        }),
        update,
        count: jest.fn().mockImplementation(() =>
          Promise.resolve(options.activeOwners),
        ),
        create: jest.fn(),
        findFirst: jest.fn().mockResolvedValue(null),
      },
    } as unknown as PrismaService;
    const guard = new AuthGuard(
      prisma,
      new Reflector(),
      {
        get: (key: string) =>
          key === 'AUTH_BOOTSTRAP_OWNER_EMAILS' ? bootstrapEmails : undefined,
      } as unknown as ConfigService,
      { flag: jest.fn() } as unknown as DuplicateAccountService,
      { recordAddresses: jest.fn() } as unknown as UserIdentityService,
      { resolve: jest.fn() } as unknown as ApiKeysService,
      { record } as unknown as AdminAuditService,
    );
    const setBootstrapEmails = (value: string) => {
      bootstrapEmails = value;
    };
    return { guard, update, record, setBootstrapEmails };
  };

  /** The private method under test; reaching it through a full login needs a token. */
  const promote = (guard: AuthGuard, email: string) =>
    (
      guard as unknown as {
        shouldPromoteBootstrapOwner(email: string): Promise<boolean>;
      }
    ).shouldPromoteBootstrapOwner(email);

  it('⚠️ a demoted bootstrap address STAYS demoted while an owner exists', async () => {
    // THE REGRESSION ASSERTION. This returned "promote" unconditionally before
    // the card, so the demotion was undone at the next sign-in.
    const { guard } = build({ bootstrapEmails: BOOTSTRAP, activeOwners: 3 });
    await expect(promote(guard, BOOTSTRAP)).resolves.toBe(false);
  });

  it('⚠️ but it IS promoted when no owner is left', async () => {
    // NON-VACUITY, and the reason the enforcement was gated rather than
    // deleted: recovering from "every owner is gone" is what bootstrap is FOR,
    // and that recovery usually names an address that ALREADY EXISTS as an
    // ordinary user - so provisioning alone would not have covered it.
    const { guard } = build({ bootstrapEmails: BOOTSTRAP, activeOwners: 0 });
    await expect(promote(guard, BOOTSTRAP)).resolves.toBe(true);
  });

  it('an address not in the list is never promoted, owners or not', async () => {
    const { guard } = build({ bootstrapEmails: BOOTSTRAP, activeOwners: 0 });
    await expect(promote(guard, 'someone.else@example.com')).resolves.toBe(false);
  });

  it('⚠️ a change to the variable takes effect without a restart', async () => {
    // The memo made this impossible: the set was computed once per process, so
    // removing somebody needed an App Service restart - and the thing that
    // would not take effect was the REMOVAL of an owner.
    const { guard, setBootstrapEmails } = build({
      bootstrapEmails: BOOTSTRAP,
      activeOwners: 0,
    });
    await expect(promote(guard, BOOTSTRAP)).resolves.toBe(true);
    setBootstrapEmails('');
    await expect(promote(guard, BOOTSTRAP)).resolves.toBe(false);
  });

  it('⚠️ the memoised field is gone from the source, not just unused', () => {
    // Card 1.104's shape. A field left in place is a field somebody re-wires.
    const source = readFileSync(join(__dirname, 'auth.guard.ts'), 'utf8');
    expect(source).not.toContain('private bootstrapOwnerEmails');
    expect(source).not.toContain('this.bootstrapOwnerEmails');
  });

  it('⚠️ the promotion is audited', () => {
    // A role change with no record is exactly what this card is about: the
    // demotion was always audited and the re-promotion never was, so the log
    // showed a role removed and never restored.
    const source = readFileSync(join(__dirname, 'auth.guard.ts'), 'utf8');
    expect(source).toContain('BOOTSTRAP_OWNER_PROMOTED');
    expect(source).toContain('this.adminAudit.record');
  });

  it('⚠️ provisioning a brand-new bootstrap address is untouched', () => {
    // The card says keep the provisioning half. It reads `shouldBootstrapOwner`
    // directly and is not behind the new gate, so a first owner on an empty
    // system still works.
    const source = readFileSync(join(__dirname, 'auth.guard.ts'), 'utf8');
    expect(source).toContain('const provisionedRole = shouldBootstrapOwner');
  });
});
