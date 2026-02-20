import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  ValidateNested,
} from 'class-validator';

const WEEK_DAYS = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
] as const;

const HH_MM = /^([01]\d|2[0-3]):([0-5]\d)$/;
const YYYY_MM_DD = /^\d{4}-\d{2}-\d{2}$/;

export class SlaBusinessDayDto {
  @IsIn(WEEK_DAYS)
  day!: (typeof WEEK_DAYS)[number];

  @IsString()
  @Matches(HH_MM)
  start!: string;

  @IsString()
  @Matches(HH_MM)
  end!: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class SlaHolidayDto {
  @IsString()
  name!: string;

  @IsString()
  @Matches(YYYY_MM_DD)
  date!: string;
}

export class UpdateSlaBusinessHoursDto {
  @IsOptional()
  @IsString()
  timezone?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(7)
  @ValidateNested({ each: true })
  @Type(() => SlaBusinessDayDto)
  schedule?: SlaBusinessDayDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(400)
  @ValidateNested({ each: true })
  @Type(() => SlaHolidayDto)
  holidays?: SlaHolidayDto[];
}
