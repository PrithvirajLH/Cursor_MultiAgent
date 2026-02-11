import { IsIn, IsISO8601, IsOptional } from 'class-validator';

export class TicketActivityDto {
  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;

  /** When 'assigned', count only tickets assigned to the current user. */
  @IsOptional()
  @IsIn(['assigned'])
  scope?: 'assigned';
}
