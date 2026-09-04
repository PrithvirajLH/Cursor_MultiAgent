import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  CannedResponsePicker,
  describeMacroAction,
} from "./CannedResponsePicker";
import {
  blankAction,
  EDITABLE_ACTION_TYPES,
  isActionComplete,
  TEMPLATE_PLACEHOLDERS,
} from "./template-editor-actions";

vi.mock("../api/client", () => ({
  // The list now returns an envelope with the caller's shareable team, not a
  // bare array (card 1.7b).
  fetchCannedResponses: vi.fn().mockResolvedValue({ data: [], team: null }),
  renderCannedResponse: vi.fn(),
  applyCannedResponse: vi.fn(),
  createCannedResponse: vi.fn(),
  updateCannedResponse: vi.fn(),
  deleteCannedResponse: vi.fn(),
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

/**
 * Card 1.7b — the editor must never offer an action the server will refuse.
 *
 * A control that produces a guaranteed 400 is worse than no control: the agent
 * fills a form, clicks save, and gets an error they cannot act on.
 */
describe("the template editor's action list", () => {
  it("never offers an action that sends email or notifies anyone", () => {
    const offered = EDITABLE_ACTION_TYPES.map((option) => option.value);
    expect(offered).not.toContain("send_email");
    expect(offered).not.toContain("notify_requester");
    expect(offered).not.toContain("notify_team_lead");
  });

  it("offers only actions the server's allowlist contains", () => {
    // Mirrors MACRO_ALLOWED_ACTIONS in the API. Deliberately a SUBSET: the
    // three id-based actions need an entity picker and are not offered yet.
    const serverAllowlist = [
      "set_status",
      "set_priority",
      "set_category",
      "add_tag",
      "remove_tag",
      "assign_user",
      "assign_team",
      "add_follower",
      "add_internal_note",
    ];
    for (const option of EDITABLE_ACTION_TYPES) {
      expect(serverAllowlist).toContain(option.value);
    }
  });

  it("gives every offered action a usable default", () => {
    for (const option of EDITABLE_ACTION_TYPES) {
      const fresh = blankAction(option.value);
      expect(fresh.type).toBe(option.value);
      // A tag or note starts empty on purpose - there is nothing sensible to
      // guess - so those are the only two that start incomplete.
      const expectIncomplete = ["add_tag", "remove_tag", "add_internal_note"];
      expect(isActionComplete(fresh)).toBe(
        !expectIncomplete.includes(option.value),
      );
    }
  });

  it("will not save a half-filled tag or note", () => {
    expect(isActionComplete({ type: "add_tag", tags: [] })).toBe(false);
    expect(isActionComplete({ type: "add_tag", tags: ["vpn"] })).toBe(true);
    expect(isActionComplete({ type: "add_internal_note", body: "   " })).toBe(
      false,
    );
    expect(isActionComplete({ type: "add_internal_note", body: "Done." })).toBe(
      true,
    );
  });

  it("advertises exactly the placeholders the server fills", () => {
    // Card 1.7 found three hint strings in this app naming keys the server did
    // not understand. These are the five buildMacroVars actually produces.
    expect([...TEMPLATE_PLACEHOLDERS]).toEqual([
      "{{requester.firstName}}",
      "{{requester.displayName}}",
      "{{ticket.displayId}}",
      "{{ticket.subject}}",
      "{{agent.firstName}}",
    ]);
  });
});

describe("the picker's list view", () => {
  it("offers a way to create one, which is what card 1.7b was for", () => {
    const html = renderToStaticMarkup(
      <CannedResponsePicker
        open
        onClose={() => {}}
        onSelect={() => {}}
        ticketId="t-1"
      />,
    );
    expect(html).toContain("New template");
  });
});
