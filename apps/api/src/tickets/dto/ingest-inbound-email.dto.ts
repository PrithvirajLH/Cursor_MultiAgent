import { Transform, Type } from 'class-transformer';
import { TicketPriority } from '@prisma/client';
import {
  ArrayMaxSize,
  IsArray,
  IsEmail,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class InboundEmailAttachmentDto {
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  fileName!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(255)
  contentType!: string;

  @IsInt()
  @Min(1)
  sizeBytes!: number;

  @IsOptional()
  @IsString()
  @MinLength(1)
  contentBase64?: string;

  @IsOptional()
  @IsUrl({
    protocols: ['https'],
    require_protocol: true,
  })
  contentUrl?: string;
}

export class IngestInboundEmailDto {
  @IsEmail()
  fromEmail!: string;

  @IsOptional()
  @IsEmail()
  toEmail?: string;

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
  @IsString()
  @MaxLength(998)
  inReplyTo?: string;

  @IsOptional()
  @Transform(({ value }) =>
    Array.isArray(value)
      ? value.filter((item): item is string => typeof item === 'string').join(' ')
      : value,
  )
  @IsString()
  @MaxLength(4000)
  references?: string;

  @IsOptional()
  @IsEnum(TicketPriority)
  priority?: TicketPriority;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(25)
  @ValidateNested({ each: true })
  @Type(() => InboundEmailAttachmentDto)
  attachments?: InboundEmailAttachmentDto[];
}
