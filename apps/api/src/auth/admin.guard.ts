import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { AuthRequest } from './current-user.decorator';

@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthRequest>();
    const user = request.user;
    const isAdmin =
      user?.role === UserRole.OWNER ||
      user?.role === UserRole.TEAM_ADMIN ||
      user?.role === UserRole.LEAD;
    if (!user || !isAdmin) {
      throw new ForbiddenException(
        'This action is restricted to owners, team administrators, and leads',
      );
    }
    return true;
  }
}
