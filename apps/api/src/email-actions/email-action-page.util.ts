/**
 * The page a link from the email opens (card 1.44).
 *
 * ⚠️ TWO RULES, AND BOTH ARE LOAD-BEARING.
 *
 * 1. **This page performs nothing.** It is served by a `GET`, and Microsoft
 *    Defender Safe Links, antivirus gateways and link-preview bots fetch URLs
 *    out of email before any human sees them. A link that acted on `GET` would
 *    have the scanner confirm every resolved ticket and set whichever star it
 *    happened to fetch first, and it would look exactly like the feature
 *    working. The action is a `POST` that the page's script makes on load - a
 *    scanner executes no script, so it changes nothing, and a human still
 *    clicks exactly once. There is deliberately no confirmation button; that
 *    would be the second click the owner ruled out.
 *
 * 2. **It reveals nothing about the ticket.** No subject, no reference, no
 *    name, no status - anyone who can read or forward the email reaches this
 *    URL. Card 1.6 established the same principle: even a ticket reference
 *    names the department it belongs to. The strings below are the complete
 *    vocabulary of this page, and a test asserts none of them can carry ticket
 *    data.
 *
 * The script is a separate same-origin file rather than inline, because the
 * API's CSP (main.ts) allows `scriptSrc: 'self'` plus ONE hard-coded hash. An
 * inline script here would need its own hash, and any whitespace change would
 * silently break every link in every email already sent.
 */
export const EMAIL_ACTION_SCRIPT_PATH = 'action.js';

/** The shell. Identical for every token, so it can be cached and audited. */
export function buildEmailActionPage(scriptUrl: string): string {
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex, nofollow" />
    <title>Thanks</title>
    <style>
      body {
        margin: 0;
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        background: #f4f6f8;
        color: #1f2937;
        font-family: 'Segoe UI', Arial, sans-serif;
      }
      .card {
        max-width: 420px;
        margin: 24px;
        padding: 32px;
        background: #ffffff;
        border: 1px solid #e5e7eb;
        border-radius: 12px;
        text-align: center;
      }
      p { font-size: 16px; line-height: 1.7; margin: 0; }
      .quiet { margin-top: 12px; font-size: 13px; color: #6b7280; }
    </style>
  </head>
  <body>
    <div class="card">
      <p id="outcome">One moment…</p>
      <p class="quiet" id="detail"></p>
    </div>
    <script src="${scriptUrl}"></script>
  </body>
</html>
`;
}

/**
 * The whole vocabulary of the outcome page.
 *
 * Every sentence a person can be shown, in one place, so "reveals nothing about
 * the ticket" is a property that can be read off a list rather than hunted
 * through templates. None of them interpolates anything.
 */
export const EMAIL_ACTION_MESSAGES = {
  confirm: 'Thanks — we have closed this for you.',
  reopen: 'Thanks — we have reopened this and someone will pick it up.',
  rate: 'Thanks for the rating.',
  alreadyDone: 'That is already done — no need to do anything else.',
  expired: 'This link has expired. You can still reply to the email.',
  invalid: 'This link is not valid. You can still reply to the email.',
  failed: 'Something went wrong. You can still reply to the email.',
} as const;

/**
 * The script that performs the action.
 *
 * Kept as a string constant rather than a built asset: it is fifteen lines, it
 * must be served from this route to satisfy CSP, and a build step between the
 * email links and this file is one more thing that can silently stop working.
 *
 * It derives the token from its own URL, so nothing is templated into it and it
 * is byte-identical for every request.
 */
export function buildEmailActionScript(): string {
  const messages = JSON.stringify(EMAIL_ACTION_MESSAGES);
  return `(function () {
  var MESSAGES = ${messages};
  var outcome = document.getElementById('outcome');
  var detail = document.getElementById('detail');
  var parts = window.location.pathname.split('/');
  var token = parts[parts.length - 1];
  function show(text, extra) {
    outcome.textContent = text;
    detail.textContent = extra || '';
  }
  if (!token) {
    show(MESSAGES.invalid);
    return;
  }
  fetch(window.location.pathname, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  })
    .then(function (response) {
      return response
        .json()
        .catch(function () {
          return {};
        })
        .then(function (body) {
          return { status: response.status, body: body };
        });
    })
    .then(function (result) {
      var outcomeKey = result.body && result.body.outcome;
      show(MESSAGES[outcomeKey] || MESSAGES.failed);
    })
    .catch(function () {
      show(MESSAGES.failed);
    });
})();
`;
}
