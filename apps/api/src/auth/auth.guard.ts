import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { TeamRole, UserRole } from '@prisma/client';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../prisma/prisma.service';
import { IS_PUBLIC_KEY } from './public.decorator';
import { AuthRequest } from './current-user.decorator';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthRequest>();
    const userId = request.headers['x-user-id'];
    const email = request.headers['x-user-email'];

    if (!userId && !email) {
      throw new UnauthorizedException('Missing user header');
    }

    const user = await this.prisma.user.findFirst({
      where: {
        OR: [
          typeof userId === 'string' ? { id: userId } : undefined,
          typeof email === 'string' ? { email } : undefined,
        ].filter(Boolean) as { id?: string; email?: string }[],
      },
    });

    if (!user) {
      throw new UnauthorizedException('Unknown user');
    }

    let membership =
      user.primaryTeamId != null
        ? await this.prisma.teamMember.findFirst({
            where: { userId: user.id, teamId: user.primaryTeamId },
            include: { team: true },
          })
        : null;

    if (!membership) {
      const preferredRole =
        user.role === UserRole.LEAD
          ? TeamRole.LEAD
          : user.role === UserRole.AGENT
            ? TeamRole.AGENT
            : user.role === UserRole.TEAM_ADMIN
              ? TeamRole.ADMIN
              : null;

      if (preferredRole) {
        membership = await this.prisma.teamMember.findFirst({
          where: { userId: user.id, role: preferredRole },
          include: { team: true },
          orderBy: { createdAt: 'asc' },
        });
      }
    }

    if (!membership) {
      membership = await this.prisma.teamMember.findFirst({
        where: { userId: user.id },
        include: { team: true },
        orderBy: { createdAt: 'asc' },
      });
    }

    const resolvedTeamId = membership?.teamId ?? user.primaryTeamId ?? null;

    request.user = {
      id: user.id,
      email: user.email,
      role: user.role,
      teamId: resolvedTeamId,
      teamRole: membership?.role ?? null,
      primaryTeamId: user.primaryTeamId ?? null,
    };

    return true;
  }
}
