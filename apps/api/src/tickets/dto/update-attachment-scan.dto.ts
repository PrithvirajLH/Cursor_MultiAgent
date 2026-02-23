import { AttachmentScanStatus } from '@prisma/client';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateAttachmentScanDto {
  @IsEnum(AttachmentScanStatus)
  status!: AttachmentScanStatus;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  error?: string;
}
