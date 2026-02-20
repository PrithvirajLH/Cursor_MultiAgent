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

  @IsOptional()
  @IsUUID()
  teamId?: string;
}
