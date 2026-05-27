import { IsIn, IsString, MaxLength } from 'class-validator';

/** Ticket attributes a routing condition can test. */
export const ROUTING_CONDITION_FIELDS = [
  'subject',
  'message',
  'priority',
  'category',
  'channel',
  'sender',
] as const;
export type RoutingConditionField = (typeof ROUTING_CONDITION_FIELDS)[number];

export const ROUTING_CONDITION_OPS = [
  'contains',
  'not_contains',
  'is',
  'is_not',
] as const;
export type RoutingConditionOp = (typeof ROUTING_CONDITION_OPS)[number];

export const ROUTING_ACTION_TYPES = [
  'assign_team',
  'assign_member',
  'set_priority',
  'add_tag',
] as const;
export type RoutingActionType = (typeof ROUTING_ACTION_TYPES)[number];

export const ROUTING_MATCH_TYPES = ['ALL', 'ANY'] as const;
export type RoutingMatchType = (typeof ROUTING_MATCH_TYPES)[number];

export class RoutingConditionDto {
  @IsIn(ROUTING_CONDITION_FIELDS)
  field!: RoutingConditionField;

  @IsIn(ROUTING_CONDITION_OPS)
  op!: RoutingConditionOp;

  @IsString()
  @MaxLength(200)
  value!: string;
}

export class RoutingActionDto {
  @IsIn(ROUTING_ACTION_TYPES)
  type!: RoutingActionType;

  @IsString()
  @MaxLength(200)
  value!: string;
}
