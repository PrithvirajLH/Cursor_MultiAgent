import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  CannedResponsePicker,
  describeMacroAction,
} from "./CannedResponsePicker";

vi.mock("../api/client", () => ({
  fetchCannedResponses: vi.fn().mockResolvedValue([]),
  renderCannedResponse: vi.fn(),
  applyCannedResponse: vi.fn(),
}));

/**
 * Card 1.7 — "show before you act", the same principle as card 1.28's audience
 * line. An agent must be able to read what a macro will do before clicking it,
 * which means the list has to be a sentence rather than the stored JSON.
 */
describe("describeMacroAction", () => {
  it("reads like a sentence for a status change", () => {
    expect(
      describeMacroAction({ type: "set_status", status: "RESOLVED" }),
    ).toBe("sets status to Resolved");
  });

  it("never shows a raw enum to the reader", () => {
    const out = describeMacroAction({
      type: "set_status",
      status: "WAITING_ON_REQUESTER",
    });
    expect(out).toBe("sets status to Waiting on requester");
    expect(out).not.toContain("WAITING_ON_REQUESTER");
    expect(out).not.toContain("_");
  });

  it("names the tags it will add and remove", () => {
    expect(
      describeMacroAction({ type: "add_tag", tags: ["password", "vpn"] }),
    ).toBe("adds tag password, vpn");
    expect(describeMacroAction({ type: "remove_tag", tags: ["waiting"] })).toBe(
      "removes tag waiting",
    );
  });

  it("covers the rest of the allowlist", () => {
    expect(describeMacroAction({ type: "set_priority", priority: "SEV2" })).toBe(
      "sets priority to SEV2",
    );
    expect(describeMacroAction({ type: "assign_user" })).toBe(
      "assigns it to someone",
    );
    expect(describeMacroAction({ type: "assign_team" })).toBe(
      "moves it to another team",
    );
    expect(describeMacroAction({ type: "set_category" })).toBe(
      "changes the category",
    );
    expect(describeMacroAction({ type: "add_internal_note" })).toBe(
      "adds an internal note",
    );
    expect(
      describeMacroAction({ type: "add_follower", target: "requester" }),
    ).toBe("adds requester as a follower");
  });

  it("degrades readably for an action it has never heard of", () => {
    // A new automation action must not render as blank or as JSON while
    // somebody decides whether macros may use it.
    expect(describeMacroAction({ type: "some_new_action" })).toBe(
      "Some new action",
    );
  });
});

describe("CannedResponsePicker", () => {
  it("renders nothing at all when closed", () => {
    expect(
      renderToStaticMarkup(
        <CannedResponsePicker
          open={false}
          onClose={() => {}}
          onSelect={() => {}}
          ticketId="t-1"
        />,
      ),
    ).toBe("");
  });

  it("opens on the list, not on a preview", () => {
    const html = renderToStaticMarkup(
      <CannedResponsePicker
        open
        onClose={() => {}}
        onSelect={() => {}}
        ticketId="t-1"
      />,
    );
    expect(html).toContain("Insert template");
    // The preview headings appear only after a template is chosen - nothing is
    // rendered, and nothing is applied, until then.
    expect(html).not.toContain("And it will");
    expect(html).not.toContain("Insert and apply");
  });
});
