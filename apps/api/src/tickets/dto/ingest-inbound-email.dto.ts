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

  /**
   * The sender's `Content-ID` for a pasted image (card 1.129, fault B).
   *
   * Present only for a file the body referenced as `src="cid:..."`, which is
   * what tells the ingest path this file belongs INSIDE the message rather than
   * merely alongside it. Absent for every ordinary attachment, and absent for
   * every file that arrived before this card.
   */
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  contentId?: string;

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

  /**
   * Everyone else the message was addressed to (card 1.24's auto-watching).
   *
   * Optional and absent by default, so an existing caller is unaffected. Used
   * only to add EXISTING users as followers - see `addLoopedInFollowers`,
   * which deliberately does not provision anybody from this list.
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsEmail({}, { each: true })
  ccEmails?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(160)
  fromName?: string;

  // ⚠️ CARD 1.105: 200 HERE MEANT A LONG SUBJECT LOST THE EMAIL.
  // `Ticket.subject` is VarChar(200) and this mirrored it, so a forwarded
  // "FW: RE: FW:" chain was refused with a 400 and the sender's words went with
  // it. The column limit is still 200 - `truncateInboundSubject` enforces it -
  // but that is the service's job, not a reason to reject the message. 998 is
  // the RFC 5322 line limit, so anything a real mail client can send gets in.
  @IsString()
  @MinLength(1)
  @MaxLength(998)
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
