import { UserRole } from '@prisma/client';
import type { AuthUser } from '../auth/current-user.decorator';
import { AccessControlService } from './access-control.service';

/**
 * Unit tests for the ticket access-control matrix. Pure logic, no DB.
 * Covers the role x action grid (OWNER / TEAM_ADMIN / LEAD / AGENT / EMPLOYEE)
 * for view, write, peer-agent, post-message — plus the raw-SQL alias guard.
 */

function user(partial: Partial<AuthUser> & { role: UserRole }): AuthUser {
  return {
    id: 'u1',
    email: 'u@example.com',
    displayName: 'U',
    ...partial,
  } as AuthUser;
}

const owner = () => user({ id: 'owner', role: UserRole.OWNER });
const teamAdmin = (primaryTeamId: string | null, id = 'ta') =>
  user({ id, role: UserRole.TEAM_ADMIN, primaryTeamId });
const lead = (memberTeamIds: string[], id = 'lead') =>
  user({ id, role: UserRole.LEAD, memberTeamIds });
const agent = (memberTeamIds: string[], id = 'agent') =>
  user({ id, role: UserRole.AGENT, memberTeamIds });
const employee = (id = 'emp') => user({ id, role: UserRole.EMPLOYEE });

type TicketShape = {
  requesterId: string;
  assignedTeamId: string | null;
  assigneeId: string | null;
  accessGrants?: { teamId: string }[];
};

function ticket(p: Partial<TicketShape> = {}): TicketShape {
  return { requesterId: 'req', assignedTeamId: null, assigneeId: null, ...p };
}

describe('AccessControlService', () => {
  let svc: AccessControlService;
  beforeEach(() => {
    svc = new AccessControlService();
  });

  describe('operationalTeamIds', () => {
    it('prefers memberTeamIds, dropping falsy entries', () => {
      const u = user({
        role: UserRole.AGENT,
        memberTeamIds: ['T1', '', 'T2'],
        teamId: 'T9',
      });
      expect(svc.operationalTeamIds(u)).toEqual(['T1', 'T2']);
    });

    it('falls back to the resolved session teamId when no memberships', () => {
      const u = user({ role: UserRole.AGENT, memberTeamIds: [], teamId: 'T9' });
      expect(svc.operationalTeamIds(u)).toEqual(['T9']);
    });

    it('returns empty when neither is present', () => {
      const u = user({ role: UserRole.AGENT });
      expect(svc.operationalTeamIds(u)).toEqual([]);
    });
  });

  describe('canViewTicket', () => {
    it('OWNER can view any ticket', () => {
      expect(
        svc.canViewTicket(owner(), ticket({ assignedTeamId: 'T-other' })),
      ).toBe(true);
    });

    it('TEAM_ADMIN can view tickets on their primary team or granted to it', () => {
      const ta = teamAdmin('T1');
      expect(svc.canViewTicket(ta, ticket({ assignedTeamId: 'T1' }))).toBe(true);
      expect(svc.canViewTicket(ta, ticket({ assignedTeamId: 'T2' }))).toBe(
        false,
      );
      expect(
        svc.canViewTicket(
          ta,
          ticket({ assignedTeamId: 'T2', accessGrants: [{ teamId: 'T1' }] }),
        ),
      ).toBe(true);
    });

    it('EMPLOYEE can view only tickets they requested', () => {
      const e = employee('e1');
      expect(svc.canViewTicket(e, ticket({ requesterId: 'e1' }))).toBe(true);
      expect(svc.canViewTicket(e, ticket({ requesterId: 'someone' }))).toBe(
        false,
      );
    });

    it('LEAD can view tickets on any of their teams or granted to them', () => {
      const l = lead(['T1', 'T2']);
      expect(svc.canViewTicket(l, ticket({ assignedTeamId: 'T2' }))).toBe(true);
      expect(svc.canViewTicket(l, ticket({ assignedTeamId: 'T3' }))).toBe(false);
      expect(
        svc.canViewTicket(
          l,
          ticket({ assignedTeamId: 'T3', accessGrants: [{ teamId: 'T1' }] }),
        ),
      ).toBe(true);
    });

    it('AGENT can view (read) any ticket on their team, even assigned to a peer', () => {
      const a = agent(['T1'], 'a1');
      expect(
        svc.canViewTicket(
          a,
          ticket({ assignedTeamId: 'T1', assigneeId: 'someone-else' }),
        ),
      ).toBe(true);
      expect(svc.canViewTicket(a, ticket({ assignedTeamId: 'T2' }))).toBe(false);
    });

    it('LEAD/AGENT with no team scope fall back to requester-only visibility', () => {
      const a = agent([], 'a1');
      expect(svc.canViewTicket(a, ticket({ requesterId: 'a1' }))).toBe(true);
      expect(svc.canViewTicket(a, ticket({ requesterId: 'other' }))).toBe(false);
    });

    it('TEAM_ADMIN without a primary team gets no admin-level access', () => {
      // Falls through the TEAM_ADMIN branch (needs primaryTeamId) and, with no
      // team scope, is limited to tickets they requested.
      const ta = teamAdmin(null, 'ta1');
      expect(svc.canViewTicket(ta, ticket({ assignedTeamId: 'T1' }))).toBe(
        false,
      );
      expect(svc.canViewTicket(ta, ticket({ requesterId: 'ta1' }))).toBe(true);
    });
  });

  describe('canWriteTicket', () => {
    it('OWNER can write any ticket', () => {
      expect(svc.canWriteTicket(owner(), ticket({ assignedTeamId: 'X' }))).toBe(
        true,
      );
    });

    it('TEAM_ADMIN can write only tickets assigned to their team (grants do NOT confer write)', () => {
      const ta = teamAdmin('T1');
      expect(svc.canWriteTicket(ta, ticket({ assignedTeamId: 'T1' }))).toBe(
        true,
      );
      // A read grant to T1 must not unlock write when the ticket lives on T2.
      expect(
        svc.canWriteTicket(
          ta,
          ticket({ assignedTeamId: 'T2', accessGrants: [{ teamId: 'T1' }] }),
        ),
      ).toBe(false);
    });

    it('EMPLOYEE can write only their own requested tickets', () => {
      const e = employee('e1');
      expect(svc.canWriteTicket(e, ticket({ requesterId: 'e1' }))).toBe(true);
      expect(svc.canWriteTicket(e, ticket({ requesterId: 'other' }))).toBe(
        false,
      );
    });

    it('LEAD can write tickets on their team', () => {
      const l = lead(['T1']);
      expect(svc.canWriteTicket(l, ticket({ assignedTeamId: 'T1' }))).toBe(true);
      expect(svc.canWriteTicket(l, ticket({ assignedTeamId: 'T2' }))).toBe(
        false,
      );
    });

    it('AGENT can write only tickets on their team that are theirs or unassigned', () => {
      const a = agent(['T1'], 'a1');
      // Assigned to self
      expect(
        svc.canWriteTicket(
          a,
          ticket({ assignedTeamId: 'T1', assigneeId: 'a1' }),
        ),
      ).toBe(true);
      // Unassigned (can claim)
      expect(
        svc.canWriteTicket(
          a,
          ticket({ assignedTeamId: 'T1', assigneeId: null }),
        ),
      ).toBe(true);
      // Assigned to a peer -> read-only, cannot write
      expect(
        svc.canWriteTicket(
          a,
          ticket({ assignedTeamId: 'T1', assigneeId: 'peer' }),
        ),
      ).toBe(false);
      // Different team
      expect(
        svc.canWriteTicket(
          a,
          ticket({ assignedTeamId: 'T2', assigneeId: 'a1' }),
        ),
      ).toBe(false);
    });

    it('LEAD/AGENT with no team scope cannot write', () => {
      expect(
        svc.canWriteTicket(agent([], 'a1'), ticket({ requesterId: 'a1' })),
      ).toBe(false);
      expect(
        svc.canWriteTicket(lead([], 'l1'), ticket({ assignedTeamId: 'T1' })),
      ).toBe(false);
    });
  });

  describe('isPeerAgent', () => {
    it('is true for an AGENT on the team who is not the assignee', () => {
      const a = agent(['T1'], 'a1');
      expect(
        svc.isPeerAgent(a, { assignedTeamId: 'T1', assigneeId: 'other' }),
      ).toBe(true);
    });

    it('is false when the agent is the assignee', () => {
      const a = agent(['T1'], 'a1');
      expect(
        svc.isPeerAgent(a, { assignedTeamId: 'T1', assigneeId: 'a1' }),
      ).toBe(false);
    });

    it('is false when the ticket is on a different team', () => {
      const a = agent(['T1'], 'a1');
      expect(
        svc.isPeerAgent(a, { assignedTeamId: 'T2', assigneeId: 'other' }),
      ).toBe(false);
    });

    it('is false for non-AGENT roles', () => {
      expect(
        svc.isPeerAgent(lead(['T1']), {
          assignedTeamId: 'T1',
          assigneeId: 'other',
        }),
      ).toBe(false);
      expect(
        svc.isPeerAgent(owner(), { assignedTeamId: 'T1', assigneeId: 'other' }),
      ).toBe(false);
    });
  });

  describe('canPostMessage', () => {
    it('allows a peer agent to post even though they cannot write', () => {
      const a = agent(['T1'], 'a1');
      const t = ticket({ assignedTeamId: 'T1', assigneeId: 'peer' });
      expect(svc.canWriteTicket(a, t)).toBe(false);
      expect(svc.canPostMessage(a, t)).toBe(true);
    });

    it('denies an agent who is not on the ticket team', () => {
      const a = agent(['T2'], 'a1');
      expect(
        svc.canPostMessage(
          a,
          ticket({ assignedTeamId: 'T1', assigneeId: 'peer' }),
        ),
      ).toBe(false);
    });
  });

  describe('buildTicketAccessFilter', () => {
    it('OWNER -> unrestricted (empty filter)', () => {
      expect(svc.buildTicketAccessFilter(owner())).toEqual({});
    });

    it('EMPLOYEE -> requester-scoped', () => {
      expect(svc.buildTicketAccessFilter(employee('e1'))).toEqual({
        requesterId: 'e1',
      });
    });

    it('TEAM_ADMIN -> team OR access-grant', () => {
      expect(svc.buildTicketAccessFilter(teamAdmin('T1'))).toEqual({
        OR: [
          { assignedTeamId: 'T1' },
          { accessGrants: { some: { teamId: 'T1' } } },
        ],
      });
    });

    it('LEAD -> one OR pair per team', () => {
      expect(svc.buildTicketAccessFilter(lead(['T1', 'T2']))).toEqual({
        OR: [
          { assignedTeamId: 'T1' },
          { accessGrants: { some: { teamId: 'T1' } } },
          { assignedTeamId: 'T2' },
          { accessGrants: { some: { teamId: 'T2' } } },
        ],
      });
    });

    it('AGENT/LEAD with no scope -> requester-scoped', () => {
      expect(svc.buildTicketAccessFilter(agent([], 'a1'))).toEqual({
        requesterId: 'a1',
      });
    });
  });

  describe('accessConditionSql (raw-SQL guard + parameterization)', () => {
    it('rejects an injection-style alias', () => {
      expect(() =>
        svc.accessConditionSql(owner(), 't"; DROP TABLE "Ticket"; --'),
      ).toThrow(/Invalid SQL alias/);
    });

    it('rejects any alias with non-letter characters (digits, dashes)', () => {
      expect(() => svc.accessConditionSql(owner(), 't1')).toThrow(
        /Invalid SQL alias/,
      );
      expect(() => svc.accessConditionSql(owner(), 't-x')).toThrow(
        /Invalid SQL alias/,
      );
    });

    it('accepts safe identifier aliases', () => {
      expect(() => svc.accessConditionSql(owner(), 't')).not.toThrow();
      expect(() => svc.accessConditionSql(owner(), 'tickets')).not.toThrow();
      expect(() => svc.accessConditionSql(owner(), 'foo_bar')).not.toThrow();
    });

    it('OWNER -> unconditional TRUE with no bound values', () => {
      const sql = svc.accessConditionSql(owner(), 't');
      expect(sql.sql).toContain('TRUE');
      expect(sql.values).toEqual([]);
    });

    it('binds the user id as a parameter (not string-interpolated)', () => {
      const sql = svc.accessConditionSql(employee('e1'), 't');
      expect(sql.values).toContain('e1');
    });
  });
});
