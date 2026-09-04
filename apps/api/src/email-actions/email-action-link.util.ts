import {
  signEmailActionToken,
  type EmailActionKind,
} from './email-action-token.util';

/** 30 days. Ample for a resolved ticket, and short enough to be a real bound. */
export const EMAIL_ACTION_TTL_DAYS = 30;

/** Just enough of ConfigService to read three keys, so this stays a pure util. */
export interface EmailActionConfig {
  get<T = string>(key: string): T | undefined;
}

/**
 * The signing secret, or null.
 *
 * `EMAIL_ACTION_SECRET` if set, otherwise `AUTH_JWT_SECRET`. Sharing a secret
 * across two schemes is only safe with domain separation, which
 * `email-action-token.util.ts` provides by signing a prefixed string - a token
 * from one scheme cannot verify under the other. A dedicated key is still
 * preferable and the env var is there for it; the fallback exists so the
 * feature does not depend on a deploy-time step nobody was told about.
 *
 * Null means FAIL CLOSED everywhere: no links are put in the email, and any
 * token presented is refused. A link that cannot be verified must not be sent.
 */
export function emailActionSecret(config: EmailActionConfig): string | null {
  return (
    config.get<string>('EMAIL_ACTION_SECRET') ??
    config.get<string>('AUTH_JWT_SECRET') ??
    null
  );
}

/**
 * Where the API is reachable from a requester's browser.
 *
 * In production the API and the web app are the same App Service, so
 * `WEB_APP_URL` is the right fallback; `PUBLIC_API_URL` exists for the case
 * where they are not.
 */
export function emailActionBaseUrl(config: EmailActionConfig): string {
  return (
    config.get<string>('PUBLIC_API_URL') ??
    config.get<string>('WEB_APP_URL') ??
    'http://localhost:3001'
  ).replace(/\/$/, '');
}

/**
 * The URL for ONE action on ONE ticket (card 1.44), or null if signing is off.
 *
 * ⚠️ The token is the last PATH segment. Never a fragment - fragments are not
 * sent to the server, so the link would silently do nothing - and the page's
 * script reads it back out of `location.pathname`, so nothing has to be
 * templated into that script.
 */
export function buildEmailActionUrl(
  config: EmailActionConfig,
  ticketId: string,
  action: EmailActionKind,
  value?: number,
): string | null {
  const secret = emailActionSecret(config);
  if (!secret) {
    return null;
  }
  const token = signEmailActionToken(
    {
      ticketId,
      action,
      value,
      expiresAt:
        Math.floor(Date.now() / 1000) + EMAIL_ACTION_TTL_DAYS * 24 * 60 * 60,
    },
    secret,
  );
  return `${emailActionBaseUrl(config)}/api/email-actions/${token}`;
}

/** The seven links the resolved email carries, or none at all. */
export interface ResolvedEmailLinks {
  confirm: string | null;
  reopen: string | null;
  /** Five URLs, ratings 1 to 5 in order. Empty when signing is off. */
  ratings: string[];
}

/**
 * All seven, or none.
 *
 * Partial sets are not offered: an email with a close link and no stars looks
 * like a bug, and one with links that cannot be verified is worse than one
 * without them.
 */
export function buildResolvedEmailLinks(
  config: EmailActionConfig,
  ticketId: string,
): ResolvedEmailLinks {
  if (!emailActionSecret(config)) {
    return { confirm: null, reopen: null, ratings: [] };
  }
  return {
    confirm: buildEmailActionUrl(config, ticketId, 'confirm'),
    reopen: buildEmailActionUrl(config, ticketId, 'reopen'),
    ratings: [1, 2, 3, 4, 5]
      .map((rating) => buildEmailActionUrl(config, ticketId, 'rate', rating))
      .filter((url): url is string => url !== null),
  };
}
