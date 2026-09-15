import { ArrayNotEmpty, IsArray, IsString, MaxLength } from 'class-validator';

/** What an owner supplies to register a webhook destination (card 2.6). */
export class CreateWebhookSubscriptionDto {
  /**
   * The destination. Validated for shape here and again at connect time —
   * https only, and never an address inside the private network.
   */
  @IsString()
  @MaxLength(2000)
  url!: string;

  /** Which events to deliver. Unknown names are refused rather than ignored. */
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  events!: string[];
}
