import { IsUUID } from 'class-validator';

export class ListSlasDto {
  @IsUUID()
  teamId!: string;
}
