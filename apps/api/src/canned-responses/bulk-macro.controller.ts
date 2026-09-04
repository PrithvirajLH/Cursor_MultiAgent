import { Body, Controller, Post } from '@nestjs/common';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { ThrottlePolicy } from '../common/throttle-policy.decorator';
import { BulkMacroDto } from '../tickets/dto/bulk-macro.dto';
import { CannedResponsesService } from './canned-responses.service';

/**
 * `POST /api/tickets/bulk/macro` — apply one macro's actions to a selection.
 *
 * It sits in the canned-responses module rather than beside the other four
 * bulk endpoints in TicketsController for one reason: injecting
 * CannedResponsesService into TicketsService closes a module cycle
 * (Tickets -> CannedResponses -> Automation -> Tickets) that Nest could not
 * resolve - `Nest can't resolve dependencies of the CannedResponsesService`,
 * on RuleEngineService. A controller here needs no new edge at all.
 *
 * The URL is what card 1.12 asked for; only the file it is declared in differs.
 */
@Controller('tickets/bulk')
export class BulkMacroController {
  constructor(private readonly cannedResponses: CannedResponsesService) {}

  /** Run the macro's actions on every ticket the caller may write. */
  @Post('macro')
  @ThrottlePolicy('highWrite')
  async bulkMacro(@Body() payload: BulkMacroDto, @CurrentUser() user: AuthUser) {
    return this.cannedResponses.applyToMany(payload, user);
  }
}
