import { isIP } from 'net';

/**
 * Where a webhook is allowed to point (card 2.6).
 *
 * ⚠️ THIS IS THE SECURITY BOUNDARY OF THE WHOLE FEATURE. The server makes an
 * HTTP request to a URL an admin typed, from inside Azure, where the instance
 * metadata endpoint at 169.254.169.254 hands out managed-identity tokens to
 * anything that asks. Card 1.69 already proved this app sees 169.254.x.x as its
 * own ingress, so that address is reachable. A webhook that can be pointed at it
 * is a credential-exfiltration primitive with an admin-friendly UI.
 *
 * Three rules, and all three are load-bearing:
 *
 *  1. **HTTPS only.** A payload signed with a shared secret is still readable in
 *     flight over http, and these carry ticket ids and team names.
 *  2. **Checked at SAVE and at SEND.** A save-time check alone is defeated by a
 *     hostname that resolves publicly today and to 169.254.169.254 tomorrow -
 *     DNS rebinding is not exotic, it is a free feature of any DNS provider. The
 *     send-time check happens at CONNECT time, against the address actually
 *     dialled, which is the only check that cannot be raced.
 *  3. **No redirects, ever.** A permitted host answering 302 to
 *     169.254.169.254 would defeat both checks. Node's core `https` client does
 *     not follow redirects at all, which is precisely why the sender uses it
 *     rather than `fetch`.
 */

/** Parsed IPv4 octets, or null when the string is not IPv4. */
function ipv4Octets(address: string): number[] | null {
  if (isIP(address) !== 4) {
    return null;
  }
  return address.split('.').map((part) => Number.parseInt(part, 10));
}

/**
 * Whether an address is one this server must never be talked into dialling.
 *
 * Deliberately a DENY list of the ranges that are dangerous from inside a cloud
 * VM rather than an allow list of "the internet", because the latter cannot be
 * written down. Every range here is either unroutable on the public internet or
 * names something inside the deployment.
 */
export function isBlockedAddress(address: string): boolean {
  const normalised = address.trim().toLowerCase();
  // IPv4-mapped IPv6 (::ffff:169.254.169.254) is the obvious way to smuggle a
  // blocked v4 address past a v6-shaped check, so unwrap it and judge the v4.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(normalised);
  if (mapped) {
    return isBlockedAddress(mapped[1]);
  }
  const octets = ipv4Octets(normalised);
  if (octets) {
    const [a, b] = octets;
    if (a === 0) return true; // 0.0.0.0/8 "this network"
    if (a === 10) return true; // private
    if (a === 127) return true; // loopback
    if (a === 169 && b === 254) return true; // ⚠️ link-local: cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true; // private
    if (a === 192 && b === 168) return true; // private
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a === 192 && b === 0) return true; // 192.0.0/24 and 192.0.2/24
    if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
    if (a === 198 && b === 51) return true; // 198.51.100/24 documentation
    if (a === 203 && b === 0) return true; // 203.0.113/24 documentation
    if (a >= 224) return true; // multicast, reserved, broadcast
    return false;
  }
  if (isIP(normalised) === 6) {
    if (normalised === '::1' || normalised === '::') return true;
    const head = normalised.split(':')[0];
    // fc00::/7 unique-local
    if (head.startsWith('fc') || head.startsWith('fd')) return true;
    // fe80::/10 link-local
    if (head.startsWith('fe8') || head.startsWith('fe9')) return true;
    if (head.startsWith('fea') || head.startsWith('feb')) return true;
    // ff00::/8 multicast
    if (head.startsWith('ff')) return true;
    return false;
  }
  // Not an IP literal at all; the caller resolves the name and re-checks.
  return false;
}

/** Why a destination was refused, in words an admin can act on. */
export type WebhookUrlRejection = { ok: false; reason: string };
export type WebhookUrlVerdict = { ok: true; url: URL } | WebhookUrlRejection;

/**
 * Check the shape of a destination, without touching DNS.
 *
 * The literal-address half of the defence: `https://169.254.169.254/` never
 * reaches a resolver, so it is refused here.
 */
export function inspectWebhookUrl(raw: string): WebhookUrlVerdict {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: 'That is not a valid URL' };
  }
  if (url.protocol !== 'https:') {
    return {
      ok: false,
      reason: 'Webhook URLs must use https, so the payload is not readable in transit',
    };
  }
  if (url.username || url.password) {
    return {
      ok: false,
      reason: 'Webhook URLs must not embed credentials',
    };
  }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (!host) {
    return { ok: false, reason: 'That URL has no host' };
  }
  if (isIP(host) !== 0 && isBlockedAddress(host)) {
    return {
      ok: false,
      reason:
        'That address is inside the private network. Webhooks may only be sent to public addresses — this blocks the cloud metadata service and anything on the internal network.',
    };
  }
  if (host.toLowerCase() === 'localhost' || host.toLowerCase().endsWith('.localhost')) {
    return {
      ok: false,
      reason: 'Webhooks may not be sent to localhost',
    };
  }
  return { ok: true, url };
}
