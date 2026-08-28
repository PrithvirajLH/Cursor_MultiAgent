import { TicketPriority } from '@prisma/client';
import {
  ArrayMaxSize,
  IsArray,
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

const SLUG_PATTERN = /^[a-z0-9-]+$/;
const SLUG_MESSAGE = 'must be a lowercase slug (letters, numbers and dashes)';

/**
 * Body of `POST /api/tickets/intake` — the integration entry point used by
 * Power Automate (card 1.19). `department` and `category` are Team/Category
 * slugs so a flow never handles internal ids; omitting `department` leaves the
 * routing rules in charge, exactly as the portal does.
 */
export class CreateIntakeTicketDto {
  @IsEmail()
  requesterEmail!: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  requesterName?: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  @MaxLength(200)
  subject!: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  @MaxLength(5000)
  description!: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  @Matches(SLUG_PATTERN, { message: `department ${SLUG_MESSAGE}` })
  department?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  @Matches(SLUG_PATTERN, { message: `category ${SLUG_MESSAGE}` })
  category?: string;

  @IsOptional()
  @IsEnum(TicketPriority)
  priority?: TicketPriority;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  tags?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(120)
  sourceRef?: string;
}
