import { IsOptional, IsString, MaxLength } from 'class-validator';

export class DeleteTicketDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
