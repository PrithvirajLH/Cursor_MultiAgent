import { ArrayMaxSize, ArrayMinSize, IsArray, IsUUID } from 'class-validator';
import { BULK_TICKET_LIMIT } from '../bulk-ticket-limit.const';

/** Ids only - unassigning has no target (card 2.2). */
export class BulkUnassignDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(BULK_TICKET_LIMIT)
  @IsUUID('4', { each: true })
  ticketIds!: string[];
}
