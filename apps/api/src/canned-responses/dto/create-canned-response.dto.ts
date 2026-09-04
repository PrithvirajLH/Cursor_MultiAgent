import {
  ArrayMaxSize,
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { AutomationActionDto } from '../../automation/dto/create-automation-rule.dto';

/** How many actions one macro may carry. A macro is a shortcut, not a workflow. */
const MAX_MACRO_ACTIONS = 10;

export class CreateCannedResponseDto {
  @IsString()
  @MaxLength(120)
  name!: string;

  @IsString()
  @MaxLength(10000)
  content!: string;

  /**
   * What applying this macro DOES (card 1.7).
   *
   * Validated with `AutomationActionDto` - the rule engine's own class - so a
   * macro and a rule can never drift into two action shapes. That class accepts
   * all twelve action types; the MACRO subset is enforced separately in the
   * service, against MACRO_ALLOWED_ACTIONS, because it is a policy rather than
   * a shape and it has to hold on execute as well as on save.
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_MACRO_ACTIONS)
  @ValidateNested({ each: true })
  @Type(() => AutomationActionDto)
  actions?: AutomationActionDto[];

  @IsOptional()
  @IsUUID()
  teamId?: string;
}
