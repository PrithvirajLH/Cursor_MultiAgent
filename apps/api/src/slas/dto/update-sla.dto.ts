import { TicketPriority } from '@prisma/client';
import { IsArray, IsEnum, IsInt, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class UpdateSlaPolicyItemDto {
  @IsEnum(TicketPriority)
  priority!: TicketPriority;

  @IsInt()
  @Min(1)
  firstResponseHours!: number;

  @IsInt()
  @Min(1)
  resolutionHours!: number;
}

export class UpdateSlaPolicyDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpdateSlaPolicyItemDto)
  policies!: UpdateSlaPolicyItemDto[];
}
