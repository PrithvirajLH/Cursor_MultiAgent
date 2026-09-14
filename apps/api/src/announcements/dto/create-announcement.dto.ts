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

/** A new announcement (card 2.7). */
export class CreateAnnouncementDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  title!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  body!: string;

  @IsOptional()
  @IsEnum(AnnouncementSeverity)
  severity?: AnnouncementSeverity;

  @IsOptional()
  @IsEnum(AnnouncementAudience)
  audience?: AnnouncementAudience;

  /**
   * Required when the audience is TEAM, and refused otherwise — the service
   * enforces both, because no validator can express "required only for one
   * value of another field" without the two rules drifting apart.
   */
  @IsOptional()
  @IsUUID()
  teamId?: string;

  @IsOptional()
  @IsUUID()
  linkedTicketId?: string;

  /** Defaults to now, so "post this" needs no date arithmetic from the admin. */
  @IsOptional()
  @IsISO8601()
  startsAt?: string;

  /** Null or absent means "until I say otherwise". */
  @IsOptional()
  @ValidateIf((_object, value) => value !== null)
  @IsISO8601()
  endsAt?: string | null;
}
