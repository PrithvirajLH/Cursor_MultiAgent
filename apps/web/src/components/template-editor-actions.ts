import type { MacroAction } from "../api/client";

/**
 * The actions the template editor can build.
 *
 * NOW THE COMPLETE SERVER ALLOWLIST. The first pass offered only the six that
 * need no entity lookup; the last three are here as of this pass, each backed by
 * a real dropdown of categories, teams or team members. An action whose id
 * cannot be chosen is worse than one that is absent, which is why they waited
 * for the lookups rather than shipping as free-text id boxes.
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
  { value: "set_category", label: "Set category" },
  { value: "assign_team", label: "Move to team" },
  { value: "assign_user", label: "Assign to" },
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
    case "set_category":
      return { type, categoryId: "" };
    case "assign_team":
      return { type, teamId: "" };
    case "assign_user":
      return { type, userId: "" };
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
    // An id-based action with nothing chosen is dropped on save rather than
    // sent - the server would reject it, and a whole-form 400 does not say
    // which row was blank.
    case "set_category":
      return Boolean(action.categoryId);
    case "assign_team":
      return Boolean(action.teamId);
    case "assign_user":
      return Boolean(action.userId);
    default:
      return false;
  }
}
