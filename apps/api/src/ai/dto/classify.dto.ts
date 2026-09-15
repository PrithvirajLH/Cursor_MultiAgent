import { IsString, IsNotEmpty, MaxLength, IsOptional, IsEnum } from 'class-validator';

/**
 * ⚠️ CARD 1.85: THERE IS DELIBERATELY NO `userId` HERE.
 *
 * It used to be accepted and won over the signed-in user
 * (`dto.userId ?? user.id`), so anybody could file a ticket as somebody else
 * and have the pipeline read that person's profile and history. No caller ever
 * sent it - the portal calls `classifyTicket({ text })` - so removing it costs
 * nothing and closes the hole at the edge, before any of it reaches a prompt.
 */
export class ClassifyTicketDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  text!: string;

  @IsOptional()
  @IsEnum(['PORTAL', 'EMAIL'])
  channel?: 'PORTAL' | 'EMAIL';
}
