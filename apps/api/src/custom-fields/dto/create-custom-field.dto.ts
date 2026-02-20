import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';

const CUSTOM_FIELD_TYPES = [
  'TEXT',
  'TEXTAREA',
  'NUMBER',
  'DROPDOWN',
  'MULTISELECT',
  'DATE',
  'CHECKBOX',
  'USER',
] as const;

export class CreateCustomFieldDto {
  @IsString()
  @MaxLength(80)
  name!: string;

  @IsString()
  @MaxLength(32)
  @IsIn(CUSTOM_FIELD_TYPES)
  fieldType!: string; // TEXT, TEXTAREA, NUMBER, DROPDOWN, MULTISELECT, DATE, CHECKBOX, USER

  @IsOptional()
  options?: unknown; // [{ value, label }] for DROPDOWN/MULTISELECT

  @IsOptional()
  @IsBoolean()
  isRequired?: boolean;

  @IsOptional()
  @IsUUID()
  teamId?: string;

  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}
