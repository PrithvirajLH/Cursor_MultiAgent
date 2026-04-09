import { IsString, IsNotEmpty, MaxLength, IsOptional, IsUUID, IsBoolean } from 'class-validator';

export class DebugPipelineDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  text!: string;

  @IsOptional()
  @IsUUID()
  userId?: string;

  @IsOptional()
  @IsBoolean()
  createTicket?: boolean;
}
