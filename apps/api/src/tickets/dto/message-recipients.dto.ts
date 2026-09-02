import { IsEnum, IsOptional } from 'class-validator';
import { MessageType } from '@prisma/client';

/** Query for the compose screen's recipient preview. Defaults to a public reply. */
export class MessageRecipientsDto {
  @IsOptional()
  @IsEnum(MessageType)
  type?: MessageType;
}
