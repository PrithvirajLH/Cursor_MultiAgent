import { TicketPriority } from '@prisma/client';
import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class IngestInboundEmailDto {
  @IsEmail()
  fromEmail!: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  fromName?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  subject!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(20_000)
  body!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(255)
  messageId!: string;

  @IsOptional()
  @IsEnum(TicketPriority)
  priority?: TicketPriority;
}
