const BRACKETED_WITH_PORT = /^\[.+\]:\d+$/;
const TRAILING_PORT = /:\d+$/;

/**
 * Remove a trailing `:port` from an address. Azure App Service writes
 * `X-Forwarded-For: 1.2.3.4:56789` with a fresh source port per TCP connection,
 * so anything keyed on the raw value changes between a caller's retries.
 * A bare IPv6 address keeps its colons — only a bracketed `[::1]:5678` is
 * unambiguous enough to trim.
 */
export function stripPort(address: string): string {
  if (BRACKETED_WITH_PORT.test(address)) {
    return address.slice(0, address.lastIndexOf(':'));
  }
  if (address.includes('.') && TRAILING_PORT.test(address)) {
    return address.replace(TRAILING_PORT, '');
  }
  return address;
}
