/**
 * Per-ticket reply-composer draft persistence.
 *
 * The legacy detail page swaps active tickets in place (Task 5 + click-replace
 * navigation), so a half-typed reply needs to survive the swap. Drafts are
 * keyed by ticket id and stored in localStorage so they also survive a tab
 * close or page refresh.
 *
 * - Empty / whitespace-only drafts are cleared rather than stored.
 * - Stored drafts include a timestamp so a future cleanup pass can drop
 *   old entries; today we just read the body.
 */

const KEY_PREFIX = "csh-msg-draft:";

interface StoredDraft {
  body: string;
  updatedAt: number;
}

export function readMessageDraft(ticketId: string | undefined): string {
  if (!ticketId) return "";
  try {
    const raw = localStorage.getItem(KEY_PREFIX + ticketId);
    if (!raw) return "";
    const parsed = JSON.parse(raw) as StoredDraft;
    return typeof parsed.body === "string" ? parsed.body : "";
  } catch {
    return "";
  }
}

export function writeMessageDraft(
  ticketId: string | undefined,
  body: string,
): void {
  if (!ticketId) return;
  try {
    if (body.trim()) {
      const payload: StoredDraft = { body, updatedAt: Date.now() };
      localStorage.setItem(KEY_PREFIX + ticketId, JSON.stringify(payload));
    } else {
      localStorage.removeItem(KEY_PREFIX + ticketId);
    }
  } catch {
    // localStorage can be unavailable (private mode, quota); silently ignore.
  }
}

export function clearMessageDraft(ticketId: string | undefined): void {
  if (!ticketId) return;
  try {
    localStorage.removeItem(KEY_PREFIX + ticketId);
  } catch {}
}
