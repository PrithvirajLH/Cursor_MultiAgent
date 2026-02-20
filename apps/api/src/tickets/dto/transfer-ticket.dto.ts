import { IsOptional, IsUUID } from 'class-validator';

export class TransferTicketDto {
  @IsUUID()
  newTeamId!: string;

  @IsOptional()
  @IsUUID()
  assigneeId?: string;
}
