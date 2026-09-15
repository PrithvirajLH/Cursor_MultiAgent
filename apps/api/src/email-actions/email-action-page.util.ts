/**
 * The page a link from the email opens (card 1.44, click gate from card 1.93).
 *
 * ⚠️ TWO RULES, AND BOTH ARE LOAD-BEARING.
 *
 * 1. **This page performs nothing until somebody clicks it.** It is served by a
 *    `GET`, and Microsoft Defender Safe Links, antivirus gateways and
 *    link-preview bots fetch URLs out of email before any human sees them. A
 *    link that acted on `GET` would have the scanner confirm every resolved
 *    ticket and set whichever star it happened to fetch first, and it would look
 *    exactly like the feature working.
 *
 *    ⚠️ CARD 1.93 CHANGED THIS, AND THE EXTRA CLICK **IS** THE DEFENCE. The
 *    action used to be a `POST` the script made **on load**, on the reasoning
 *    that a scanner runs no script. That is not true of all of them: sandboxes
 *    that detonate links in a real headless browser do run the script, and
 *    every one of them would have silently closed the ticket. Nothing about the
 *    request distinguishes them — which is why this does NOT sniff the
 *    user-agent or `Sec-Fetch-*`, both of which a scanner controls and neither
 *    of which is a security boundary. What a scanner does not do is *press a
 *    button*. So the page renders a real form and waits. The second click the
 *    owner ruled out when this shipped is deliberately added back, because it
 *    is the only part of this flow a machine cannot forge.
 *
 *    It degrades without JavaScript: the form natively `POST`s to the same URL
 *    and the server renders the outcome (see `buildEmailActionOutcomePage`), so
 *    the click is required on both paths.
 *
 * 2. **It reveals nothing about the ticket.** No subject, no reference, no
 *    name, no status - anyone who can read or forward the email reaches this
 *    URL. Card 1.6 established the same principle: even a ticket reference
 *    names the department it belongs to. The strings below are the complete
 *    vocabulary of this page, and a test asserts none of them can carry ticket
 *    data. It is also why the button says only "Confirm": the page is
 *    byte-identical for every token, so it cannot name the action it performs.
 *
 * The script is a separate same-origin file rather than inline, because the
 * API's CSP (main.ts) allows `scriptSrc: 'self'` plus ONE hard-coded hash. An
 * inline script here would need its own hash, and any whitespace change would
 * silently break every link in every email already sent.
 */
export const EMAIL_ACTION_SCRIPT_PATH = 'action.js';

/**
 * The whole vocabulary of the page.
 *
 * Every sentence a person can be shown, in one place, so "reveals nothing about
 * the ticket" is a property that can be read off a list rather than hunted
 * through templates. None of them interpolates anything.
 */
export const EMAIL_ACTION_MESSAGES = {
  // ⚠️ Card 1.93. Shown BEFORE anything happens, so it must not imply it has.
  // It also cannot name the action - the page is the same bytes for a close, a
  // reopen and all five stars.
  prompt: 'Please confirm.',
  why: 'One more click, so an automatic email scanner cannot answer for you.',
  working: 'One moment…',
  confirm: 'Thanks — we have closed this for you.',
  reopen: 'Thanks — we have reopened this and someone will pick it up.',
  rate: 'Thanks for the rating.',
  alreadyDone: 'That is already done — no need to do anything else.',
  // ⚠️ NOT the same as alreadyDone, and the browser pass is what showed why.
  // Reopen a ticket and then click "Yes, close it" in the same email: closing
  // is not a move a requester may make from REOPENED, so the action is refused
  // - and the page used to answer "that is already done" while the ticket sat
  // open. Telling somebody their request is handled when it is not is the one
  // thing this page must never do.
  noLongerPossible:
    'This one has moved on since that email was sent. Reply to the email if you still need something.',
  expired: 'This link has expired. You can still reply to the email.',
  invalid: 'This link is not valid. You can still reply to the email.',
  failed: 'Something went wrong. You can still reply to the email.',
} as const;

/** Every outcome the page can be asked to render. */
export type EmailActionMessageKey = keyof typeof EMAIL_ACTION_MESSAGES;

/** The shared look. One copy, so the form and the outcome page cannot drift. */
const EMAIL_ACTION_STYLE = `      body {
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
      button {
        margin-top: 20px;
        padding: 10px 28px;
        font: inherit;
        font-weight: 600;
        color: #ffffff;
        background: #2563eb;
        border: 0;
        border-radius: 8px;
        cursor: pointer;
      }`;

/**
 * The head and card markup every one of these pages shares.
 *
 * `afterCard` is where the script tag goes on the interactive page and stays
 * empty on the outcome page, so neither has to restate the head.
 */
function pageShell(body: string, afterCard = ''): string {
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex, nofollow" />
    <title>Thanks</title>
    <style>
${EMAIL_ACTION_STYLE}
    </style>
  </head>
  <body>
    <div class="card">
${body}
    </div>${afterCard}
  </body>
</html>
`;
}

/**
 * The shell. Identical for every token, so it can be cached and audited.
 *
 * ⚠️ The `<form method="post">` is the whole point of card 1.93: with the script
 * loaded the submit is intercepted and the outcome is shown in place, and
 * without it the browser posts natively. Either way a person pressed something.
 */
export function buildEmailActionPage(scriptUrl: string): string {
  return pageShell(
    `      <p id="outcome">${EMAIL_ACTION_MESSAGES.prompt}</p>
      <p class="quiet" id="detail">${EMAIL_ACTION_MESSAGES.why}</p>
      <form id="act" method="post" action="">
        <button type="submit" id="go">Confirm</button>
      </form>`,
    `\n    <script src="${scriptUrl}"></script>`,
  );
}

/**
 * The answer to a native form post, for a browser running no JavaScript.
 *
 * Same vocabulary and same shell as the scripted path, with no form and no
 * script - the action has already happened by the time this renders.
 */
export function buildEmailActionOutcomePage(
  outcome: EmailActionMessageKey,
): string {
  const message = EMAIL_ACTION_MESSAGES[outcome] ?? EMAIL_ACTION_MESSAGES.failed;
  return pageShell(`      <p id="outcome">${message}</p>`);
}

/**
 * The script that performs the action.
 *
 * Kept as a string constant rather than a built asset: it is a few lines, it
 * must be served from this route to satisfy CSP, and a build step between the
 * email links and this file is one more thing that can silently stop working.
 *
 * It derives the token from its own URL, so nothing is templated into it and it
 * is byte-identical for every request.
 *
 * ⚠️ CARD 1.93: NOTHING HERE RUNS ON LOAD. The `fetch` lives inside the submit
 * handler and nowhere else, which is the property the page is defended by - a
 * scanner that executes this file still changes nothing. A test asserts no
 * `fetch(` appears before the listener, because moving it back would look like
 * a tidy-up and would silently re-arm every scanner.
 */
export function buildEmailActionScript(): string {
  const messages = JSON.stringify(EMAIL_ACTION_MESSAGES);
  return `(function () {
  var MESSAGES = ${messages};
  var outcome = document.getElementById('outcome');
  var detail = document.getElementById('detail');
  var form = document.getElementById('act');
  var parts = window.location.pathname.split('/');
  var token = parts[parts.length - 1];
  function show(text, extra) {
    outcome.textContent = text;
    detail.textContent = extra || '';
  }
  if (!token || !form) {
    show(MESSAGES.invalid);
    return;
  }
  form.addEventListener('submit', function (event) {
    event.preventDefault();
    form.style.display = 'none';
    show(MESSAGES.working);
    fetch(window.location.pathname, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json'
      }
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
  });
})();
`;
}
