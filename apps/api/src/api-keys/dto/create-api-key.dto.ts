import { IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

/** What an owner supplies to mint a key (card 2.6). */
export class CreateApiKeyDto {
  /** How the key is recognised in the admin list. Not a secret. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;

  /**
   * The existing user the key acts as. Its role and memberships decide what the
   * key can reach — there is deliberately no separate permission model.
   */
  @IsUUID()
  serviceUserId!: string;

  /** Optional team to confine the key to. Can only narrow, never widen. */
  @IsOptional()
  @IsUUID()
  teamScope?: string;
}
