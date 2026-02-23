import { IsBoolean } from 'class-validator';

export class TicketTypingDto {
  @IsBoolean()
  isTyping!: boolean;
}
