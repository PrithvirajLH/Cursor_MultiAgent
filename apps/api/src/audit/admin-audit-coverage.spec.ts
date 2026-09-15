import { readFileSync } from 'fs';
import { join } from 'path';
import { AdminAuditService } from './admin-audit.service';
import type { AuthUser } from '../auth/current-user.decorator';
import type { PrismaService } from '../prisma/prisma.service';

const ACTOR = {
  id: 'owner-1',
  email: 'owner@company.com',
  displayName: 'Olive Owner',
} as AuthUser;

const SRC = join(__dirname, '..');

/**
 * Card 1.95 — most admin changes left no trace.
 *
 * `AdminAuditEvent` already existed and six services wrote it. Five wrote
 * nothing at all: teams, routing, slas, kb and tags. So a team could be created,
 * an SLA policy rewritten or a tag merged away, and the audit log would show
 * silence.
 *
 * ⚠️ ONE ASSERTION PER NEWLY-AUDITED AREA, as the card asks, so the five are
 * visible in the suite rather than only in a report.
 */
describe('the five silent services now write the audit trail (card 1.95)', () => {
  const areas = [
    ['teams', 'teams/teams.service.ts'],
    ['routing rules', 'routing/routing.service.ts'],
    ['SLA policies', 'slas/slas.service.ts'],
    ['knowledge base', 'kb/kb.service.ts'],
    ['tags', 'tags/tags.service.ts'],
  ] as const;

  for (const [area, file] of areas) {
    it(`${area} record admin changes`, () => {
      const source = readFileSync(join(SRC, file), 'utf8');
      expect(source).toContain('adminAudit.record');
    });
  }

  it('⚠️ all five go through the ONE helper, not five implementations', () => {
    // The card's explicit requirement. A service writing `adminAuditEvent`
    // directly would shape its payload differently and make the trail
    // unqueryable - which is how it got into this state.
    for (const [, file] of areas) {
      const source = readFileSync(join(SRC, file), 'utf8');
      expect(source).not.toContain('adminAuditEvent.create');
    }
  });
});

describe('an audit row is never written for a change that failed (card 1.95)', () => {
  const prismaOk = {
    adminAuditEvent: { create: jest.fn().mockResolvedValue({}) },
  } as unknown as PrismaService;

  beforeEach(() => jest.clearAllMocks());

  it('records what it was given, with the actor snapshot', () => {
    const service = new AdminAuditService(prismaOk);
    return service
      .record({ type: 'TEAM_CREATED', actor: ACTOR, payload: { entityId: 't1' } })
      .then(() => {
        const call = (
          prismaOk.adminAuditEvent.create as unknown as jest.Mock
        ).mock.calls[0][0];
        expect(call.data).toMatchObject({
          type: 'TEAM_CREATED',
          createdById: 'owner-1',
          actorEmail: 'owner@company.com',
          // Snapshots, so attribution survives the account being deleted.
          actorName: 'Olive Owner',
        });
      });
  });

  it('⚠️ outside a transaction a failed write is logged, not thrown', async () => {
    // Deliberate and uncomfortable: failing closed is stronger for a healthcare
    // audit trail, but `AdminAuditEvent` is not guaranteed to exist - two
    // services carry a runtime information_schema check for it - and throwing
    // would turn a missing table into "no admin can change anything".
    const prismaBad = {
      adminAuditEvent: {
        create: jest.fn().mockRejectedValue(new Error('relation does not exist')),
      },
    } as unknown as PrismaService;
    const service = new AdminAuditService(prismaBad);
    await expect(
      service.record({ type: 'TEAM_CREATED', actor: ACTOR, payload: {} }),
    ).resolves.toBeUndefined();
  });

  it('⚠️ INSIDE a transaction a failed write rethrows, so the change rolls back', async () => {
    // The other half, and the one that matters for a destructive change: tag
    // merge writes its audit row inside the transaction precisely so that
    // losing the record loses the merge too.
    const tx = {
      adminAuditEvent: {
        create: jest.fn().mockRejectedValue(new Error('write failed')),
      },
    };
    const service = new AdminAuditService(prismaOk);
    await expect(
      service.record(
        { type: 'TAG_MERGED', actor: ACTOR, payload: {} },
        tx as never,
      ),
    ).rejects.toThrow('write failed');
  });

  it('⚠️ tag merge takes the transactional path', () => {
    // A merge destroys tags; afterwards there is no evidence of what was
    // merged. If this ever stops passing `tx`, the audit row becomes optional
    // for the one operation that most needs it.
    const source = readFileSync(join(SRC, 'tags/tags.service.ts'), 'utf8');
    const merge = source.slice(source.indexOf('async merge('));
    expect(merge).toContain("type: 'TAG_MERGED'");
    expect(merge).toMatch(/\},\s*tx,\s*\);/);
  });
});
