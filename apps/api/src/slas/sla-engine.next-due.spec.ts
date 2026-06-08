import { SlaEngineService } from './sla-engine.service';

/**
 * Unit tests for SlaEngineService.computeNextDueAt — the pure logic that picks
 * which deadline is "next" for a ticket (first-response vs resolution), honoring
 * pause and already-breached state. No DB: prisma dep is unused by this method.
 */

const FR_DUE = new Date('2026-01-01T10:00:00.000Z'); // first-response deadline
const RES_DUE = new Date('2026-01-02T10:00:00.000Z'); // resolution deadline

type TicketArg = {
  firstResponseAt: Date | null;
  completedAt: Date | null;
  firstResponseDueAt: Date | null;
  dueAt: Date | null;
  slaPausedAt: Date | null;
};

type InstanceArg = {
  firstResponseBreachedAt: Date | null;
  resolutionBreachedAt: Date | null;
} | null;

function nextDueAt(
  svc: SlaEngineService,
  ticket: TicketArg,
  instance: InstanceArg,
): Date | null {
  return (
    svc as unknown as {
      computeNextDueAt: (t: TicketArg, i: InstanceArg) => Date | null;
    }
  ).computeNextDueAt(ticket, instance);
}

function ticket(overrides: Partial<TicketArg> = {}): TicketArg {
  return {
    firstResponseAt: null,
    completedAt: null,
    firstResponseDueAt: FR_DUE,
    dueAt: RES_DUE,
    slaPausedAt: null,
    ...overrides,
  };
}

describe('SlaEngineService.computeNextDueAt', () => {
  let svc: SlaEngineService;
  beforeEach(() => {
    svc = new SlaEngineService({} as never);
  });

  it('returns null when the SLA is paused', () => {
    expect(
      nextDueAt(svc, ticket({ slaPausedAt: new Date() }), null),
    ).toBeNull();
  });

  it('returns the first-response deadline while first response is pending', () => {
    expect(nextDueAt(svc, ticket(), null)).toEqual(FR_DUE);
  });

  it('moves to the resolution deadline once first response is given', () => {
    expect(
      nextDueAt(svc, ticket({ firstResponseAt: new Date() }), null),
    ).toEqual(RES_DUE);
  });

  it('skips a breached first response and points at the resolution deadline', () => {
    expect(
      nextDueAt(svc, ticket(), {
        firstResponseBreachedAt: new Date(),
        resolutionBreachedAt: null,
      }),
    ).toEqual(RES_DUE);
  });

  it('falls through to resolution when there is no first-response deadline', () => {
    expect(
      nextDueAt(svc, ticket({ firstResponseDueAt: null }), null),
    ).toEqual(RES_DUE);
  });

  it('returns null when the ticket is completed', () => {
    expect(
      nextDueAt(
        svc,
        ticket({ firstResponseAt: new Date(), completedAt: new Date() }),
        null,
      ),
    ).toBeNull();
  });

  it('returns null when resolution is already breached', () => {
    expect(
      nextDueAt(svc, ticket({ firstResponseAt: new Date() }), {
        firstResponseBreachedAt: null,
        resolutionBreachedAt: new Date(),
      }),
    ).toBeNull();
  });

  it('returns null when first response is done and there is no resolution deadline', () => {
    expect(
      nextDueAt(
        svc,
        ticket({ firstResponseAt: new Date(), dueAt: null }),
        null,
      ),
    ).toBeNull();
  });
});
