import type { MacroAction } from "../api/client";

/**
 * The actions the template editor can build (card 1.7b §3d).
 *
 * A STRICT SUBSET of the server's MACRO_ALLOWED_ACTIONS, and deliberately so:
 * these are the six that need no entity lookup. `set_category`, `assign_team`
 * and `assign_user` are allowed by the server but need a picker for a category,
 * team or team-member id, so the editor does not offer them yet — offering a
 * control that cannot produce a valid value is worse than not offering it.
 *
 * ⚠️ Nothing here may ever include `send_email`, `notify_requester` or
 * `notify_team_lead`. The server refuses them on save and again on execute, so
 * offering one would only produce a 400 an agent cannot act on.
 */
export const EDITABLE_ACTION_TYPES = [
  { value: "set_status", label: "Set status" },
  { value: "set_priority", label: "Set priority" },
  { value: "add_tag", label: "Add tag" },
  { value: "remove_tag", label: "Remove tag" },
  { value: "add_follower", label: "Add follower" },
  { value: "add_internal_note", label: "Add internal note" },
] as const;

export const TEMPLATE_STATUS_OPTIONS = [
  "TRIAGED",
  "ASSIGNED",
  "IN_PROGRESS",
  "WAITING_ON_REQUESTER",
  "WAITING_ON_VENDOR",
  "RESOLVED",
  "CLOSED",
] as const;

export const TEMPLATE_PRIORITY_OPTIONS = [
  "SEV1",
  "SEV2",
  "SEV3",
  "SEV4",
] as const;

export const TEMPLATE_FOLLOWER_TARGETS = ["requester", "assignee"] as const;

/**
 * The placeholders a template may use.
 *
 * Read off `buildMacroVars` on the server, which is the only thing that decides
 * what fills. Card 1.7 found three hint strings in this app advertising keys the
 * server did not understand, so this list is worth keeping honest: if it and the
 * server disagree, the server wins and the agent gets an empty string.
 */
export const TEMPLATE_PLACEHOLDERS = [
  "{{requester.firstName}}",
  "{{requester.displayName}}",
  "{{ticket.displayId}}",
  "{{ticket.subject}}",
  "{{agent.firstName}}",
] as const;

/** A blank action of the given type, with its one parameter empty. */
export function blankAction(type: string): MacroAction {
  switch (type) {
    case "set_status":
      return { type, status: "RESOLVED" };
    case "set_priority":
      return { type, priority: "SEV3" };
    case "add_tag":
    case "remove_tag":
      return { type, tags: [] };
    case "add_follower":
      return { type, target: "requester" };
    default:
      return { type, body: "" };
  }
}

/**
 * Is this action complete enough to save?
 *
 * The server would reject an empty tag list or an empty note anyway; catching it
 * here means the agent sees which row is wrong instead of a whole-form 400.
 */
export function isActionComplete(action: MacroAction): boolean {
  switch (action.type) {
    case "set_status":
      return Boolean(action.status);
    case "set_priority":
      return Boolean(action.priority);
    case "add_tag":
    case "remove_tag":
      return (action.tags ?? []).length > 0;
    case "add_follower":
      return Boolean(action.target);
    case "add_internal_note":
      return Boolean(action.body && action.body.trim() !== "");
    default:
      return false;
  }
}
