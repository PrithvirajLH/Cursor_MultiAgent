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
 *   old entries.
 *
 * Card 1.18 added `messageType`. Of the three things that card asked about, the
 * body already survived a reload and so did an inline image once its upload had
 * resolved; the public/internal choice was not stored at all, so an agent who
 * wrote an internal note, reloaded, and hit send published it to the requester.
 * That is the whole of the change here.
 */

const KEY_PREFIX = "csh-msg-draft:";

/** The two things the composer can be. Mirrors `MessageType` on the API. */
export type DraftMessageType = "PUBLIC" | "INTERNAL";

interface StoredDraft {
  body: string;
  updatedAt: number;
  /**
   * Absent on any draft written before card 1.18, and that is not an error
   * condition - it means "no preference recorded", which the composer reads as
   * its own default. Never widen this to a required field without a migration:
   * every draft already in a browser would be discarded on the next read.
   */
  messageType?: DraftMessageType;
}

/**
 * A restored draft.
 *
 * The reader was widened rather than a second one added beside it, so there is
 * exactly one place that decodes the stored shape. Two readers over one
 * localStorage key is how the body and the type would drift apart later.
 */
export interface MessageDraft {
  body: string;
  /** `null` when the draft predates card 1.18 or carried a bad value. */
  messageType: DraftMessageType | null;
}

const EMPTY_DRAFT: MessageDraft = { body: "", messageType: null };

function parseMessageType(value: unknown): DraftMessageType | null {
  return value === "PUBLIC" || value === "INTERNAL" ? value : null;
}

export function readMessageDraft(
  ticketId: string | undefined,
): MessageDraft {
  if (!ticketId) return EMPTY_DRAFT;
  try {
    const raw = localStorage.getItem(KEY_PREFIX + ticketId);
    if (!raw) return EMPTY_DRAFT;
    const parsed = JSON.parse(raw) as StoredDraft;
    return {
      body: typeof parsed.body === "string" ? parsed.body : "",
      // Anything unrecognised is treated exactly like a missing value. A draft
      // hand-edited in devtools, or written by a future version with a third
      // type, must not put an unknown string into the composer's state.
      messageType: parseMessageType(parsed.messageType),
    };
  } catch {
    // Matches the pre-existing tolerance: a corrupt entry loses the draft, it
    // never breaks the page.
    return EMPTY_DRAFT;
  }
}

export function writeMessageDraft(
  ticketId: string | undefined,
  body: string,
  messageType?: DraftMessageType,
): void {
  if (!ticketId) return;
  try {
    if (body.trim()) {
      const payload: StoredDraft = {
        body,
        updatedAt: Date.now(),
        ...(messageType ? { messageType } : {}),
      };
      localStorage.setItem(KEY_PREFIX + ticketId, JSON.stringify(payload));
    } else {
      localStorage.removeItem(KEY_PREFIX + ticketId);
    }
  } catch {
    // localStorage can be unavailable (private mode, quota); silently ignore.
  }
}

/**
 * What the composer may actually be, given the ticket in front of it.
 *
 * ⚠️ The ticket's rules beat the stored draft, always. A draft is a note about
 * what somebody meant to write yesterday; whether a public reply is allowed is
 * decided by this ticket now. Restoring `PUBLIC` onto a ticket where card 1.38
 * permits only internal notes would flip the toggle to Public, the server would
 * refuse the send, and in between the screen would have been lying about who
 * was going to read it - which is the exact defect card 1.37 existed to fix.
 *
 * The two rules mirror the effects already in TicketDetailPage, deliberately:
 * an EMPLOYEE has no internal notes to write, and a peer agent may not reply
 * publicly on a colleague's ticket. This runs at restore time so the toggle is
 * never briefly wrong, and those effects stay as the backstop for a ticket that
 * loads after the draft does.
 */
export function clampDraftMessageType(
  stored: DraftMessageType | null,
  rules: { role: string; isPeerAgent: boolean },
): DraftMessageType {
  if (rules.role === "EMPLOYEE") return "PUBLIC";
  if (rules.isPeerAgent) return "INTERNAL";
  return stored ?? "PUBLIC";
}

export function clearMessageDraft(ticketId: string | undefined): void {
  if (!ticketId) return;
  try {
    localStorage.removeItem(KEY_PREFIX + ticketId);
  } catch {}
}
