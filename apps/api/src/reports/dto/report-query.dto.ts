import { TicketChannel, TicketPriority, TicketStatus } from '@prisma/client';
import {
  IsEnum,
  IsIn,
  IsISO8601,
  IsOptional,
  IsUUID,
  Validate,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

/** Maximum allowed date range for report queries (in days). */
const MAX_REPORT_RANGE_DAYS = 365;

@ValidatorConstraint({ name: 'dateRangeLimit', async: false })
class DateRangeLimitConstraint implements ValidatorConstraintInterface {
  validate(_value: unknown, args: ValidationArguments): boolean {
    const obj = args.object as { from?: string; to?: string };
    if (!obj.from || !obj.to) return true;
    const fromDate = new Date(obj.from);
    const toDate = new Date(obj.to);
    if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime()))
      return true;
    const diffMs = toDate.getTime() - fromDate.getTime();
    return diffMs >= 0 && diffMs <= MAX_REPORT_RANGE_DAYS * 24 * 60 * 60 * 1000;
  }

  defaultMessage(): string {
    return `Date range must not exceed ${MAX_REPORT_RANGE_DAYS} days and "to" must be after "from".`;
  }
}

export class ReportQueryDto {
  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
  @Validate(DateRangeLimitConstraint)
  to?: string;

  @IsOptional()
  @IsUUID()
  teamId?: string;

  @IsOptional()
  @IsEnum(TicketPriority)
  priority?: TicketPriority;

  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @IsOptional()
  @IsEnum(TicketChannel)
  channel?: TicketChannel;

  @IsOptional()
  @IsEnum(TicketStatus)
  status?: TicketStatus;

  @IsOptional()
  @IsUUID()
  assigneeId?: string;

  @IsOptional()
  @IsIn(['assigned'])
  scope?: 'assigned';

  @IsOptional()
  @IsIn(['createdAt', 'updatedAt'])
  dateField?: 'createdAt' | 'updatedAt';

  @IsOptional()
  @IsIn(['open', 'resolved', 'all'])
  statusGroup?: 'open' | 'resolved' | 'all';
}

export class ResolutionTimeQueryDto extends ReportQueryDto {
  @IsOptional()
  @IsIn(['team', 'priority'])
  groupBy?: 'team' | 'priority';
}
