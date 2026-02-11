import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateBy,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  AutomationConditionDto,
  AutomationActionDto,
  isValidConditionNode,
} from './create-automation-rule.dto';

const VALID_TRIGGERS = [
  'TICKET_CREATED',
  'STATUS_CHANGED',
  'SLA_APPROACHING',
  'SLA_BREACHED',
] as const;

export class UpdateAutomationRuleDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsString()
  @IsIn(VALID_TRIGGERS)
  trigger?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1, { message: 'At least one condition is required when provided.' })
  @ValidateBy({
    name: 'validConditionNodes',
    validator: {
      validate(value: unknown) {
        if (value == null || !Array.isArray(value)) return true;
        if (value.length === 0) return false;
        return value.every(isValidConditionNode);
      },
      defaultMessage() {
        return 'Each condition must be either a leaf (field + operator) or an and/or group with at least one valid child; children are validated recursively.';
      },
    },
  })
  @ValidateNested({ each: true })
  @Type(() => AutomationConditionDto)
  conditions?: AutomationConditionDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AutomationActionDto)
  actions?: AutomationActionDto[];

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsInt()
  priority?: number;

  @IsOptional()
  @IsUUID()
  teamId?: string;
}
