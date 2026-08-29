import { TicketPriority } from '@prisma/client';
import {
  ArrayMaxSize,
  IsArray,
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateBy,
} from 'class-validator';

const SLUG_PATTERN = /^[a-z0-9-]+$/;
const SLUG_MESSAGE = 'must be a lowercase slug (letters, numbers and dashes)';
const MAX_CUSTOM_FIELDS = 20;
const MAX_CUSTOM_FIELD_NAME_LENGTH = 100;
const MAX_CUSTOM_FIELD_VALUE_LENGTH = 5000;

/**
 * `customFields` is a plain name → value map so a flow never handles field ids:
 * at most 20 entries, non-empty names up to 100 characters, string values up to
 * 5000. Names are matched case-insensitively by the intake service.
 */
function isValidCustomFieldMap(value: unknown): boolean {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > MAX_CUSTOM_FIELDS) {
    return false;
  }
  return entries.every(
    ([name, entry]) =>
      name.trim().length > 0 &&
      name.length <= MAX_CUSTOM_FIELD_NAME_LENGTH &&
      typeof entry === 'string' &&
      entry.length <= MAX_CUSTOM_FIELD_VALUE_LENGTH,
  );
}

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

  /** Custom field values keyed by field name, e.g. `{ "Asset Tag": "LT-4471" }`. */
  @IsOptional()
  @IsObject()
  @ValidateBy({
    name: 'validCustomFieldMap',
    validator: {
      validate(value: unknown) {
        return isValidCustomFieldMap(value);
      },
      defaultMessage() {
        return `customFields must be an object of at most ${MAX_CUSTOM_FIELDS} entries; names 1-${MAX_CUSTOM_FIELD_NAME_LENGTH} characters, values strings of at most ${MAX_CUSTOM_FIELD_VALUE_LENGTH} characters.`;
      },
    },
  })
  customFields?: Record<string, string>;
}
