import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { AuthRequest } from './current-user.decorator';

/**
 * Restricts access to TEAM_ADMIN and OWNER only (no LEAD).
 * Use for automation rules and other team-admin-or-owner-only features.
 */
@Injectable()
export class TeamAdminOrOwnerGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthRequest>();
    const user = request.user;
    const allowed =
      user?.role === UserRole.OWNER || user?.role === UserRole.TEAM_ADMIN;
    if (!user || !allowed) {
      throw new ForbiddenException(
        'This action is restricted to owners and team administrators',
      );
    }
    return true;
  }
}
