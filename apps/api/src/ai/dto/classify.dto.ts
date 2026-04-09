import { IsString, IsNotEmpty, MaxLength, IsOptional, IsUUID, IsEnum } from 'class-validator';

export class ClassifyTicketDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  text!: string;

  @IsOptional()
  @IsUUID()
  userId?: string;

  @IsOptional()
  @IsEnum(['PORTAL', 'EMAIL'])
  channel?: 'PORTAL' | 'EMAIL';
}
