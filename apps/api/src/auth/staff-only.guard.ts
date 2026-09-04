import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { isStaffRole } from '../notifications/is-staff-role.util';
import { AuthRequest } from './current-user.decorator';

/**
 * Anyone who works in the app, as opposed to somebody who raises tickets in it.
 *
 * Sits one rung below `LeadOrAdminGuard`: that one is OWNER / TEAM_ADMIN / LEAD,
 * this one adds AGENT and excludes only EMPLOYEE. Card 1.7b needed it because
 * making a template is ordinary agent work, while an EMPLOYEE creating macros is
 * not intended.
 *
 * Reuses card 1.42's `isStaffRole` rather than listing roles again - that is the
 * one place this system decides who counts as staff, and a second list would
 * drift the moment a role is added.
 */
@Injectable()
export class StaffOnlyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthRequest>();
    const user = request.user;
    if (!user || !isStaffRole(user.role)) {
      throw new ForbiddenException(
        'This action is restricted to agents and above',
      );
    }
    return true;
  }
}
