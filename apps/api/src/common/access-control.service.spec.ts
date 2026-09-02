import { Logger } from '@nestjs/common';
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

    it('warns when it falls back, naming the user and the team', () => {
      // Fault C: an account can hold team scope with no TeamMember row, while
      // the web renders its controls from roster rows alone. The behaviour is
      // deliberately unchanged - it just stops being silent, so the next
      // account in this state is a log line rather than a lost day.
      const warn = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);
      svc.operationalTeamIds(
        user({ id: 'u-odd', role: UserRole.AGENT, memberTeamIds: [], teamId: 'T9' }),
      );
      expect(warn).toHaveBeenCalledTimes(1);
      const message = String(warn.mock.calls[0][0]);
      expect(message).toContain('u-odd');
      expect(message).toContain('T9');
      warn.mockRestore();
    });

    it('stays quiet when roster rows answer the question', () => {
      const warn = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);
      svc.operationalTeamIds(
        user({ role: UserRole.AGENT, memberTeamIds: ['T1'], teamId: 'T9' }),
      );
      expect(warn).not.toHaveBeenCalled();
      warn.mockRestore();
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

    it('anyone can view a ticket they raised themselves, whatever their team', () => {
      // roleFilter and roleConditionSql both carry this clause; canViewTicket
      // is the third writing of the same rule and gates the single-ticket GET.
      // Missing it made the list show a ticket that then 403'd on open.
      expect(
        svc.canViewTicket(
          lead(['T1'], 'l1'),
          ticket({ requesterId: 'l1', assignedTeamId: 'T-other' }),
        ),
      ).toBe(true);
      expect(
        svc.canViewTicket(
          teamAdmin('T1', 'ta1'),
          ticket({ requesterId: 'ta1', assignedTeamId: 'T-other' }),
        ),
      ).toBe(true);
      expect(
        svc.canViewTicket(
          agent(['T1'], 'a1'),
          ticket({ requesterId: 'a1', assignedTeamId: 'T-other' }),
        ),
      ).toBe(true);
    });

    it('does not let the requester clause resurrect a deleted ticket', () => {
      // The soft-delete gate runs first and must keep running first.
      expect(
        svc.canViewTicket(lead(['T1'], 'l1'), {
          ...ticket({ requesterId: 'l1' }),
          deletedAt: new Date(),
        }),
      ).toBe(false);
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

    it('lets anyone answer a ticket they raised themselves', () => {
      // Card 1.36's Fault B names "no reply" as part of the fault. Fixing only
      // visibility left a staff requester able to read their own off-team
      // ticket and unable to say anything on it, while an EMPLOYEE requester
      // could - canWriteTicket already grants an employee their own ticket.
      const l = lead(['T1'], 'l1');
      const own = ticket({ requesterId: 'l1', assignedTeamId: 'T-other' });
      expect(svc.canWriteTicket(l, own)).toBe(false);
      expect(svc.canPostMessage(l, own)).toBe(true);
    });

    it('still refuses someone with no claim on the ticket at all', () => {
      // The persona the 403 integration test uses: an EMPLOYEE who is not the
      // requester has no relationship and no team scope.
      expect(
        svc.canPostMessage(
          employee('nobody'),
          ticket({ requesterId: 'someone-else', assignedTeamId: 'T1' }),
        ),
      ).toBe(false);
    });

    it('does not let the requester clause reopen a deleted ticket', () => {
      expect(
        svc.canPostMessage(lead(['T1'], 'l1'), {
          ...ticket({ requesterId: 'l1' }),
          deletedAt: new Date(),
        }),
      ).toBe(false);
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
    // Every filter is wrapped as { AND: [{ deletedAt: null }, <role filter>] }
    // so soft-deleted tickets never leak through a list or count.
    const notDeleted = { deletedAt: null };

    it('OWNER -> unrestricted apart from the soft-delete filter', () => {
      expect(svc.buildTicketAccessFilter(owner())).toEqual({
        AND: [notDeleted, {}],
      });
    });

    it('EMPLOYEE -> requester-scoped', () => {
      expect(svc.buildTicketAccessFilter(employee('e1'))).toEqual({
        AND: [notDeleted, { requesterId: 'e1' }],
      });
    });

    // These two used to assert team clauses ONLY. That was the bug: a
    // TEAM_ADMIN or LEAD who raised a ticket to a team they are not on could
    // not see their own ticket anywhere - no list, no URL, no reply, no
    // resolution notice. Rank still governs everything else.
    it('TEAM_ADMIN -> team OR access-grant OR their own ticket', () => {
      expect(svc.buildTicketAccessFilter(teamAdmin('T1'))).toEqual({
        AND: [
          notDeleted,
          {
            OR: [
              { assignedTeamId: 'T1' },
              { accessGrants: { some: { teamId: 'T1' } } },
              { requesterId: 'ta' },
            ],
          },
        ],
      });
    });

    it('LEAD -> one OR pair per team, plus their own ticket', () => {
      expect(svc.buildTicketAccessFilter(lead(['T1', 'T2']))).toEqual({
        AND: [
          notDeleted,
          {
            OR: [
              { assignedTeamId: 'T1' },
              { accessGrants: { some: { teamId: 'T1' } } },
              { assignedTeamId: 'T2' },
              { accessGrants: { some: { teamId: 'T2' } } },
              { requesterId: 'lead' },
            ],
          },
        ],
      });
    });

    it('AGENT -> team clauses plus their own ticket', () => {
      expect(svc.buildTicketAccessFilter(agent(['T1'], 'a1'))).toEqual({
        AND: [
          notDeleted,
          {
            OR: [
              { assignedTeamId: 'T1' },
              { accessGrants: { some: { teamId: 'T1' } } },
              { requesterId: 'a1' },
            ],
          },
        ],
      });
    });

    it('OWNER and EMPLOYEE are untouched by the requester clause', () => {
      // OWNER already sees everything, so adding a clause would be noise;
      // EMPLOYEE is already requester-only, so it would be a tautology.
      expect(svc.buildTicketAccessFilter(owner())).toEqual({
        AND: [notDeleted, {}],
      });
      expect(svc.buildTicketAccessFilter(employee('e1'))).toEqual({
        AND: [notDeleted, { requesterId: 'e1' }],
      });
    });

    it('the no-team fallback stays exactly requester-scoped', () => {
      // Not `OR: [{requesterId}]` - the shape matters, because a stray OR with
      // one arm is how a "temporarily empty" team scope turns into a leak.
      expect(svc.buildTicketAccessFilter(lead([], 'l1'))).toEqual({
        AND: [notDeleted, { requesterId: 'l1' }],
      });
      expect(svc.buildTicketAccessFilter(teamAdmin(null, 'ta1'))).toEqual({
        AND: [notDeleted, { requesterId: 'ta1' }],
      });
    });

    it('AGENT/LEAD with no scope -> requester-scoped', () => {
      expect(svc.buildTicketAccessFilter(agent([], 'a1'))).toEqual({
        AND: [notDeleted, { requesterId: 'a1' }],
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

    it('carries the requester clause for every team-scoped role', () => {
      // roleConditionSql backs the counts and reports; roleFilter backs the
      // lists. If only one gained the clause, the sidebar badge would disagree
      // with the list beside it. access-control.parity.spec is the integration
      // half of this guarantee.
      for (const u of [teamAdmin('T1', 'ta1'), lead(['T1'], 'l1'), agent(['T1'], 'a1')]) {
        const sql = svc.accessConditionSql(u, 't');
        expect(sql.sql).toContain('"requesterId"');
        expect(sql.values).toContain(u.id);
      }
    });
  });

  describe('soft-delete rules', () => {
    const live = {
      requesterId: 'r',
      assignedTeamId: 't1',
      assigneeId: 'a',
      deletedAt: null,
    };
    const gone = { ...live, deletedAt: new Date() };

    it('excludes deleted tickets from the list filter for every role', () => {
      expect(JSON.stringify(svc.buildTicketAccessFilter(owner()))).toContain(
        '"deletedAt":null',
      );
      expect(
        JSON.stringify(svc.buildTicketAccessFilter(agent(['t1']))),
      ).toContain('"deletedAt":null');
    });

    it('lets only the owner opt in to deleted tickets', () => {
      expect(
        JSON.stringify(
          svc.buildTicketAccessFilter(owner(), { includeDeleted: true }),
        ),
      ).not.toContain('deletedAt');
      expect(
        JSON.stringify(
          svc.buildTicketAccessFilter(agent(['t1']), { includeDeleted: true }),
        ),
      ).toContain('"deletedAt":null');
    });

    it('puts the deleted filter into the raw SQL condition', () => {
      expect(svc.accessConditionSql(owner()).sql).toContain(
        '"deletedAt" IS NULL',
      );
      expect(
        svc.accessConditionSql(owner(), 't', { includeDeleted: true }).sql,
      ).not.toContain('deletedAt');
    });

    it('hides deleted tickets from non-owners and blocks all writes on them', () => {
      expect(svc.canViewTicket(agent(['t1'], 'a'), gone)).toBe(false);
      expect(svc.canViewTicket(owner(), gone)).toBe(true);
      expect(svc.canWriteTicket(owner(), gone)).toBe(false);
      expect(svc.canPostMessage(agent(['t1'], 'a'), gone)).toBe(false);
      expect(svc.canWriteTicket(agent(['t1'], 'a'), live)).toBe(true);
    });
  });
});
