import { IsObject, IsOptional } from 'class-validator';

export class SyncProfileDto {
  @IsOptional()
  @IsObject()
  graphProfile?: Record<string, unknown> | null;
}
