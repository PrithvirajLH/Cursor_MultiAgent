import {
  IsArray,
  IsOptional,
  IsUUID,
  ArrayMinSize,
  ArrayMaxSize,
} from 'class-validator';

export class BulkTransferDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsUUID('4', { each: true })
  ticketIds!: string[];

  @IsUUID()
  newTeamId!: string;

  @IsOptional()
  @IsUUID()
  assigneeId?: string;
}
