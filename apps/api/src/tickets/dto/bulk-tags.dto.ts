import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

/**
 * Tag several tickets at once (card 1.12).
 *
 * Tags travel by NAME rather than id, matching `POST /tickets/:id/tags`: an
 * agent tagging twenty tickets is thinking "vpn", not a uuid, and the name is
 * upserted so a new tag needs no separate call. Removal takes names too - one
 * shape for both halves, and a name that is not on a ticket is simply a no-op.
 *
 * `ArrayMaxSize(100)` on the tickets matches every other bulk DTO here.
 */
export class BulkTagsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsUUID('4', { each: true })
  ticketIds!: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(50, { each: true })
  add?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(50, { each: true })
  remove?: string[];
}
