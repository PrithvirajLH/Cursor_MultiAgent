import { IsBoolean } from 'class-validator';

/** Cloned from TicketTypingDto (card 1.9). */
export class TicketViewingDto {
  @IsBoolean()
  isViewing!: boolean;
}
