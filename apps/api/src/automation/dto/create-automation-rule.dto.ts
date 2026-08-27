import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEmail,
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
  'gte',
] as const;

/** All triggers, event-based and time-based (card 1.3 added the last two). */
export const AUTOMATION_TRIGGERS = [
  'TICKET_CREATED',
  'STATUS_CHANGED',
  'SLA_APPROACHING',
  'SLA_BREACHED',
  'TIME_IN_STATUS',
  'UNASSIGNED_FOR',
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
  'notify_requester',
  'add_internal_note',
  'add_tag',
  'remove_tag',
  'set_category',
  'add_follower',
  'send_email',
] as const;

const MAX_TAGS_PER_ACTION = 5;
const MAX_TAG_LENGTH = 40;
const MAX_EMAIL_SUBJECT_LENGTH = 200;
const FOLLOWER_TARGETS = ['requester', 'assignee'] as const;
const EMAIL_RECIPIENTS = [
  'requester',
  'assignee',
  'team_leads',
  'address',
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
  @IsIn(['SEV1', 'SEV2', 'SEV3', 'SEV4'])
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

  /** add_tag / remove_tag: 1–5 tag names. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_TAGS_PER_ACTION)
  @IsString({ each: true })
  @MaxLength(MAX_TAG_LENGTH, { each: true })
  tags?: string[];

  /** set_category */
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  /** add_follower: who to add when no explicit userId is given. */
  @IsOptional()
  @IsIn(FOLLOWER_TARGETS)
  target?: string;

  /** send_email: recipient selector. */
  @IsOptional()
  @IsIn(EMAIL_RECIPIENTS)
  to?: string;

  /** send_email: external address, only when to === 'address'. */
  @IsOptional()
  @IsEmail()
  address?: string;

  /** send_email: subject line; {{ticket.displayId}} etc. are filled at run time. */
  @IsOptional()
  @IsString()
  @MaxLength(MAX_EMAIL_SUBJECT_LENGTH)
  subject?: string;
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
  @IsIn(AUTOMATION_TRIGGERS)
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
