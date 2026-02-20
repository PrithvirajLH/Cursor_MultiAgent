import { TicketStatus } from '@prisma/client';
import {
  IsArray,
  IsEnum,
  ArrayMinSize,
  ArrayMaxSize,
  IsUUID,
} from 'class-validator';

export class BulkStatusDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsUUID('4', { each: true })
  ticketIds!: string[];

  @IsEnum(TicketStatus)
  status!: TicketStatus;
}
