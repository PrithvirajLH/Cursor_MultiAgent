import { activeAnnouncementWhere } from './active-announcement-where.util';

const NOW = new Date('2026-09-14T12:00:00.000Z');

describe('activeAnnouncementWhere (card 2.7)', () => {
  it('⚠️ a viewer in no team gets NO team clause at all', () => {
    // Not "a team clause matching nothing" - an empty `in: []` is the kind of
    // thing a later refactor turns into `in: undefined`, which matches
    // EVERYTHING and quietly hands every team's announcements to a requester.
    const where = activeAnnouncementWhere(NOW, []);
    const audience = (where.AND as Record<string, unknown>[])[2].OR as Record<
      string,
      unknown
    >[];
    expect(audience).toEqual([{ audience: 'ALL' }]);
  });

  it('⚠️ a viewer in teams gets ALL plus exactly those teams', () => {
    const where = activeAnnouncementWhere(NOW, ['team-a', 'team-b']);
    const audience = (where.AND as Record<string, unknown>[])[2].OR as Record<
      string,
      unknown
    >[];
    expect(audience).toEqual([
      { audience: 'ALL' },
      { audience: 'TEAM', teamId: { in: ['team-a', 'team-b'] } },
    ]);
  });

  it('bounds the window at both ends, and treats a null end as open', () => {
    const where = activeAnnouncementWhere(NOW, []);
    const clauses = where.AND as Record<string, unknown>[];
    expect(clauses[0]).toEqual({ startsAt: { lte: NOW } });
    expect(clauses[1]).toEqual({
      OR: [{ endsAt: null }, { endsAt: { gt: NOW } }],
    });
  });

  it('⚠️ takes the time as an argument rather than reading the clock itself', () => {
    // So the caller decides whose clock this is - the server's. A function that
    // called new Date() internally could not be tested for the boundary, and
    // the browser's clock must never reach this decision.
    const earlier = activeAnnouncementWhere(new Date('2020-01-01'), []);
    expect((earlier.AND as Record<string, unknown>[])[0]).toEqual({
      startsAt: { lte: new Date('2020-01-01') },
    });
  });
});
