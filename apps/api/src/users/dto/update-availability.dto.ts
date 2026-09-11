import { IsBoolean, IsISO8601, IsOptional, ValidateIf } from 'class-validator';

/** Card 2.2: the caller's own availability. There is no user id — it is always self. */
export class UpdateAvailabilityDto {
  @IsBoolean()
  isAvailable!: boolean;

  /**
   * The date they are back. Null or absent means away with no end in sight,
   * which no date could express — see `available-user-filter.util.ts`.
   */
  @IsOptional()
  @ValidateIf((_object, value) => value !== null)
  @IsISO8601()
  awayUntil?: string | null;
}
