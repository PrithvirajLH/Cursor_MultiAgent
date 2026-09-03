import {
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

/** Editable text fields of a ticket. Status, priority, category and assignment have their own endpoints. */
export class UpdateTicketDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  @MaxLength(200)
  subject?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  @MaxLength(5000)
  description?: string;

  /**
   * "Remind me Friday" (card 1.10). An ISO timestamp, or null to clear it.
   *
   * Set through this existing PATCH rather than an endpoint of its own, so it
   * inherits the same access control as every other edit.
   */
  @IsOptional()
  @ValidateIf((_object: unknown, value: unknown) => value !== null)
  @IsISO8601()
  followUpAt?: string | null;
}
