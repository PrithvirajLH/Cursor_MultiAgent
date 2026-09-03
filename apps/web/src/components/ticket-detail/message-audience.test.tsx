import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { MessageAudience as Audience } from "../../api/client";
import { MessageAudience } from "./MessageAudience";

/**
 * Card 1.28, 6b. Since 1.33 a reply is one email and 1.34 removed "Also
 * copied" from the body, so this line is the only place anyone sees who a
 * message reaches. The failure that matters is showing nothing: absence reads
 * as "nobody", and an agent writes something candid on the strength of it.
 */

const PUBLIC: Audience = {
  to: { id: "u-req", name: "Bhavesh Patel" },
  cc: [
    { id: "u-asg", name: "Greg Weitzer", removable: false },
    { id: "u-fol", name: "Dana Whitfield", removable: true },
  ],
  refused: [],
  emails: true,
};

const INTERNAL: Audience = {
  to: null,
  cc: [{ id: "u-asg", name: "Greg Weitzer", removable: false }],
  refused: [],
  emails: false,
};

function render(overrides: Partial<Parameters<typeof MessageAudience>[0]> = {}) {
  return renderToStaticMarkup(
    <MessageAudience
      publicAudience={PUBLIC}
      internalAudience={INTERNAL}
      messageType="PUBLIC"
      error={false}
      onRemove={async () => {}}
      {...overrides}
    />,
  );
}

describe("MessageAudience", () => {
  it("names the requester first, then everyone copied", () => {
    const html = render();
    expect(html).toContain("Goes to");
    const requesterAt = html.indexOf("Bhavesh Patel");
    const assigneeAt = html.indexOf("Greg Weitzer");
    const followerAt = html.indexOf("Dana Whitfield");
    expect(requesterAt).toBeGreaterThan(-1);
    expect(requesterAt).toBeLessThan(assigneeAt);
    expect(assigneeAt).toBeLessThan(followerAt);
  });

  it("shows no addresses, only names", () => {
    expect(render()).not.toContain("@");
  });

  describe("card 1.41 — the way out is readable without hovering", () => {
    /** Everything outside a title= attribute, i.e. what a person can actually read. */
    function visibleText(html: string): string {
      return html.replace(/title="[^"]*"/g, "");
    }

    it("names the way out as TEXT on an unassigned ticket, not only in a title", () => {
      const html = render({
        messageType: "INTERNAL",
        blockedReason: "unassigned",
      });
      expect(visibleText(html)).toContain("Assign this ticket to yourself");
      expect(visibleText(html)).toContain("until then anything you write is an");
    });

    it("makes the action a real focusable control, not a span", () => {
      // The original lived in a title on a <span>, which cannot take focus, so
      // a keyboard user could never reach it.
      const html = render({
        messageType: "INTERNAL",
        blockedReason: "unassigned",
        onAssignSelf: () => {},
      });
      expect(html).toMatch(/<button[^>]*>Assign this ticket to yourself<\/button>/);
    });

    it("falls back to prose when there is no assign action to offer", () => {
      const html = render({
        messageType: "INTERNAL",
        blockedReason: "unassigned",
      });
      expect(visibleText(html)).toContain("Assign this ticket to yourself");
      expect(html).not.toContain("<button");
    });

    it("keeps the assigned-to-a-teammate case distinguishable", () => {
      const html = render({
        messageType: "INTERNAL",
        blockedReason: "assigned-to-teammate",
      });
      expect(visibleText(html)).toContain("assigned to a teammate");
      expect(visibleText(html)).not.toContain("Assign this ticket to yourself");
    });

    it("says nothing extra when the agent is not blocked", () => {
      // A LEAD choosing an internal note deliberately. Card 1.38's rule is
      // AGENT-only and this wording must not widen it.
      const html = render({ messageType: "INTERNAL" });
      expect(visibleText(html)).toContain("Internal note — staff only");
      expect(visibleText(html)).not.toContain("Assign this ticket to yourself");
      expect(visibleText(html)).not.toContain("assigned to a teammate");
    });

    it("still shows the at-a-glance internal line in every blocked case", () => {
      for (const reason of ["unassigned", "assigned-to-teammate"] as const) {
        expect(
          visibleText(render({ messageType: "INTERNAL", blockedReason: reason })),
        ).toContain("Internal note — staff only, no email sent.");
      }
    });
  });

  it("swaps wholly for the internal wording, naming no audience", () => {
    const html = render({ messageType: "INTERNAL" });
    expect(html).toContain("Internal note — staff only, no email sent.");
    expect(html).not.toContain("Goes to");
    expect(html).not.toContain("Bhavesh Patel");
  });

  it("renders the error fallback rather than nothing", () => {
    // Never silently show nothing — absence reads as "nobody".
    const html = render({ error: true });
    expect(html).toContain("Couldn’t check who this reaches");
  });

  it("renders nothing at all while still loading", () => {
    // Secondary furniture: a spinner here would be noise, and the reserved
    // height in TicketConversation keeps the composer from moving.
    expect(
      render({ publicAudience: null, internalAudience: null }),
    ).toBe("");
  });

  it("reports refusals with the reason available on hover", () => {
    const html = render({
      publicAudience: {
        ...PUBLIC,
        refused: [
          {
            address: "consultant@vendor.example",
            reason: "outside the allowed domains",
          },
        ],
      },
    });
    expect(html).toContain("1 address cannot be emailed");
    expect(html).toContain("outside the allowed domains");
  });

  it("pluralises more than one refusal", () => {
    const html = render({
      publicAudience: {
        ...PUBLIC,
        refused: [
          { address: "a@vendor.example", reason: "outside the allowed domains" },
          { address: "b@csnhc.com", reason: "suppressed after a bounce" },
        ],
      },
    });
    expect(html).toContain("2 addresses cannot be emailed");
  });

  it("keeps the collapsed line to one row, with no remove controls", () => {
    // Collapsed is the default because it must not shift the composer.
    const html = render();
    expect(html).not.toContain("Stop Dana Whitfield following this ticket");
  });

  it("says so when nobody reachable is left, rather than going blank", () => {
    const html = render({
      publicAudience: { to: null, cc: [], refused: [], emails: true },
    });
    expect(html).toContain("Goes to nobody");
  });
});

describe("who can be removed", () => {
  // Removal unfollows from the TICKET, so it can only be offered to someone
  // who is on the message BECAUSE they follow it. Unfollowing the assignee
  // would not stop them receiving it, and a public reply with no To: is not a
  // thing, so the requester is fixed.
  it("marks the requester as fixed and offers no control for them", () => {
    const html = renderToStaticMarkup(
      <MessageAudience
        publicAudience={PUBLIC}
        internalAudience={INTERNAL}
        messageType="PUBLIC"
        error={false}
        onRemove={async () => {}}
      />,
    );
    expect(html).not.toContain("Stop Bhavesh Patel following this ticket");
  });

  // The expanded list's per-person x control needs a click to reach, so it is
  // verified in the browser rather than asserted here against static markup.
  // What IS asserted statically: no remove control is reachable while
  // collapsed, and none is ever rendered for the requester.
});
