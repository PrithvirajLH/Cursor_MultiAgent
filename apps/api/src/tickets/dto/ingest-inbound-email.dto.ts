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
  @Transform(({ value }: { value: unknown }): string | undefined => {
    if (Array.isArray(value)) {
      return value
        .filter((item): item is string => typeof item === 'string')
        .join(' ');
    }

    return typeof value === 'string' ? value : undefined;
  })
  @IsString()
  @MaxLength(4000)
  references?: string;

  @IsOptional()
  @IsEnum(TicketPriority)
  priority?: TicketPriority;

  // Loop-protection headers (card 1.22). Every one is optional and absent by
  // default: a receiver that knows nothing about them keeps working exactly as
  // it did, which is what makes this additive rather than a contract change.
  // `returnPath` allows the empty string on purpose - a null reverse path is
  // the signal, not a missing value.
  @IsOptional()
  @IsString()
  @MaxLength(200)
  autoSubmitted?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  autoResponseSuppress?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  precedence?: string;

  @IsOptional()
  @IsString()
  @MaxLength(998)
  listId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(998)
  returnPath?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(25)
  @ValidateNested({ each: true })
  @Type(() => InboundEmailAttachmentDto)
  attachments?: InboundEmailAttachmentDto[];
}
