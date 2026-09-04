import {
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { AutomationActionDto } from '../../automation/dto/create-automation-rule.dto';

export class UpdateCannedResponseDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10000)
  content?: string;

  /**
   * Move the template between private and shared (card 1.7b, second pass).
   *
   * Three distinct meanings, and they matter:
   *   omitted  -> leave the sharing exactly as it is
   *   a teamId -> share with that team, which must be the caller's own
   *   null     -> make it private again
   *
   * `@IsOptional` skips validation for null as well as undefined, which is what
   * lets an explicit null through to mean "unshare". The service tells the two
   * apart with `!== undefined`.
   */
  @IsOptional()
  @IsUUID()
  teamId?: string | null;

  /** See CreateCannedResponseDto.actions. The allowlist is checked on save. */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AutomationActionDto)
  actions?: AutomationActionDto[];
}
