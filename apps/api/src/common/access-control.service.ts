import { Injectable } from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import { AuthUser } from '../auth/current-user.decorator';

/**
 * Shared access control logic for ticket visibility and write permissions.
 * Extracted to avoid duplication across tickets, custom-fields, and reports services.
 */
@Injectable()
export class AccessControlService {
  /**
   * Returns a Prisma TicketWhereInput filter that restricts ticket visibility
   * based on the authenticated user's role and team membership.
   */
  buildTicketAccessFilter(user: AuthUser): Prisma.TicketWhereInput {
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

    if (!user.teamId) {
      return { requesterId: user.id };
    }

    if (user.role === UserRole.LEAD) {
      return {
        OR: [
          { assignedTeamId: user.teamId },
          { accessGrants: { some: { teamId: user.teamId } } },
        ],
      };
    }

    return {
      OR: [
        { assignedTeamId: user.teamId, assigneeId: user.id },
        { assignedTeamId: user.teamId, assigneeId: null },
        { accessGrants: { some: { teamId: user.teamId } } },
      ],
    };
  }

  /**
   * Raw SQL condition restricting ticket visibility by role and team membership.
   * Suitable for use in $queryRaw with a table alias (e.g. 't').
   */
  accessConditionSql(user: AuthUser, alias = 't'): Prisma.Sql {
    // 4.2 fix: validate alias is a safe SQL identifier (letters/underscore only)
    if (!/^[a-zA-Z_]+$/.test(alias)) {
      throw new Error(`Invalid SQL alias: "${alias}"`);
    }
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

    if (!user.teamId) {
      return Prisma.sql`${col('requesterId')} = ${user.id}`;
    }

    if (user.role === UserRole.LEAD) {
      return Prisma.sql`(${col('assignedTeamId')} = ${user.teamId} OR ${accessGrant(user.teamId)})`;
    }

    return Prisma.sql`((${col('assignedTeamId')} = ${user.teamId} AND (${col('assigneeId')} = ${user.id} OR ${col('assigneeId')} IS NULL)) OR ${accessGrant(user.teamId)})`;
  }

  /**
   * Check if a user can view a specific ticket based on role and team membership.
   */
  canViewTicket(
    user: AuthUser,
    ticket: {
      requesterId: string;
      assignedTeamId: string | null;
      assigneeId: string | null;
      accessGrants?: { teamId: string }[];
    },
  ): boolean {
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

    if (!user.teamId) {
      return ticket.requesterId === user.id;
    }

    const hasReadGrant =
      ticket.accessGrants?.some((grant) => grant.teamId === user.teamId) ??
      false;

    if (user.role === UserRole.LEAD) {
      return ticket.assignedTeamId === user.teamId || hasReadGrant;
    }

    const isAgentAccess =
      ticket.assignedTeamId === user.teamId &&
      (ticket.assigneeId === user.id || ticket.assigneeId === null);

    return isAgentAccess || hasReadGrant;
  }

  /**
   * Check if a user can write/modify a specific ticket.
   */
  canWriteTicket(
    user: AuthUser,
    ticket: {
      requesterId: string;
      assignedTeamId: string | null;
      assigneeId: string | null;
    },
  ): boolean {
    if (user.role === UserRole.OWNER) {
      return true;
    }

    if (user.role === UserRole.TEAM_ADMIN && user.primaryTeamId) {
      return ticket.assignedTeamId === user.primaryTeamId;
    }

    if (user.role === UserRole.EMPLOYEE) {
      return ticket.requesterId === user.id;
    }

    if (!user.teamId) {
      return false;
    }

    if (user.role === UserRole.LEAD) {
      return ticket.assignedTeamId === user.teamId;
    }

    return (
      ticket.assignedTeamId === user.teamId &&
      (ticket.assigneeId === user.id || ticket.assigneeId === null)
    );
  }
}
