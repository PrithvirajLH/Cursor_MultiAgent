import { TicketStatus } from '@prisma/client';
import { IsEnum } from 'class-validator';

export class TransitionTicketDto {
  @IsEnum(TicketStatus)
  status!: TicketStatus;
}
