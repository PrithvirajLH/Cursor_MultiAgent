import { Injectable } from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import { AuthUser } from '../auth/current-user.decorator';
import type { AccessOptions } from './access-options.type';

/**
 * Shared access control logic for ticket visibility and write permissions.
 * Extracted to avoid duplication across tickets, custom-fields, and reports services.
 */
@Injectable()
export class AccessControlService {
  /**
   * Teams used for AGENT/LEAD ticket visibility: all memberships, falling back to resolved session teamId.
   */
  operationalTeamIds(user: AuthUser): string[] {
    const fromRows = user.memberTeamIds?.filter(Boolean) ?? [];
    if (fromRows.length > 0) {
      return fromRows;
    }
    return user.teamId ? [user.teamId] : [];
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
        OR: teamScope.flatMap((teamId) => [
          { assignedTeamId: teamId },
          { accessGrants: { some: { teamId } } },
        ]),
      };
    }

    // AGENT: can VIEW any ticket assigned to their team (read access for peers).
    // Edit-permission is enforced separately by canEditTicket.
    return {
      OR: teamScope.flatMap((teamId) => [
        { assignedTeamId: teamId },
        { accessGrants: { some: { teamId } } },
      ]),
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

    if (user.role === UserRole.TEAM_ADMIN && user.primaryTeamId) {
      return Prisma.sql`(${col('assignedTeamId')} = ${user.primaryTeamId} OR ${accessGrant(user.primaryTeamId)})`;
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
      return Prisma.join(parts, ' OR ');
    }

    // AGENT visibility mirrors buildTicketAccessFilter: any ticket on their
    // team (peer agents can read), plus tickets with an explicit access grant
    // to their team.
    const agentParts = teamScopeSql.map(
      (teamId) =>
        Prisma.sql`(${col('assignedTeamId')} = ${teamId} OR ${accessGrant(teamId)})`,
    );
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
