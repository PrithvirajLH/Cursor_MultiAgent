import { TeamRole } from '@prisma/client';
import { IsEnum } from 'class-validator';

export class UpdateTeamMemberDto {
  @IsEnum(TeamRole)
  role!: TeamRole;
}
