import { ArrayMaxSize, ArrayMinSize, IsArray, IsUUID } from 'class-validator';

/**
 * Apply one macro's ACTIONS to several tickets (card 1.12).
 *
 * ⚠️ There is deliberately no message here, and no field that could carry one.
 * Card 1.7 has a macro hand its text back to the composer rather than sending
 * it, because the composer is the only path that enforces card 1.36's read
 * rules, card 1.38's public/internal pin, card 1.40's reply audience and card
 * 1.42's email policy. Twenty tickets have no composer, so bulk applies the
 * actions and nothing else - not by re-checking those rules, but by having no
 * send path to get them wrong.
 */
export class BulkMacroDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsUUID('4', { each: true })
  ticketIds!: string[];

  @IsUUID()
  cannedResponseId!: string;
}
