/** The headers a receiver may pass through; all optional, all absent by default. */
export type AutomatedEmailHeaders = {
  readonly autoSubmitted?: string | null;
  readonly autoResponseSuppress?: string | null;
  readonly precedence?: string | null;
  readonly listId?: string | null;
  readonly returnPath?: string | null;
};

/** Precedence values that mean "machine sent this", per long-standing convention. */
const BULK_PRECEDENCE = new Set(['bulk', 'junk', 'list']);

function present(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * Was this message sent by a machine rather than a person?
 *
 * Layer one of loop protection. Every check is a header the sender set
 * deliberately, so a false positive costs one suppressed notification while a
 * false negative costs an auto-reply war between two mailboxes that never tire.
 *
 * `Auto-Submitted` is inverted on purpose: RFC 3834 says a human message carries
 * `no` if it carries the header at all, so anything else - `auto-replied`,
 * `auto-generated`, a value we have never seen - counts as automated. Absent is
 * not automated: most human mail has no such header.
 *
 * An empty `Return-Path` (`<>`) is the null reverse-path a bounce or vacation
 * responder uses precisely so nothing replies to it.
 */
export function isAutomatedEmail(headers: AutomatedEmailHeaders): boolean {
  const autoSubmitted = present(headers.autoSubmitted);
  if (autoSubmitted !== null && autoSubmitted.toLowerCase() !== 'no') {
    return true;
  }
  if (present(headers.autoResponseSuppress) !== null) {
    return true;
  }
  const precedence = present(headers.precedence);
  if (precedence !== null && BULK_PRECEDENCE.has(precedence.toLowerCase())) {
    return true;
  }
  if (present(headers.listId) !== null) {
    return true;
  }
  // Distinguish "not supplied" from "supplied and empty": only the latter is the
  // null reverse-path. typeof, not present(), because present() maps both to null.
  if (typeof headers.returnPath === 'string') {
    const returnPath = headers.returnPath.trim();
    if (returnPath === '' || returnPath === '<>') {
      return true;
    }
  }
  return false;
}
