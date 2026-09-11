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

export class UpdateSavedViewDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsObject()
  filters?: Record<string, unknown>;

  @IsOptional()
  @Transform(({ value }) => toBoolean(value))
  @IsBoolean()
  isDefault?: boolean;

  /**
   * Promote a personal view to the team, or demote it back with `null`.
   *
   * ⚠️ `undefined` means "leave it alone" and `null` means "make it personal" -
   * they are NOT the same, which is why the service checks for `undefined`
   * explicitly. Without that distinction an ordinary rename would silently
   * demote a team view.
   */
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
  teamId?: string | null;
}
