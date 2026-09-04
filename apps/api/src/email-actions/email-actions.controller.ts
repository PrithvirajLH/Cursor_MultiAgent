import { Controller, Get, Header, Param, Post } from '@nestjs/common';
import { Public } from '../auth/public.decorator';
import { ThrottlePolicy } from '../common/throttle-policy.decorator';
import {
  buildEmailActionPage,
  buildEmailActionScript,
  EMAIL_ACTION_SCRIPT_PATH,
} from './email-action-page.util';
import { EmailActionsService } from './email-actions.service';

/**
 * One click from the email (card 1.44).
 *
 * ⚠️ **This is the product's first unauthenticated write path that is not
 * behind a shared secret**, so the shape matters as much as the code:
 *
 *  - `GET /api/email-actions/:token` CHANGES NOTHING. It serves a page.
 *    Defender Safe Links and antivirus gateways fetch email URLs before a human
 *    reads them; a link that acted on GET would auto-confirm every resolved
 *    ticket and set a rating nobody gave.
 *  - `POST /api/email-actions/:token` performs the action. The page's script
 *    makes that call on load, so the human clicks once and a scanner - which
 *    runs no script - does nothing.
 *  - The response says only what happened, in one word the page turns into a
 *    sentence. No subject, no reference, no name, no status.
 *
 * ⚠️ **Deploy note.** These routes are `@Public()`, which only clears the app's
 * own guard. In production the App Service sits behind Easy Auth with
 * `unauthenticatedClientAction: RedirectToLoginPage`, so **`/api/email-actions`
 * must be added to `globalValidation.excludedPaths` in `authsettingsV2`**,
 * beside `/api/tickets/inbound-email` and `/api/tickets/intake`. Without it
 * every link returns 401 and the feature silently does nothing.
 */
@Controller('email-actions')
export class EmailActionsController {
  constructor(private readonly emailActions: EmailActionsService) {}

  /**
   * The page's script, same-origin.
   *
   * Declared BEFORE the `:token` route so it is matched first. Separate from
   * the HTML because the API's CSP allows `scriptSrc: 'self'` and one
   * hard-coded hash - an inline script would need its own hash, and a
   * whitespace change would then silently break every link already emailed.
   */
  @Get(EMAIL_ACTION_SCRIPT_PATH)
  @Public()
  @Header('Content-Type', 'application/javascript; charset=utf-8')
  @Header('Cache-Control', 'public, max-age=300')
  getScript(): string {
    return buildEmailActionScript();
  }

  /** The page. Byte-identical for every token, and performs nothing. */
  @Get(':token')
  @Public()
  @ThrottlePolicy('webhook')
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  @Header('Referrer-Policy', 'no-referrer')
  getPage(): string {
    // A relative URL, so it works whatever host the link was opened on and
    // needs no configuration to match.
    return buildEmailActionPage(`../${EMAIL_ACTION_SCRIPT_PATH}`);
  }

  /** The write. One action, one ticket, and nothing about it in the answer. */
  @Post(':token')
  @Public()
  @ThrottlePolicy('webhook')
  async perform(@Param('token') token: string) {
    const outcome = await this.emailActions.perform(token);
    return { outcome };
  }
}
