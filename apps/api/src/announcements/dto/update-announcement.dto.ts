import { AnnouncementAudience, AnnouncementSeverity } from '@prisma/client';
import {
  IsEnum,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

/**
 * Edit an announcement (card 2.7).
 *
 * Hand-written rather than a `PartialType` of the create shape: this repo has no
 * `@nestjs/mapped-types` dependency and every other module writes the pair out
 * (see `update-canned-response.dto.ts`). Adding a package for four fields is not
 * worth the drift with the house pattern.
 *
 * ⚠️ "Ending" an announcement early is a PATCH setting `endsAt` to now, NOT a
 * delete. What was announced during an outage is worth keeping.
 */
export class UpdateAnnouncementDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  title?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  body?: string;

  @IsOptional()
  @IsEnum(AnnouncementSeverity)
  severity?: AnnouncementSeverity;

  @IsOptional()
  @IsEnum(AnnouncementAudience)
  audience?: AnnouncementAudience;

  @IsOptional()
  @IsUUID()
  teamId?: string | null;

  @IsOptional()
  @IsUUID()
  linkedTicketId?: string | null;

  @IsOptional()
  @IsISO8601()
  startsAt?: string;

  /**
   * Three meanings, as in `UpdateCannedResponseDto.teamId`:
   *   omitted -> leave the end date alone
   *   a date  -> ends then
   *   null    -> runs until somebody says otherwise
   */
  @IsOptional()
  @ValidateIf((_object, value) => value !== null)
  @IsISO8601()
  endsAt?: string | null;
}
