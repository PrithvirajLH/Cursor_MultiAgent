import { IsISO8601, IsOptional, IsString, IsUUID } from 'class-validator';

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
  page?: string;

  @IsOptional()
  pageSize?: string;
}
