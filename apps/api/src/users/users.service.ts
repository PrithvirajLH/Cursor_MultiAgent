import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import { AuthUser } from '../auth/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { ListUsersDto } from './dto/list-users.dto';
import { UpdateUserRoleDto } from './dto/update-user-role.dto';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: ListUsersDto, actor: AuthUser) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const skip = (page - 1) * pageSize;

    const queryWhere: Prisma.UserWhereInput = {
      role: query.role,
      OR: query.q
        ? [
            {
              displayName: { contains: query.q, mode: 'insensitive' as const },
            },
            { email: { contains: query.q, mode: 'insensitive' as const } },
          ]
        : undefined,
    };
    const scopeWhere = this.buildListScopeWhere(actor);
    const where: Prisma.UserWhereInput = {
      AND: [queryWhere, scopeWhere],
    };

    const [total, data] = await Promise.all([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { displayName: 'asc' },
        select: {
          id: true,
          email: true,
          displayName: true,
          role: true,
          department: true,
          location: true,
          primaryTeamId: true,
          createdAt: true,
          updatedAt: true,
        },
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

  private buildListScopeWhere(actor: AuthUser): Prisma.UserWhereInput {
    if (actor.role === UserRole.OWNER) {
      return {};
    }

    if (actor.role === UserRole.TEAM_ADMIN) {
      if (!actor.primaryTeamId) {
        throw new ForbiddenException(
          'Team administrator must have a primary team set',
        );
      }
      const teamId = actor.primaryTeamId;
      return {
        OR: [
          { id: actor.id },
          { primaryTeamId: teamId },
          { teamMemberships: { some: { teamId } } },
        ],
      };
    }

    if (actor.role === UserRole.LEAD || actor.role === UserRole.AGENT) {
      if (!actor.teamId) {
        throw new ForbiddenException('User is not assigned to a team');
      }
      const teamId = actor.teamId;
      return {
        OR: [{ id: actor.id }, { teamMemberships: { some: { teamId } } }],
      };
    }

    throw new ForbiddenException('Only support roles can list users');
  }

  async updateRole(
    userId: string,
    payload: UpdateUserRoleDto,
    actor: AuthUser,
  ) {
    if (actor.role !== UserRole.OWNER) {
      throw new ForbiddenException('Only owners can update user roles');
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (payload.role === UserRole.TEAM_ADMIN) {
      const teamId = payload.primaryTeamId ?? user.primaryTeamId;
      if (!teamId) {
        throw new BadRequestException('TEAM_ADMIN role requires primaryTeamId');
      }
      const team = await this.prisma.team.findUnique({ where: { id: teamId } });
      if (!team) {
        throw new BadRequestException('Primary team not found');
      }
      return this.prisma.user.update({
        where: { id: userId },
        data: { role: payload.role, primaryTeamId: teamId },
      });
    }

    const primaryTeamId =
      payload.role === UserRole.OWNER ? null : (payload.primaryTeamId ?? null);

    return this.prisma.user.update({
      where: { id: userId },
      data: { role: payload.role, primaryTeamId },
    });
  }
}
