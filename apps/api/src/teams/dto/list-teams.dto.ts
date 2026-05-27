import { IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationDto } from '../../common/pagination.dto';

export class ListTeamsDto extends PaginationDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  q?: string;

  /** "true" to include deactivated teams (owner only). */
  @IsOptional()
  @IsString()
  includeInactive?: string;
}
