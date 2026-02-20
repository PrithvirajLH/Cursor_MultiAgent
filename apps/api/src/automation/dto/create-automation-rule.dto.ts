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

const CONDITION_OPERATORS = [
  'contains',
  'equals',
  'notEquals',
  'in',
  'notIn',
  'isEmpty',
  'isNotEmpty',
] as const;

/**
 * Recursive condition-node validator: leaf must have field+operator; and/or group must have
 * non-empty array and every child valid. Rejects mixed nodes (both group and leaf) and empty/invalid children.
 */
export function isValidConditionNode(obj: unknown): boolean {
  if (obj == null || typeof obj !== 'object') return false;
  const o = obj as Record<string, unknown>;
  const hasAnd = o.and != null;
  const hasOr = o.or != null;
  const hasLeaf =
    typeof o.field === 'string' &&
    o.field.length > 0 &&
    typeof o.operator === 'string' &&
    o.operator.length > 0;

  if (hasAnd && hasOr) return false;
  if ((hasAnd || hasOr) && hasLeaf) return false;
  if (hasAnd) {
    if (!Array.isArray(o.and) || o.and.length === 0) return false;
    return (o.and as unknown[]).every((child) => isValidConditionNode(child));
  }
  if (hasOr) {
    if (!Array.isArray(o.or) || o.or.length === 0) return false;
    return (o.or as unknown[]).every((child) => isValidConditionNode(child));
  }
  if (hasLeaf) return true;
  return false;
}

/** Single condition: field + operator + value, or and/or group with non-empty arrays */
export class AutomationConditionDto {
  @IsOptional()
  @IsString()
  field?: string;

  @IsOptional()
  @IsString()
  @IsIn(CONDITION_OPERATORS)
  operator?: string;

  @IsOptional()
  value?: unknown;

  /** For AND/OR groups */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AutomationConditionDto)
  and?: AutomationConditionDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AutomationConditionDto)
  or?: AutomationConditionDto[];
}

const ACTION_TYPES = [
  'assign_team',
  'assign_user',
  'set_priority',
  'set_status',
  'notify_team_lead',
  'add_internal_note',
] as const;

/** Single action: type + params */
export class AutomationActionDto {
  @IsString()
  @IsIn(ACTION_TYPES)
  type!: string;

  @IsOptional()
  @IsUUID()
  teamId?: string;

  @IsOptional()
  @IsUUID()
  userId?: string;

  @IsOptional()
  @IsString()
  @IsIn(['P1', 'P2', 'P3', 'P4'])
  priority?: string;

  @IsOptional()
  @IsString()
  @IsIn([
    'NEW',
    'TRIAGED',
    'ASSIGNED',
    'IN_PROGRESS',
    'WAITING_ON_REQUESTER',
    'WAITING_ON_VENDOR',
    'RESOLVED',
    'CLOSED',
    'REOPENED',
  ])
  status?: string;

  @IsOptional()
  @IsString()
  body?: string;
}

export class CreateAutomationRuleDto {
  @IsString()
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsString()
  @IsIn(['TICKET_CREATED', 'STATUS_CHANGED', 'SLA_APPROACHING', 'SLA_BREACHED'])
  trigger!: string;

  @IsArray()
  @ArrayMinSize(1, { message: 'At least one condition is required.' })
  @ValidateBy({
    name: 'validConditionNodes',
    validator: {
      validate(value: unknown) {
        if (!Array.isArray(value)) return false;
        return value.every(isValidConditionNode);
      },
      defaultMessage() {
        return 'Each condition must be either a leaf (field + operator) or an and/or group with at least one valid child; children are validated recursively.';
      },
    },
  })
  @ValidateNested({ each: true })
  @Type(() => AutomationConditionDto)
  conditions!: AutomationConditionDto[];

  @IsArray()
  @ArrayMinSize(1, { message: 'At least one action is required.' })
  @ValidateNested({ each: true })
  @Type(() => AutomationActionDto)
  actions!: AutomationActionDto[];

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
