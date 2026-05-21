import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Request } from 'express';

export type AuthUser = {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
  teamId?: string | null;
  teamName?: string | null;
  teamRole?: string | null;
  /** For TEAM_ADMIN: the team they administer (primary team). */
  primaryTeamId?: string | null;
  /** All teams this user belongs to (Ticket visibility uses this for AGENT/LEAD). */
  memberTeamIds?: string[];
};

export type AuthRequest = Request & { user?: AuthUser };

export const CurrentUser = createParamDecorator(
  (data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<AuthRequest>();
    return request.user;
  },
);
