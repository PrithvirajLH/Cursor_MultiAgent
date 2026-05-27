import { IsIn, IsISO8601, IsOptional, IsString, IsUUID } from 'class-validator';

export const AUDIT_CATEGORIES = [
  'tickets',
  'routing',
  'sla',
  'automation',
  'custom_fields',
  'ai',
] as const;

export class ListAuditLogDto {
  @IsOptional()
  @IsISO8601()
  dateFrom?: string;

  @IsOptional()
  @IsISO8601()
  dateTo?: string;

  @IsOptional()
  @IsUUID()
  userId?: string;

  @IsOptional()
  @IsString()
  type?: string;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsIn(AUDIT_CATEGORIES)
  category?: string;

  @IsOptional()
  page?: string;

  @IsOptional()
  pageSize?: string;
}
