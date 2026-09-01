import { IsEmail, MaxLength } from 'class-validator';

/** The one address an owner is un-suppressing (card 1.23). */
export class ClearEmailSuppressionDto {
  @IsEmail()
  @MaxLength(320)
  address!: string;
}
