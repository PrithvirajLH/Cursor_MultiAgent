import { lookup as dnsLookup } from 'dns';
import { request as httpsRequest } from 'https';
import { createHmac } from 'crypto';
import { inspectWebhookUrl, isBlockedAddress } from './webhook-url.util';

/** Give up on one delivery rather than holding a worker slot open. */
const SEND_TIMEOUT_MS = 10_000;

/** The signature header a consumer verifies, and the timestamp it is bound to. */
export const WEBHOOK_SIGNATURE_HEADER = 'x-ticketing-signature';
export const WEBHOOK_TIMESTAMP_HEADER = 'x-ticketing-timestamp';

/**
 * Sign a delivery (card 2.6).
 *
 * ⚠️ THE TIMESTAMP IS INSIDE THE SIGNED STRING, NOT BESIDE IT. Signing only the
 * body means a captured call can be replayed forever; binding the time into the
 * signed material lets a consumer reject anything older than its own tolerance
 * and know the timestamp was not edited in flight.
 *
 * The signed string is `<timestamp>.<raw body>` — the exact bytes sent, not a
 * re-serialisation, because two JSON encoders will eventually disagree about
 * key order and the signature would fail for reasons nobody can see.
 */
export function signWebhookBody(
  secret: string,
  timestamp: string,
  rawBody: string,
): string {
  return createHmac('sha256', secret)
    .update(`${timestamp}.${rawBody}`, 'utf8')
    .digest('hex');
}

/** What a delivery attempt produced, for the outbox to record. */
export type WebhookSendResult =
  | { ok: true; statusCode: number }
  | { ok: false; error: string };

/**
 * A DNS lookup that refuses to hand back an address inside the network.
 *
 * ⚠️ THIS IS THE CHECK THAT CANNOT BE RACED. Validating the URL at save time
 * answers "where did this point a moment ago"; this answers "where is this
 * socket about to connect", which is the only question that matters. A hostname
 * that resolved publicly when the admin saved it and resolves to
 * 169.254.169.254 now is refused here, at connect time, by the same rules.
 *
 * Every address the resolver returns is checked, not just the first — a name
 * with one public and one link-local A record must not be usable.
 */
function guardedLookup(
  hostname: string,
  options: { all?: boolean } | number | undefined,
  callback: (
    err: NodeJS.ErrnoException | null,
    address: string | { address: string; family: number }[],
    family?: number,
  ) => void,
): void {
  const wantsAll =
    typeof options === 'object' && options !== null && options.all === true;
  dnsLookup(hostname, { all: true }, (err, addresses) => {
    if (err) {
      callback(err, '', 0);
      return;
    }
    const list = Array.isArray(addresses) ? addresses : [addresses];
    const blocked = list.find((entry) => isBlockedAddress(entry.address));
    if (blocked) {
      callback(
        Object.assign(
          new Error(
            `Refusing to connect to ${hostname}: it resolves to ${blocked.address}, which is inside the private network`,
          ),
          { code: 'EBLOCKEDADDRESS' },
        ),
        '',
        0,
      );
      return;
    }
    if (list.length === 0) {
      callback(
        Object.assign(new Error(`${hostname} did not resolve`), {
          code: 'ENOTFOUND',
        }),
        '',
        0,
      );
      return;
    }
    if (wantsAll) {
      callback(null, list);
      return;
    }
    callback(null, list[0].address, list[0].family);
  });
}

/**
 * Deliver one webhook.
 *
 * ⚠️ USES NODE'S CORE `https` CLIENT RATHER THAN `fetch`, FOR TWO REASONS THAT
 * ARE BOTH SECURITY PROPERTIES:
 *
 *  - it accepts a `lookup`, which is how the connect-time address check above
 *    is installed. `fetch` gives no such hook without replacing the dispatcher.
 *  - it does not follow redirects. `fetch` follows up to 20 by default, and a
 *    permitted host answering `302 → http://169.254.169.254/` would walk
 *    straight through a save-time check. Here a 3xx is simply a response, and
 *    the caller treats it as a failed delivery.
 */
export async function sendWebhook(input: {
  url: string;
  secret: string;
  body: string;
}): Promise<WebhookSendResult> {
  // The shape check runs again on every send. Cheap, and it means a row queued
  // before a rule tightened cannot slip out under the old rule.
  const verdict = inspectWebhookUrl(input.url);
  if (!verdict.ok) {
    return { ok: false, error: verdict.reason };
  }
  const timestamp = Date.now().toString();
  const signature = signWebhookBody(input.secret, timestamp, input.body);
  return new Promise<WebhookSendResult>((resolve) => {
    let settled = false;
    const finish = (result: WebhookSendResult) => {
      if (!settled) {
        settled = true;
        resolve(result);
      }
    };
    const req = httpsRequest(
      verdict.url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(input.body),
          [WEBHOOK_SIGNATURE_HEADER]: signature,
          [WEBHOOK_TIMESTAMP_HEADER]: timestamp,
          'User-Agent': 'ticketing-webhooks/1',
        },
        lookup: guardedLookup as never,
        timeout: SEND_TIMEOUT_MS,
      },
      (res) => {
        // Drain, so the socket is released rather than left half-read.
        res.resume();
        const status = res.statusCode ?? 0;
        if (status >= 200 && status < 300) {
          finish({ ok: true, statusCode: status });
          return;
        }
        // ⚠️ A 3xx is a FAILURE here, not something to follow. See above.
        finish({
          ok: false,
          error:
            status >= 300 && status < 400
              ? `Destination answered ${status} (redirects are not followed)`
              : `Destination answered ${status}`,
        });
      },
    );
    req.on('timeout', () => {
      req.destroy();
      finish({ ok: false, error: `Timed out after ${SEND_TIMEOUT_MS}ms` });
    });
    req.on('error', (error: NodeJS.ErrnoException) => {
      finish({ ok: false, error: error.message });
    });
    req.write(input.body);
    req.end();
  });
}
