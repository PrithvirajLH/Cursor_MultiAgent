import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { SAVED_VIEW_TYPES } from '../saved-view-type.const';

function toBoolean(value: unknown): boolean | undefined {
  if (value === undefined || value === null) return undefined;
  return value === true || value === 'true';
}

export class CreateSavedViewDto {
  @IsString()
  @MaxLength(120)
  name!: string;

  @IsObject()
  filters!: Record<string, unknown>;

  @IsOptional()
  @Transform(({ value }) => toBoolean(value))
  @IsBoolean()
  isDefault?: boolean;

  /**
   * Which kind of view this is (card 1.60).
   *
   * ⚠️ A FIELD, NOT A KEY IN `filters`. The Reports page used to write
   * `viewType: "reports"` into the filters blob, which made the discriminator
   * invisible to SQL - and one default per user could therefore not be scoped
   * per kind without a 500. Migration 61 moved it to a column and stripped the
   * key; sending it inside `filters` now does nothing.
   */
  @IsOptional()
  @IsIn(SAVED_VIEW_TYPES)
  viewType?: (typeof SAVED_VIEW_TYPES)[number];

  @IsOptional()
  @IsUUID()
  teamId?: string;
}
