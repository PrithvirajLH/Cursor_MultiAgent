import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class CreateCannedResponseDto {
  @IsString()
  @MaxLength(120)
  name!: string;

  @IsString()
  @MaxLength(10000)
  content!: string;

  @IsOptional()
  @IsUUID()
  teamId?: string;
}
