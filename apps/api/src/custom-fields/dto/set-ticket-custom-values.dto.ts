import {
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CustomFieldValueItemDto {
  @IsUUID()
  customFieldId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  value?: string | null;
}

export class SetTicketCustomValuesDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CustomFieldValueItemDto)
  values!: CustomFieldValueItemDto[];
}
