import {
  buildEmailActionPage,
  buildEmailActionScript,
  EMAIL_ACTION_MESSAGES,
} from './email-action-page.util';
import {
  buildEmailActionUrl,
  buildResolvedEmailLinks,
  emailActionSecret,
} from './email-action-link.util';
import {
  signEmailActionToken,
  verifyEmailActionToken,
} from './email-action-token.util';

const SECRET = 'a-test-signing-secret-long-enough';
const future = () => Math.floor(Date.now() / 1000) + 3600;

/**
 * Card 1.44 — the token, and the page it opens.
 *
 * The token is the whole of the security story for the product's first
 * unauthenticated write path, so it is tested as a unit rather than only
 * through HTTP: one action, one ticket, one value, an expiry, and nothing that
 * survives tampering.
 */
describe('email action token', () => {
  it('round-trips one action on one ticket', () => {
    const token = signEmailActionToken(
      { ticketId: 't-1', action: 'confirm', expiresAt: future() },
      SECRET,
    );
    const verdict = verifyEmailActionToken(token, SECRET);
    expect(verdict.ok).toBe(true);
    if (verdict.ok) {
      expect(verdict.claims.ticketId).toBe('t-1');
      expect(verdict.claims.action).toBe('confirm');
    }
  });

  it('⚠️ a confirm token cannot be turned into a reopen', () => {
    const token = signEmailActionToken(
      { ticketId: 't-1', action: 'confirm', expiresAt: future() },
      SECRET,
    );
    // Rewrite the payload the obvious way and re-encode it. The signature no
    // longer covers it, which is the point of putting the action inside.
    const [payload, signature] = token.split('.');
    const claims = JSON.parse(
      Buffer.from(payload, 'base64url').toString('utf8'),
    ) as Record<string, unknown>;
    claims.a = 'reopen';
    const forged = `${Buffer.from(JSON.stringify(claims)).toString(
      'base64url',
    )}.${signature}`;
    expect(verifyEmailActionToken(forged, SECRET)).toEqual({
      ok: false,
      reason: 'invalid',
    });
  });

  it('⚠️ a rating token cannot be turned into a different rating', () => {
    const token = signEmailActionToken(
      { ticketId: 't-1', action: 'rate', value: 4, expiresAt: future() },
      SECRET,
    );
    const [payload, signature] = token.split('.');
    const claims = JSON.parse(
      Buffer.from(payload, 'base64url').toString('utf8'),
    ) as Record<string, unknown>;
    claims.v = 1;
    const forged = `${Buffer.from(JSON.stringify(claims)).toString(
      'base64url',
    )}.${signature}`;
    expect(verifyEmailActionToken(forged, SECRET).ok).toBe(false);
  });

  it('cannot be moved to another ticket', () => {
    const token = signEmailActionToken(
      { ticketId: 't-1', action: 'confirm', expiresAt: future() },
      SECRET,
    );
    const [payload, signature] = token.split('.');
    const claims = JSON.parse(
      Buffer.from(payload, 'base64url').toString('utf8'),
    ) as Record<string, unknown>;
    claims.t = 't-2';
    const forged = `${Buffer.from(JSON.stringify(claims)).toString(
      'base64url',
    )}.${signature}`;
    expect(verifyEmailActionToken(forged, SECRET).ok).toBe(false);
  });

  it.each([
    ['empty', ''],
    ['no dot', 'abcdef'],
    ['empty payload', '.abc'],
    ['empty signature', 'abc.'],
    ['three parts', 'a.b.c'],
    ['truncated signature', 'eyJ0IjoidC0xIn0.abc'],
    ['not base64', '!!!.!!!'],
  ])('refuses a %s token', (_label, token) => {
    expect(verifyEmailActionToken(token, SECRET)).toEqual({
      ok: false,
      reason: 'invalid',
    });
  });

  it('refuses one signed with a different secret', () => {
    const token = signEmailActionToken(
      { ticketId: 't-1', action: 'confirm', expiresAt: future() },
      'some-other-secret',
    );
    expect(verifyEmailActionToken(token, SECRET).ok).toBe(false);
  });

  it('reports an expired token as expired, and only after the signature checks out', () => {
    const token = signEmailActionToken(
      {
        ticketId: 't-1',
        action: 'confirm',
        expiresAt: Math.floor(Date.now() / 1000) - 1,
      },
      SECRET,
    );
    expect(verifyEmailActionToken(token, SECRET)).toEqual({
      ok: false,
      reason: 'expired',
    });
    // An expired token with a BAD signature is `invalid`, not `expired` - the
    // signature is checked first, so the expiry answer leaks nothing.
    const wrongSecret = verifyEmailActionToken(token, 'wrong');
    expect(wrongSecret).toEqual({ ok: false, reason: 'invalid' });
  });

  it('refuses a rating outside 1-5, and a rating on a non-rating action', () => {
    for (const value of [0, 6, 2.5, -1]) {
      const token = signEmailActionToken(
        { ticketId: 't-1', action: 'rate', value, expiresAt: future() },
        SECRET,
      );
      expect(verifyEmailActionToken(token, SECRET).ok).toBe(false);
    }
    const withValue = signEmailActionToken(
      { ticketId: 't-1', action: 'confirm', value: 5, expiresAt: future() },
      SECRET,
    );
    expect(verifyEmailActionToken(withValue, SECRET).ok).toBe(false);
  });

  it('is domain-separated from a JWT signed with the same secret', () => {
    // The secret may be shared with AUTH_JWT_SECRET. A JWT's signature covers
    // "header.payload"; this covers "email-action.v1:payload". Neither can be
    // presented to the other.
    const header = Buffer.from(JSON.stringify({ alg: 'HS256' })).toString(
      'base64url',
    );
    const payload = Buffer.from(JSON.stringify({ sub: 'x' })).toString(
      'base64url',
    );
    const { createHmac } = require('crypto') as typeof import('crypto');
    const jwtSig = createHmac('sha256', SECRET)
      .update(`${header}.${payload}`)
      .digest('base64url');
    expect(
      verifyEmailActionToken(`${payload}.${jwtSig}`, SECRET).ok,
    ).toBe(false);
  });
});

describe('email action links', () => {
  const config = (values: Record<string, string | undefined>) => ({
    get: <T = string>(key: string) => values[key] as T | undefined,
  });

  it('fails closed when no secret is configured', () => {
    const cfg = config({});
    expect(emailActionSecret(cfg)).toBeNull();
    expect(buildEmailActionUrl(cfg, 't-1', 'confirm')).toBeNull();
    expect(buildResolvedEmailLinks(cfg, 't-1')).toEqual({
      confirm: null,
      reopen: null,
      ratings: [],
    });
  });

  it('builds seven distinct links with the token in the PATH', () => {
    const cfg = config({
      AUTH_JWT_SECRET: SECRET,
      PUBLIC_API_URL: 'https://tickets.example.com/',
    });
    const links = buildResolvedEmailLinks(cfg, 't-1');
    const all = [links.confirm, links.reopen, ...links.ratings];
    expect(all).toHaveLength(7);
    expect(new Set(all).size).toBe(7);
    for (const url of all) {
      expect(url).toContain('https://tickets.example.com/api/email-actions/');
      // ⚠️ Never a fragment: a fragment is not sent to the server, so the link
      // would silently do nothing.
      expect(url).not.toContain('#');
    }
  });

  it('the five rating links carry 1 to 5, in order', () => {
    const cfg = config({ AUTH_JWT_SECRET: SECRET });
    const links = buildResolvedEmailLinks(cfg, 't-1');
    const values = links.ratings.map((url) => {
      const token = url.split('/').pop() as string;
      const verdict = verifyEmailActionToken(token, SECRET);
      return verdict.ok ? verdict.claims.value : null;
    });
    expect(values).toEqual([1, 2, 3, 4, 5]);
  });
});

describe('the outcome page', () => {
  it('⚠️ shows a person nothing about the ticket', () => {
    // Anyone who can read or forward the email reaches this page, so its whole
    // vocabulary has to be safe to show a stranger.
    //
    // The check is on what is RENDERED - the page's visible text plus every
    // message - not on the script's source. An earlier version of this test
    // scanned the source and failed on `response.status`, a JavaScript property
    // name no reader ever sees; a test that cannot tell those apart would have
    // been passed by deleting a word rather than by fixing anything.
    const visible = buildEmailActionPage('../action.js')
      .replace(/<style[\s\S]*?<\/style>/g, '')
      .replace(/<[^>]+>/g, ' ');
    const rendered = [visible, ...Object.values(EMAIL_ACTION_MESSAGES)]
      .join(' ')
      .toLowerCase();
    for (const word of [
      'subject',
      'requester',
      'ticket',
      'priority',
      'assignee',
      'team',
      'status',
      '#',
    ]) {
      expect(rendered).not.toContain(word);
    }
    for (const message of Object.values(EMAIL_ACTION_MESSAGES)) {
      expect(message).not.toMatch(/\$\{|%s|\{\{/);
    }
  });

  it('⚠️ can only render its own fixed messages, never the response', () => {
    // The other half of the same property: even if the API were changed to
    // answer something detailed, this page would not print it. The outcome key
    // is used only to look up a local constant.
    const script = buildEmailActionScript();
    expect(script).toContain('MESSAGES[outcomeKey]');
    expect(script).not.toContain('body.message');
    expect(script).not.toContain('JSON.stringify');
    // textContent is only ever assigned from show()'s own parameters.
    const assignments = script.match(/textContent = ([^;]+);/g) ?? [];
    expect(assignments).toEqual([
      'textContent = text;',
      "textContent = extra || '';",
    ]);
  });

  it('has no inline script, because the API CSP would block one', () => {
    const page = buildEmailActionPage('../action.js');
    expect(page).toContain('<script src="../action.js"></script>');
    // No other <script> with a body.
    expect(page).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/);
  });

  it('performs the action with a POST, never a GET', () => {
    const script = buildEmailActionScript();
    expect(script).toContain("method: 'POST'");
    // The scanner test in one line: nothing here can act without script
    // execution, and a scanner runs none.
    expect(script).toContain('fetch(');
  });

  it('tells search engines to stay away', () => {
    expect(buildEmailActionPage('../action.js')).toContain('noindex');
  });
});
