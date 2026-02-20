import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Request } from 'express';

export type AuthUser = {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
  teamId?: string | null;
  teamRole?: string | null;
  /** For TEAM_ADMIN: the team they administer (primary team). */
  primaryTeamId?: string | null;
};

export type AuthRequest = Request & { user?: AuthUser };

export const CurrentUser = createParamDecorator(
  (data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<AuthRequest>();
    return request.user;
  },
);
