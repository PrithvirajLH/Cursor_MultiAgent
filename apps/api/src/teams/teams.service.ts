import { AdminAuditService } from '../audit/admin-audit.service';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, TeamRole, UserRole } from '@prisma/client';
import { AuthUser } from '../auth/current-user.decorator';
import { assertUserIsActive } from '../common/assert-user-is-active.util';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { AddTeamMemberDto } from './dto/add-team-member.dto';
import { CreateTeamDto } from './dto/create-team.dto';
import { ListTeamsDto } from './dto/list-teams.dto';
import { isReservedTeamSlug } from './is-reserved-team-slug.util';
import { UpdateTeamDto } from './dto/update-team.dto';
import { UpdateTeamMemberDto } from './dto/update-team-member.dto';

@Injectable()
export class TeamsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
    private readonly adminAudit: AdminAuditService,
  ) {}

  async list(query: ListTeamsDto, user?: AuthUser) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const skip = (page - 1) * pageSize;

    // Owners may opt into seeing deactivated teams (e.g. to reactivate them).
    const includeInactive =
      query.includeInactive === 'true' && user?.role === UserRole.OWNER;
    const baseWhere: {
      isActive?: boolean;
      id?: string | { in: string[] };
    } = includeInactive ? {} : { isActive: true };
    if (user?.role === UserRole.TEAM_ADMIN) {
      if (!user.primaryTeamId) {
        throw new ForbiddenException(
          'Team administrator must have a primary team set',
        );
      }
      baseWhere.id = user.primaryTeamId;
    }
    if (user?.role === UserRole.LEAD) {
      const leadTeamId = user.teamId ?? user.primaryTeamId;
      if (!leadTeamId) {
        throw new ForbiddenException('Lead must belong to a team');
      }
      baseWhere.id = leadTeamId;
    }
    // AGENT, EMPLOYEE, and OWNER see the full team list. This is required for the
    // new-ticket department picker and for ticket routing/transfer; team names are
    // not sensitive (team membership and admin detail are restricted separately).
    // NOTE: a prior change scoped AGENT/EMPLOYEE to their member teams ("BUG-09"),
    // but that broke requester ticket creation (empty department dropdown), so the
    // full-list behavior is intentional. (TEAM_ADMIN/LEAD remain scoped above.)
    const where = {
      ...baseWhere,
      ...(query.q
        ? {
            OR: [
              { name: { contains: query.q, mode: 'insensitive' as const } },
              {
                description: {
                  contains: query.q,
                  mode: 'insensitive' as const,
                },
              },
            ],
          }
        : {}),
    };

    const [total, data] = await Promise.all([
      this.prisma.team.count({ where }),
      this.prisma.team.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { name: 'asc' },
      }),
    ]);

    return {
      data,
      meta: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  }

  async create(payload: CreateTeamDto, user: AuthUser) {
    this.ensureOwner(user);
    const slug = payload.slug ?? this.slugify(payload.name);
    this.assertSlugNotReserved(slug);

    const created = await this.prisma.team.create({
      data: {
        name: payload.name,
        slug,
        description: payload.description,
        assignmentStrategy: payload.assignmentStrategy,
      },
    });
    await this.safePublishAdminChanged({
      scope: 'team',
      action: 'created',
      entityId: created.id,
      teamId: created.id,
      actorId: user.id,
      actor: user,
    });
    return created;
  }

  async update(teamId: string, payload: UpdateTeamDto, user: AuthUser) {
    this.ensureTeamAdminOrOwner(user, teamId);

    await this.ensureTeam(teamId);
    if (payload.slug !== undefined) {
      this.assertSlugNotReserved(payload.slug);
    }

    const updated = await this.prisma.team.update({
      where: { id: teamId },
      data: {
        name: payload.name,
        slug: payload.slug,
        description: payload.description,
        isActive: payload.isActive,
        assignmentStrategy: payload.assignmentStrategy,
      },
    });
    await this.safePublishAdminChanged({
      scope: 'team',
      action: 'updated',
      entityId: updated.id,
      teamId: updated.id,
      actorId: user.id,
      actor: user,
    });
    return updated;
  }

  async listMembers(teamId: string, user: AuthUser) {
    this.ensureMemberAccess(user, teamId);

    await this.ensureTeam(teamId);

    const data = await this.prisma.teamMember.findMany({
      where: { teamId },
      include: { user: true, team: true },
      orderBy: { createdAt: 'asc' },
    });

    return { data };
  }

  async addMember(teamId: string, payload: AddTeamMemberDto, user: AuthUser) {
    this.ensureTeamAdminOrOwner(user, teamId);

    await this.ensureTeam(teamId);
    const targetUser = await this.ensureUser(payload.userId);
    this.ensureEligibleTeamMemberRole(targetUser.role);
    const teamRole = this.resolveTeamRole(targetUser.role, payload.role);

    const member = await this.prisma.$transaction(async (tx) => {
      const member = await tx.teamMember.upsert({
        where: {
          teamId_userId: {
            teamId,
            userId: payload.userId,
          },
        },
        update: {
          role: teamRole,
        },
        create: {
          teamId,
          userId: payload.userId,
          role: teamRole,
        },
        include: { user: true, team: true },
      });

      await this.syncOperationalUserRole(tx, payload.userId);

      return tx.teamMember.findUniqueOrThrow({
        where: { id: member.id },
        include: { user: true, team: true },
      });
    });
    await this.safePublishAdminChanged({
      scope: 'team_member',
      action: 'added',
      entityId: member.id,
      teamId,
      actorId: user.id,
      actor: user,
    });
    return member;
  }

  async updateMember(
    teamId: string,
    memberId: string,
    payload: UpdateTeamMemberDto,
    user: AuthUser,
  ) {
    this.ensureTeamAdminOrOwner(user, teamId);

    const member = await this.prisma.teamMember.findUnique({
      where: { id: memberId },
      include: { user: true },
    });

    if (!member || member.teamId !== teamId) {
      throw new NotFoundException('Team member not found');
    }

    this.ensureEligibleTeamMemberRole(member.user.role);
    const teamRole = this.resolveTeamRole(member.user.role, payload.role);

    const updatedMember = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.teamMember.update({
        where: { id: memberId },
        data: { role: teamRole },
        include: { user: true, team: true },
      });

      await this.syncOperationalUserRole(tx, member.user.id);

      return tx.teamMember.findUniqueOrThrow({
        where: { id: updated.id },
        include: { user: true, team: true },
      });
    });
    await this.safePublishAdminChanged({
      scope: 'team_member',
      action: 'updated',
      entityId: updatedMember.id,
      teamId,
      actorId: user.id,
      actor: user,
    });
    return updatedMember;
  }

  async removeMember(teamId: string, memberId: string, user: AuthUser) {
    this.ensureTeamAdminOrOwner(user, teamId);

    const member = await this.prisma.teamMember.findUnique({
      where: { id: memberId },
      // Card 1.126 needs the member's own role to decide, and `userId` alone
      // cannot answer "is this another team admin".
      include: { user: { select: { id: true, role: true } } },
    });

    if (!member || member.teamId !== teamId) {
      throw new NotFoundException('Team member not found');
    }
    this.ensureMemberIsRemovableBy(user, member);

    await this.prisma.$transaction(async (tx) => {
      await tx.teamMember.delete({ where: { id: memberId } });
      await this.syncOperationalUserRole(tx, member.userId);
    });

    await this.safePublishAdminChanged({
      scope: 'team_member',
      action: 'removed',
      entityId: memberId,
      teamId,
      actorId: user.id,
      actor: user,
    });
    return { id: memberId };
  }

  /**
   * May THIS actor remove THIS person (card 1.126)?
   *
   * ⚠️ REPORTED LIVE FROM PRODUCTION. The owner held TEAM_ADMIN, removed their
   * own account from Payroll, and then could not get back in - and named the
   * missing rule themselves: *"team admin cannot remove another team admin or
   * himself"*.
   *
   * ⚠️ `removeMember` HAD NO GUARD AT ALL beyond "may you manage this team".
   * The whole method was: permission gate, find the row, delete it, sync the
   * role. So a TEAM_ADMIN could remove themselves, remove a peer, or empty a
   * team completely.
   *
   * ⚠️ THIS IS A DIFFERENT QUESTION FROM `ensureTeamAdminOrOwner` and is
   * deliberately not folded into it. That one answers *"may you manage this
   * team"*; this answers *"may you remove THIS PERSON"*. An actor can pass the
   * first and fail the second.
   *
   * ✅ **THE CODEBASE ALREADY SOLVED THIS SHAPE ONE FILE OVER** -
   * `users.service.ts:203-212` forbids an OWNER demoting themselves and forbids
   * demoting the last active owner. The reasoning was there; it had never been
   * carried across to team membership. The exception types mirror it too:
   * `BadRequest` for doing it to yourself, `Forbidden` for doing it to someone
   * else.
   *
   * ⚠️ AN OWNER IS EXEMPT FROM BOTH RULES, BY DESIGN. Somebody has to be able
   * to remove a team admin, and an owner is the only role that can - which is
   * exactly the way out this refusal points at.
   *
   * ⚠️ **THE LAST MEMBER OF A TEAM IS DELIBERATELY NOT BLOCKED.** An empty team
   * still receives auto-assigned tickets with nobody to take them, which is a
   * real hazard - but refusing it *here* would be a guarantee this method
   * cannot keep: deactivating a user and changing their role both empty a team
   * by other routes, neither of which passes through here. A guard that can be
   * walked around is worse than none, because it reads like protection. The
   * auto-assignment hazard is recorded on the board instead.
   *
   * @param actor The signed-in user asking to remove somebody.
   * @param member The membership row, with its user's role.
   */
  private ensureMemberIsRemovableBy(
    actor: AuthUser,
    member: { userId: string; user: { role: UserRole } },
  ) {
    if (actor.role === UserRole.OWNER) {
      return;
    }
    if (member.userId === actor.id) {
      throw new BadRequestException(
        'You cannot remove yourself from a team you administer. Ask an owner to do it.',
      );
    }
    if (member.user.role === UserRole.TEAM_ADMIN) {
      throw new ForbiddenException(
        'You cannot remove another team admin. Ask an owner to do it.',
      );
    }
  }

  private ensureOwner(user: AuthUser) {
    if (user.role !== UserRole.OWNER) {
      throw new ForbiddenException('Owner access required');
    }
  }

  private ensureTeamAdminOrOwner(user: AuthUser, teamId: string) {
    if (user.role === UserRole.OWNER) return;
    if (user.role === UserRole.TEAM_ADMIN && user.primaryTeamId === teamId)
      return;
    throw new ForbiddenException('Team admin or owner access required');
  }

  private ensureMemberAccess(user: AuthUser, teamId: string) {
    if (user.role === UserRole.OWNER) return;
    if (user.role === UserRole.TEAM_ADMIN && user.primaryTeamId === teamId)
      return;

    const isTeamMember =
      user.teamId === teamId &&
      (user.role === UserRole.LEAD || user.role === UserRole.AGENT);

    if (!isTeamMember) {
      throw new ForbiddenException('Team access required');
    }
  }

  private async ensureTeam(teamId: string) {
    const team = await this.prisma.team.findUnique({ where: { id: teamId } });
    if (!team) {
      throw new NotFoundException('Team not found');
    }
  }

  /**
   * The user being added to a team (card 1.89).
   *
   * ⚠️ A DEACTIVATED ACCOUNT CANNOT BE PUT BACK ON A ROSTER. Deactivation
   * deletes the roster rows; without this check anybody could add the account
   * straight back and it would start receiving auto-assigned work again, which
   * is what made card 1.78's fix incomplete on its own.
   *
   * ⚠️ AND THIS IS WHY THE FIX BELONGS HERE RATHER THAN IN THE PICKER. Card
   * 2.2's `availableUserFilter` deliberately says nothing about `isActive`, on
   * the stated grounds that deactivation removes the roster rows - correct
   * reasoning whose premise this hole was breaking. Repairing it at the add
   * keeps that comment true; adding an isActive filter to the picker would have
   * made it a lie.
   *
   * Only `addMember` calls this, so nothing else is affected - removing a
   * deactivated member from a team does not pass through here.
   */
  private async ensureUser(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    assertUserIsActive(user, 'adding them to a team');
    return user;
  }

  private ensureEligibleTeamMemberRole(userRole: UserRole) {
    if (
      userRole === UserRole.EMPLOYEE ||
      userRole === UserRole.AGENT ||
      userRole === UserRole.LEAD ||
      userRole === UserRole.TEAM_ADMIN
    ) {
      return;
    }
    // ⚠️ CARD 1.126 §1b: THE RULE IS UNCHANGED, THE DEAD END IS NOT.
    //
    // An OWNER cannot hold a TeamMember row, and that is deliberate rather than
    // an oversight - `users.service.ts:237` nulls `primaryTeamId` when somebody
    // is promoted to OWNER, and card 1.110's exemption at
    // `tickets.service.ts:2725` records that "OWNERs have global write access
    // and aren't required to hold an explicit TeamMember record".
    //
    // ⚠️ THE TRAP IS THAT IT IS ONE-WAY AND SILENT. A TEAM_ADMIN later promoted
    // to OWNER loses their membership and can never regain it - not by their
    // own hand, not by another owner's - and the old message offered no way
    // forward at all, which is what the owner hit. It now says why, so a person
    // reading it knows there is nothing to fix.
    if (userRole === UserRole.OWNER) {
      throw new ForbiddenException(
        'Owners already have access to every team and cannot be added as a member. ' +
          'To give someone a team, set their role to team admin, lead or agent first.',
      );
    }
    throw new ForbiddenException(
      'Only employee, agent, lead, or team admin users can be added as team members',
    );
  }

  private resolveTeamRole(userRole: UserRole, requestedRole?: TeamRole) {
    const defaultTeamRole =
      userRole === UserRole.TEAM_ADMIN ? TeamRole.ADMIN : TeamRole.AGENT;
    const teamRole = requestedRole ?? defaultTeamRole;

    if (userRole === UserRole.TEAM_ADMIN && teamRole !== TeamRole.ADMIN) {
      throw new ForbiddenException('Team admin users must use ADMIN team role');
    }

    if (userRole !== UserRole.TEAM_ADMIN && teamRole === TeamRole.ADMIN) {
      throw new ForbiddenException(
        'ADMIN team role is only allowed for team admin users',
      );
    }

    if (userRole === UserRole.EMPLOYEE && teamRole !== TeamRole.AGENT) {
      throw new ForbiddenException(
        'Employees can only be promoted to AGENT when added to a team',
      );
    }

    return teamRole;
  }

  private async syncOperationalUserRole(
    tx: Prisma.TransactionClient,
    userId: string,
  ) {
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (user.role === UserRole.OWNER || user.role === UserRole.TEAM_ADMIN) {
      return;
    }

    const memberships = await tx.teamMember.findMany({
      where: { userId },
      select: { role: true },
    });

    const hasLeadMembership = memberships.some(
      (membership) => membership.role === TeamRole.LEAD,
    );
    const hasOperationalMembership = memberships.some(
      (membership) =>
        membership.role === TeamRole.LEAD ||
        membership.role === TeamRole.AGENT ||
        membership.role === TeamRole.ADMIN,
    );

    const desiredRole = hasLeadMembership
      ? UserRole.LEAD
      : hasOperationalMembership
        ? UserRole.AGENT
        : UserRole.EMPLOYEE;

    if (desiredRole === user.role) {
      return;
    }

    await tx.user.update({
      where: { id: userId },
      data: { role: desiredRole },
    });
  }

  /**
   * Refuse a slug the inbound mailbox needs (card 1.24).
   *
   * ⚠️ Checked on BOTH create and update. Only guarding create would let
   * somebody rename an existing team into the reserved space, which is the
   * same ambiguity arriving by a different door.
   */
  private assertSlugNotReserved(slug: string): void {
    if (isReservedTeamSlug(slug)) {
      throw new BadRequestException(
        'A team slug cannot begin with "ticket-": the inbound mailbox reads ' +
          'that prefix as a reply token, so mail for this department would ' +
          'be looked up as a ticket instead.',
      );
    }
  }

  private slugify(value: string) {
    return value
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)+/g, '');
  }

  /**
   * Announce an administrative change: to connected clients, and to the audit
   * trail (card 1.95).
   *
   * ⚠️ CALLED ONLY AFTER THE CHANGE HAS SUCCEEDED. Every call site sits below
   * the write it describes, so a failed change cannot leave a row claiming it
   * happened - which is the one property an audit trail has to have.
   *
   * The realtime publish stays best-effort. The audit write goes through the
   * one shared `AdminAuditService`, which logs loudly rather than throwing; see
   * the note there about why it does not fail closed.
   */
  private async safePublishAdminChanged(payload: {
    scope: string;
    action: string;
    entityId: string | null;
    teamId: string | null;
    actorId: string | null;
    actor?: AuthUser;
  }) {
    if (payload.actor) {
      await this.adminAudit.record({
        type: `${payload.scope}_${payload.action}`.toUpperCase(),
        actor: payload.actor,
        teamId: payload.teamId,
        payload: {
          scope: payload.scope,
          action: payload.action,
          entityId: payload.entityId,
        },
      });
    }
    try {
      await this.realtime.publishAdminChanged({
        scope: payload.scope,
        action: payload.action,
        entityId: payload.entityId,
        teamId: payload.teamId,
        actorId: payload.actorId,
      });
    } catch {
      // Best-effort realtime; never block team operations.
    }
  }
}
