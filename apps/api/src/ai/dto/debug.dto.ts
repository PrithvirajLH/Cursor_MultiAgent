import { IsString, IsNotEmpty, MaxLength, IsOptional, IsUUID, IsBoolean } from 'class-validator';

export class DebugPipelineDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  text!: string;

  /**
   * ⚠️ CARD 1.85: OWNER ONLY, enforced in the controller.
   *
   * The debug page offers a free-text "UUID of the requester" box so an admin
   * can reproduce a routing decision as the person who hit it. For an OWNER
   * that reveals nothing new - they can already read every ticket. For a
   * TEAM_ADMIN it was a way out of their own team's scope, so it is refused
   * rather than silently ignored: a trace that quietly ran as somebody else
   * would be a debugging tool that lies.
   */
  @IsOptional()
  @IsUUID()
  userId?: string;

  @IsOptional()
  @IsBoolean()
  createTicket?: boolean;
}
