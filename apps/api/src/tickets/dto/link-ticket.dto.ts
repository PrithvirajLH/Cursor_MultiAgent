import { IsEnum, IsUUID } from 'class-validator';
import { TicketLinkType } from '@prisma/client';

/** Body of `POST /api/tickets/:id/links` (card 1.6). */
export class LinkTicketDto {
  @IsUUID()
  toTicketId!: string;

  @IsEnum(TicketLinkType)
  type!: TicketLinkType;
}
