import { UserRole } from '@prisma/client';
import { IsIn, IsOptional, IsUUID } from 'class-validator';

const ASSIGNABLE_USER_ROLES = [
  UserRole.EMPLOYEE,
  UserRole.AGENT,
  UserRole.LEAD,
  UserRole.TEAM_ADMIN,
  UserRole.OWNER,
] as const;

export class UpdateUserRoleDto {
  @IsIn(ASSIGNABLE_USER_ROLES)
  role!: UserRole;

  @IsOptional()
  @IsUUID()
  primaryTeamId?: string | null;
}
