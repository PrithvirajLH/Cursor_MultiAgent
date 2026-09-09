import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

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
  @IsOptional()
  @IsUUID()
  teamId?: string | null;
}
