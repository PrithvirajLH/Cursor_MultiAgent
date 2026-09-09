import { Injectable, Logger } from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import { AuthUser } from '../auth/current-user.decorator';
import type { AccessOptions } from './access-options.type';

/**
 * Shared access control logic for ticket visibility and write permissions.
 * Extracted to avoid duplication across tickets, custom-fields, and reports services.
 */
@Injectable()
export class AccessControlService {
  private readonly logger = new Logger(AccessControlService.name);
  /**
   * Accounts already warned about a missing roster row, this process (card 1.55).
   *
   * Bounded by the number of accounts actually in the mismatched state, which
   * is three, so this does not grow. It exists because the warning fired **186
   * times on 2026-09-09** - 62 each for three Payroll accounts - and the
   * comment below already claimed it warned only "the first time such an
   * account is used". This makes that true.
   */
  private readonly warnedMissingRoster = new Set<string>();

  /**
   * THE definition of "on a team", for every caller.
   *
   * Roster rows first. `teamId` is the session value the auth guard resolved,
   * which itself falls back to `primaryTeamId` when there is no roster row -
   * so an account can hold team scope on the server while having no membership
   * anyone can see. That mismatch cost a day on 2026-09-02: `phulgur@` had
   * `primaryTeamId = payroll` and no `TeamMember` row, the web (which reads
   * roster rows only) never rendered the assign control, and no request ever
   * reached the server to be refused. Nothing was wrong; nothing said so.
   *
   * The behaviour is deliberately unchanged - narrowing a permissions
   * chokepoint on a live system would silently lock out any other account in
   * the same state, which is the failure mode this is trying to end. Instead
   * it now says so, loudly, the first time such an account is used.
   *
   * ⚠️ CARD 1.55: THE RETURN VALUE IS UNCHANGED AND MUST STAY THAT WAY. Five of
   * this function's six callers are in this file, including `roleFilter` and
   * `roleConditionSql`, which back every ticket list and every count in the
   * product. Narrowing what it returns to quiet a log would change visibility
   * on the hottest read path. Only the WARNING changed.
   */
  operationalTeamIds(user: AuthUser): string[] {
    const fromRows = user.memberTeamIds?.filter(Boolean) ?? [];
    if (fromRows.length > 0) {
      return fromRows;
    }
    if (user.teamId) {
      this.warnMissingRosterRow(user);
      return [user.teamId];
    }
    return [];
  }

  /**
   * Say - once per account - that this session has team scope with no roster row.
   *
   * ⚠️ WHY THIS WAS REWRITTEN. The old warning fired on every call, so three
   * accounts produced 186 lines in a day on the busiest read path in the
   * product, and it asserted a single cause: "Add the roster row." Three
   * Payroll accounts hold roster rows created days BEFORE the warnings, so for
   * them that instruction is to add a row that already exists. A warning that
   * is usually wrong trains everyone to skip it - and this is the noise the
   * planner had to read past to diagnose card 1.54.
   *
   * Two things make it useful again. It logs `memberTeamIds` ITSELF, because
   * the value is the whole question: the auth guard populates it from
   * `teamMember.findMany({ where: { userId } })`, so an empty array means that
   * query found nothing **for this user id** even though rows exist for the
   * person. The likeliest shape of that is a second User row for the same human
   * - this codebase has `DuplicateAccountService` precisely because Entra hands
   * back a UPN and a `mail` that differ - and the roster rows sitting on the
   * other row. So the message now names both checks instead of asserting one.
   *
   * And `undefined` is distinguished from `[]`. An absent array means nobody
   * looked up the roster, which says nothing about whether rows exist; only an
   * empty one is evidence of a mismatch. Every HTTP path populates it today, so
   * this is a guard against a future caller synthesising an `AuthUser` and
   * being blamed for a data problem it never had.
   */
  private warnMissingRosterRow(user: AuthUser): void {
    if (user.memberTeamIds === undefined) {
      return;
    }
    if (this.warnedMissingRoster.has(user.id)) {
      return;
    }
    this.warnedMissingRoster.add(user.id);
    this.logger.warn(
      `ROSTER_MISMATCH user=${user.id} email=${user.email} ` +
        `teamId=${user.teamId} primaryTeamId=${user.primaryTeamId ?? 'null'} ` +
        `memberTeamIds=${JSON.stringify(user.memberTeamIds)}. ` +
        'This session has team scope with no TeamMember row for THIS user id, so the ' +
        'web (which reads roster rows only) will disagree with the API. Either the ' +
        'roster row is missing, or it belongs to a duplicate User row for the same ' +
        'person - check for a second account before adding a row. Warned once per ' +
        'account per process.',
    );
  }

  /**
   * Returns a Prisma TicketWhereInput filter that restricts ticket visibility
   * based on the authenticated user's role and team membership. Soft-deleted
   * tickets are always excluded unless an OWNER passes `includeDeleted`.
   */
  buildTicketAccessFilter(
    user: AuthUser,
    options?: AccessOptions,
  ): Prisma.TicketWhereInput {
    const roleFilter = this.roleFilter(user);
    if (options?.includeDeleted && user.role === UserRole.OWNER) {
      return roleFilter;
    }
    return { AND: [{ deletedAt: null }, roleFilter] };
  }

  /** Role/team visibility filter without the soft-delete clause. */
  private roleFilter(user: AuthUser): Prisma.TicketWhereInput {
    if (user.role === UserRole.OWNER) {
      return {};
    }

    if (user.role === UserRole.TEAM_ADMIN && user.primaryTeamId) {
      return {
        OR: [
          { assignedTeamId: user.primaryTeamId },
          { accessGrants: { some: { teamId: user.primaryTeamId } } },
          // ...or I raised it. Staff filing a ticket to a team they are not on
          // could not see their own ticket at all: not in a list, not by URL,
          // no reply, no confirmation it was resolved. Rank still governs
          // everything else; this only adds back the person's own ticket.
          { requesterId: user.id },
        ],
      };
    }

    if (user.role === UserRole.EMPLOYEE) {
      return { requesterId: user.id };
    }

    const teamScope = this.operationalTeamIds(user);
    if (!teamScope.length) {
      return { requesterId: user.id };
    }

    if (user.role === UserRole.LEAD) {
      return {
        OR: [
          ...teamScope.flatMap((teamId) => [
            { assignedTeamId: teamId },
            { accessGrants: { some: { teamId } } },
          ]),
          { requesterId: user.id },
        ],
      };
    }

    // AGENT: can VIEW any ticket assigned to their team (read access for peers).
    // Edit-permission is enforced separately by canEditTicket.
    return {
      OR: [
        ...teamScope.flatMap((teamId) => [
          { assignedTeamId: teamId },
          { accessGrants: { some: { teamId } } },
        ]),
        { requesterId: user.id },
      ],
    };
  }

  /**
   * Raw SQL condition restricting ticket visibility by role and team membership.
   * Suitable for use in $queryRaw with a table alias (e.g. 't'). Soft-deleted
   * tickets are always excluded unless an OWNER passes `includeDeleted`.
   */
  accessConditionSql(
    user: AuthUser,
    alias = 't',
    options?: AccessOptions,
  ): Prisma.Sql {
    // 4.2 fix: validate alias is a safe SQL identifier (letters/underscore only)
    if (!/^[a-zA-Z_]+$/.test(alias)) {
      throw new Error(`Invalid SQL alias: "${alias}"`);
    }
    const roleSql = this.roleConditionSql(user, alias);
    if (options?.includeDeleted && user.role === UserRole.OWNER) {
      return roleSql;
    }
    const deletedAt = Prisma.raw(`${alias}."deletedAt"`);
    return Prisma.sql`(${deletedAt} IS NULL AND (${roleSql}))`;
  }

  /** Role/team visibility SQL fragment without the soft-delete clause; alias already validated. */
  private roleConditionSql(user: AuthUser, alias: string): Prisma.Sql {
    const col = (name: string) => Prisma.raw(`${alias}."${name}"`);
    const accessGrant = (teamId: string) =>
      Prisma.sql`EXISTS (SELECT 1 FROM "TicketAccess" ta WHERE ta."ticketId" = ${col('id')} AND ta."teamId" = ${teamId})`;

    if (user.role === UserRole.OWNER) {
      return Prisma.sql`TRUE`;
    }

    // Every branch below mirrors roleFilter, requester clause included. It has
    // to: this fragment backs the counts and report queries while roleFilter
    // backs the lists, so a ticket visible in one and not the other would make
    // the sidebar badge disagree with the list beside it.
    if (user.role === UserRole.TEAM_ADMIN && user.primaryTeamId) {
      return Prisma.sql`(${col('assignedTeamId')} = ${user.primaryTeamId} OR ${accessGrant(user.primaryTeamId)} OR ${col('requesterId')} = ${user.id})`;
    }

    if (user.role === UserRole.EMPLOYEE) {
      return Prisma.sql`${col('requesterId')} = ${user.id}`;
    }

    const teamScopeSql = this.operationalTeamIds(user);
    if (!teamScopeSql.length) {
      return Prisma.sql`${col('requesterId')} = ${user.id}`;
    }

    if (user.role === UserRole.LEAD) {
      const parts = teamScopeSql.map(
        (teamId) =>
          Prisma.sql`(${col('assignedTeamId')} = ${teamId} OR ${accessGrant(teamId)})`,
      );
      parts.push(Prisma.sql`(${col('requesterId')} = ${user.id})`);
      return Prisma.join(parts, ' OR ');
    }

    // AGENT visibility mirrors buildTicketAccessFilter: any ticket on their
    // team (peer agents can read), plus tickets with an explicit access grant
    // to their team.
    const agentParts = teamScopeSql.map(
      (teamId) =>
        Prisma.sql`(${col('assignedTeamId')} = ${teamId} OR ${accessGrant(teamId)})`,
    );
    agentParts.push(Prisma.sql`(${col('requesterId')} = ${user.id})`);
    return Prisma.join(agentParts, ' OR ');
  }

  /**
   * Check if a user can view a specific ticket based on role and team membership.
   * A soft-deleted ticket is visible to OWNER only.
   */
  canViewTicket(
    user: AuthUser,
    ticket: {
      requesterId: string;
      assignedTeamId: string | null;
      assigneeId: string | null;
      accessGrants?: { teamId: string }[];
      deletedAt?: Date | null;
    },
  ): boolean {
    if (ticket.deletedAt && user.role !== UserRole.OWNER) {
      return false;
    }
    if (user.role === UserRole.OWNER) {
      return true;
    }

    // The same requester clause the list filters carry. This is the THIRD
    // place the visibility rule is written (roleFilter, roleConditionSql, and
    // here) and it is the one the card did not name: without it the list
    // returned the ticket and opening it answered 403, which is worse than not
    // showing it at all. Caught by the integration test, not by reading.
    if (ticket.requesterId === user.id) {
      return true;
    }

    if (user.role === UserRole.TEAM_ADMIN && user.primaryTeamId) {
      const grant =
        ticket.accessGrants?.some((g) => g.teamId === user.primaryTeamId) ??
        false;
      return ticket.assignedTeamId === user.primaryTeamId || grant;
    }

    if (user.role === UserRole.EMPLOYEE) {
      return ticket.requesterId === user.id;
    }

    const teamScope = this.operationalTeamIds(user);
    if (!teamScope.length) {
      return ticket.requesterId === user.id;
    }

    const hasReadGrant =
      ticket.accessGrants?.some((grant) =>
        grant.teamId != null ? teamScope.includes(grant.teamId) : false,
      ) ?? false;

    if (user.role === UserRole.LEAD) {
      return (
        (ticket.assignedTeamId != null &&
          teamScope.includes(ticket.assignedTeamId)) ||
        hasReadGrant
      );
    }

    // AGENT can read any ticket assigned to one of their teams; edits are
    // restricted separately by canEditTicket.
    const isAgentAccess =
      ticket.assignedTeamId != null &&
      teamScope.includes(ticket.assignedTeamId);

    return isAgentAccess || hasReadGrant;
  }

  /**
   * Returns true when the AGENT viewing the ticket is NOT the assignee but
   * still on the team. Used by the message endpoint to force INTERNAL type
   * for peer-agent notes. Other roles return false (their write/edit gate
   * already covers them).
   */
  isPeerAgent(
    user: AuthUser,
    ticket: { assignedTeamId: string | null; assigneeId: string | null },
  ): boolean {
    if (user.role !== UserRole.AGENT) return false;
    if (ticket.assigneeId === user.id) return false;
    const teamScope = this.operationalTeamIds(user);
    return (
      ticket.assignedTeamId != null &&
      teamScope.includes(ticket.assignedTeamId)
    );
  }

  /**
   * Can the user post a message on this ticket?
   * Broader than canWriteTicket: peer agents (same team, not assignee) are
   * allowed to post — addMessage forces their type to INTERNAL.
   */
  /**
   * May this person's EMAILED reply go on this ticket? (card 1.40)
   *
   * The audience is everyone we actually emailed: the requester, the assignee,
   * and the followers - which is exactly the Cc list card 1.33 sends to and
   * card 1.28 displays. If we invited somebody into a conversation, their reply
   * belongs in it.
   *
   * ⚠️ THE REPLY TOKEN IS NOT THE AUTHORISATION. The inbound address carries
   * `+ticket-<id>`, which is a bearer token every participant can read and
   * forward. It says WHICH TICKET. It must never say WHO MAY WRITE - otherwise
   * forwarding one email hands a stranger the ability to post. So the SENDER is
   * matched against the audience here, and the token only routes.
   *
   * Deliberately not "any EMPLOYEE": that would let anyone who can guess a
   * reply address post to any ticket.
   *
   * This lives here, beside roleFilter, roleConditionSql and canViewTicket,
   * because a fourth copy of the audience rule in a different file is exactly
   * how card 1.36's Fault C and card 1.38 happened.
   */
  canReplyByEmail(
    userId: string,
    ticket: {
      requesterId: string;
      assigneeId: string | null;
      followers: { userId: string }[];
      deletedAt?: Date | null;
    },
  ): boolean {
    if (ticket.deletedAt) return false;
    if (ticket.requesterId === userId) return true;
    if (ticket.assigneeId === userId) return true;
    return ticket.followers.some((follower) => follower.userId === userId);
  }

  canPostMessage(
    user: AuthUser,
    ticket: {
      requesterId: string;
      assignedTeamId: string | null;
      assigneeId: string | null;
      deletedAt?: Date | null;
    },
  ): boolean {
    if (ticket.deletedAt) return false;
    if (this.canWriteTicket(user, ticket)) return true;
    // I can always answer my own ticket. Card 1.36's Fault B names "no reply"
    // as part of the fault, and fixing only visibility left a staff requester
    // able to read their own off-team ticket and unable to say anything on it -
    // an EMPLOYEE requester could, because canWriteTicket already grants them
    // their own ticket. What they may post is narrowed in
    // TicketsService.addMessage: someone here purely as the requester gets
    // PUBLIC only.
    if (ticket.requesterId === user.id) return true;
    return this.isPeerAgent(user, ticket);
  }

  /**
   * Check if a user can write/modify a specific ticket. Nobody can write to a
   * soft-deleted ticket — restoring it is its own endpoint.
   */
  canWriteTicket(
    user: AuthUser,
    ticket: {
      requesterId: string;
      assignedTeamId: string | null;
      assigneeId: string | null;
      deletedAt?: Date | null;
    },
  ): boolean {
    if (ticket.deletedAt) return false;
    if (user.role === UserRole.OWNER) {
      return true;
    }

    if (user.role === UserRole.TEAM_ADMIN && user.primaryTeamId) {
      return ticket.assignedTeamId === user.primaryTeamId;
    }

    if (user.role === UserRole.EMPLOYEE) {
      return ticket.requesterId === user.id;
    }

    const teamScopeWrite = this.operationalTeamIds(user);
    if (!teamScopeWrite.length) {
      return false;
    }

    if (user.role === UserRole.LEAD) {
      return (
        ticket.assignedTeamId != null &&
        teamScopeWrite.includes(ticket.assignedTeamId)
      );
    }

    return (
      ticket.assignedTeamId != null &&
      teamScopeWrite.includes(ticket.assignedTeamId) &&
      (ticket.assigneeId === user.id || ticket.assigneeId === null)
    );
  }
}
