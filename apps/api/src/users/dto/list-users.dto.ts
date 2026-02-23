import { UserRole } from '@prisma/client';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationDto } from '../../common/pagination.dto';

const FILTERABLE_USER_ROLES = [
  UserRole.EMPLOYEE,
  UserRole.AGENT,
  UserRole.LEAD,
  UserRole.TEAM_ADMIN,
  UserRole.OWNER,
] as const;

export class ListUsersDto extends PaginationDto {
  @IsOptional()
  @IsIn(FILTERABLE_USER_ROLES)
  role?: UserRole;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  q?: string;
}
