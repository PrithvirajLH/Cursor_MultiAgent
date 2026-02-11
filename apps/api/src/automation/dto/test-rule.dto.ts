import { IsOptional, IsUUID } from 'class-validator';

export class TestRuleDto {
  /** Run rule against this ticket (loads ticket from DB). */
  @IsOptional()
  @IsUUID()
  ticketId?: string;
}
