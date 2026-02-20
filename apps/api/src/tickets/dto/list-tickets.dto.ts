import { TicketPriority, TicketStatus } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { PaginationDto } from '../../common/pagination.dto';

const STATUS_GROUPS = ['open', 'resolved', 'all'] as const;
const SORT_FIELDS = ['createdAt', 'completedAt', 'updatedAt'] as const;
const SORT_ORDER = ['asc', 'desc'] as const;
const SCOPES = ['all', 'assigned', 'unassigned', 'created'] as const;
const SLA_STATUSES = ['on_track', 'at_risk', 'breached'] as const;

function splitStrings(value: unknown): string[] | undefined {
  if (value == null) return undefined;
  if (Array.isArray(value)) return value.filter((v) => typeof v === 'string');
  if (typeof value === 'string')
    return value
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  return undefined;
}

export class ListTicketsDto extends PaginationDto {
  @IsOptional()
  @IsEnum(TicketStatus)
  status?: TicketStatus;

  @IsOptional()
  @Transform(({ value }) => splitStrings(value))
  @IsArray()
  @IsEnum(TicketStatus, { each: true })
  statuses?: TicketStatus[];

  @IsOptional()
  @IsIn(STATUS_GROUPS)
  statusGroup?: (typeof STATUS_GROUPS)[number];

  @IsOptional()
  @IsIn(SCOPES)
  scope?: (typeof SCOPES)[number];

  @IsOptional()
  @IsEnum(TicketPriority)
  priority?: TicketPriority;

  @IsOptional()
  @Transform(({ value }) => splitStrings(value))
  @IsArray()
  @IsEnum(TicketPriority, { each: true })
  priorities?: TicketPriority[];

  @IsOptional()
  @IsUUID()
  teamId?: string;

  @IsOptional()
  @Transform(({ value }) => splitStrings(value))
  @IsArray()
  @IsUUID('4', { each: true })
  teamIds?: string[];

  @IsOptional()
  @IsUUID()
  assigneeId?: string;

  @IsOptional()
  @Transform(({ value }) => splitStrings(value))
  @IsArray()
  @IsUUID('4', { each: true })
  assigneeIds?: string[];

  @IsOptional()
  @IsUUID()
  requesterId?: string;

  @IsOptional()
  @Transform(({ value }) => splitStrings(value))
  @IsArray()
  @IsUUID('4', { each: true })
  requesterIds?: string[];

  @IsOptional()
  @Transform(({ value }) => splitStrings(value))
  @IsArray()
  @IsIn(SLA_STATUSES, { each: true })
  slaStatus?: (typeof SLA_STATUSES)[number][];

  @IsOptional()
  @IsISO8601()
  createdFrom?: string;

  @IsOptional()
  @IsISO8601()
  createdTo?: string;

  @IsOptional()
  @IsISO8601()
  updatedFrom?: string;

  @IsOptional()
  @IsISO8601()
  updatedTo?: string;

  @IsOptional()
  @IsISO8601()
  dueFrom?: string;

  @IsOptional()
  @IsISO8601()
  dueTo?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;

  @IsOptional()
  @IsIn(SORT_FIELDS)
  sort?: (typeof SORT_FIELDS)[number];

  @IsOptional()
  @IsIn(SORT_ORDER)
  order?: (typeof SORT_ORDER)[number];
}
