import { beforeEach, describe, expect, it } from "vitest";
import {
  clampDraftMessageType,
  clearMessageDraft,
  readMessageDraft,
  writeMessageDraft,
} from "./messageDraft";

/**
 * Card 1.18 — what actually survives a reload.
 *
 * The card asked about three things. Two already worked before this change: the
 * body, and an inline pasted image once its upload had resolved (an image still
 * uploading is stripped from the draft on purpose, so a blank image is never
 * sent - the file itself survives on the Attachments tab). The third, the
 * public/internal toggle, was not stored at all.
 *
 * These tests run in the node environment this project uses for vitest, so
 * localStorage is stubbed rather than assumed.
 */
describe("message draft", () => {
  const KEY = "csh-msg-draft:t-1";

  beforeEach(() => {
    const store = new Map<string, string>();
    (globalThis as unknown as { localStorage: Storage }).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
      key: (i: number) => [...store.keys()][i] ?? null,
      get length() {
        return store.size;
      },
    } as Storage;
  });

  it("round-trips the body, as it always did", () => {
    writeMessageDraft("t-1", "half a reply");
    expect(readMessageDraft("t-1").body).toBe("half a reply");
  });

  it("round-trips the message type, which is the new part", () => {
    writeMessageDraft("t-1", "a private note", "INTERNAL");
    expect(readMessageDraft("t-1")).toEqual({
      body: "a private note",
      messageType: "INTERNAL",
    });
  });

  it("reads a draft written by the OLD code as no preference, not a crash", () => {
    // Exactly the shape the previous version stored. Every browser that has
    // used this app has one of these sitting in localStorage right now.
    localStorage.setItem(
      KEY,
      JSON.stringify({ body: "written last week", updatedAt: 1 }),
    );
    expect(readMessageDraft("t-1")).toEqual({
      body: "written last week",
      messageType: null,
    });
  });

  it("treats an unrecognised type as no preference", () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({ body: "x", updatedAt: 1, messageType: "SECRET" }),
    );
    expect(readMessageDraft("t-1").messageType).toBeNull();
  });

  it("survives a corrupt entry rather than throwing", () => {
    localStorage.setItem(KEY, "{not json");
    expect(readMessageDraft("t-1")).toEqual({ body: "", messageType: null });
  });

  it("clears rather than storing an empty body", () => {
    writeMessageDraft("t-1", "something", "INTERNAL");
    writeMessageDraft("t-1", "   ", "INTERNAL");
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("clears on send", () => {
    writeMessageDraft("t-1", "sent now", "PUBLIC");
    clearMessageDraft("t-1");
    expect(readMessageDraft("t-1").body).toBe("");
  });

  it("keeps drafts on different tickets apart", () => {
    writeMessageDraft("t-1", "one", "INTERNAL");
    writeMessageDraft("t-2", "two", "PUBLIC");
    expect(readMessageDraft("t-1").messageType).toBe("INTERNAL");
    expect(readMessageDraft("t-2").messageType).toBe("PUBLIC");
  });
});

describe("the ticket's rules beat the stored draft", () => {
  it("never restores INTERNAL for an EMPLOYEE", () => {
    // A requester has no internal notes to write, and the toggle is not even
    // shown to them.
    expect(
      clampDraftMessageType("INTERNAL", { role: "EMPLOYEE", isPeerAgent: false }),
    ).toBe("PUBLIC");
  });

  it("never restores PUBLIC on a ticket that allows only notes", () => {
    // The case the card names. A peer agent may not reply publicly on a
    // colleague's ticket (card 1.38); the server would refuse the send, but the
    // screen would have promised the requester was going to read it.
    expect(
      clampDraftMessageType("PUBLIC", { role: "AGENT", isPeerAgent: true }),
    ).toBe("INTERNAL");
  });

  it("honours the stored choice when the ticket permits both", () => {
    expect(
      clampDraftMessageType("INTERNAL", { role: "LEAD", isPeerAgent: false }),
    ).toBe("INTERNAL");
    expect(
      clampDraftMessageType("PUBLIC", { role: "LEAD", isPeerAgent: false }),
    ).toBe("PUBLIC");
  });

  it("falls back to the composer's default when nothing was stored", () => {
    expect(
      clampDraftMessageType(null, { role: "LEAD", isPeerAgent: false }),
    ).toBe("PUBLIC");
  });
});
