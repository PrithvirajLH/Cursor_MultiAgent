import { useEffect, useRef, useState } from "react";
import {
  FileText,
  Loader2,
  Pencil,
  Plus,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import {
  applyCannedResponse,
  createCannedResponse,
  deleteCannedResponse,
  fetchCannedResponses,
  fetchCategories,
  fetchTeamMembers,
  fetchTeams,
  renderCannedResponse,
  updateCannedResponse,
  type CannedResponseRecord,
  type MacroAction,
  type MacroPreview,
} from "../api/client";
import { useModalFocusTrap } from "../hooks/useModalFocusTrap";
import {
  blankAction,
  EDITABLE_ACTION_TYPES,
  isActionComplete,
  TEMPLATE_FOLLOWER_TARGETS,
  TEMPLATE_PLACEHOLDERS,
  TEMPLATE_PRIORITY_OPTIONS,
  TEMPLATE_STATUS_OPTIONS,
} from "./template-editor-actions";

export type CannedResponsePickerProps = {
  open: boolean;
  onClose: () => void;
  onSelect: (content: string) => void;
  /** The ticket a template is being applied to. Without it, only plain text. */
  ticketId?: string;
  /** Called after a macro's actions ran, so the ticket can be re-read. */
  onApplied?: () => void;
  className?: string;
};

/**
 * Plain English for one action, for the "what this will do" list (card 1.7).
 *
 * Deliberately reads like a sentence an agent can check at a glance, not like
 * the stored JSON. `set_status` -> "sets status to Resolved".
 */
export function describeMacroAction(action: MacroAction): string {
  const human = (value: string) => {
    const spaced = value.replace(/_/g, " ").toLowerCase();
    return spaced.charAt(0).toUpperCase() + spaced.slice(1);
  };
  switch (action.type) {
    case "set_status":
      return `sets status to ${human(action.status ?? "")}`;
    case "set_priority":
      return `sets priority to ${action.priority ?? ""}`;
    case "set_category":
      return "changes the category";
    case "add_tag":
      return `adds tag ${(action.tags ?? []).join(", ")}`;
    case "remove_tag":
      return `removes tag ${(action.tags ?? []).join(", ")}`;
    case "assign_user":
      return "assigns it to someone";
    case "assign_team":
      return "moves it to another team";
    case "add_follower":
      return `adds ${action.target ?? "someone"} as a follower`;
    case "add_internal_note":
      return "adds an internal note";
    default:
      return human(action.type);
  }
}

/**
 * Pick a template, see the filled text AND what it will do, then one click.
 *
 * ⚠️ THE SUBSTITUTION IS NOT DONE HERE ANY MORE. This component used to carry
 * its own `substituteVariables`, and it had already drifted: it understood
 * `{{ticket.id}}` and `{{requester.name}}` while the server, the automation
 * engine and all three placeholder hints used `{{ticket.displayId}}` and
 * `{{requester.displayName}}`. Card 1.7 deleted it — the server's
 * `fillTemplateVars` is the one templating function, so the text an agent sends
 * is filled by the same code the rest of the system uses.
 *
 * With no `ticketId` there is nothing to substitute against, so the raw content
 * is inserted and no actions are offered.
 */
export function CannedResponsePicker({
  open,
  onClose,
  onSelect,
  ticketId,
  onApplied,
  className = "",
}: CannedResponsePickerProps) {
  const [list, setList] = useState<CannedResponseRecord[]>([]);
  const [team, setTeam] = useState<{ id: string; name: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<MacroPreview | null>(null);
  const [busy, setBusy] = useState(false);
  // The editor (card 1.7b). `editing` null means "not editing"; an object with
  // no id means a new template.
  const [editing, setEditing] = useState<{
    id?: string;
    name: string;
    content: string;
    shareWithTeam: boolean;
    /** False when a lead is maintaining somebody else's shared template. */
    isMine?: boolean;
    actions: MacroAction[];
  } | null>(null);
  /**
   * The lists the three id-based actions choose from.
   *
   * Loaded once, only when the editor is actually opened - a template picker
   * that is usually used to paste text should not fetch three extra lists on
   * every open.
   */
  const [lookups, setLookups] = useState<{
    categories: { id: string; name: string }[];
    teams: { id: string; name: string }[];
    people: { id: string; name: string }[];
  }>({ categories: [], teams: [], people: [] });
  const dialogRef = useRef<HTMLDivElement>(null);

  useModalFocusTrap({ open, containerRef: dialogRef, onClose });

  function reload() {
    setLoading(true);
    setError(null);
    return fetchCannedResponses()
      .then((res) => {
        setList(res.data);
        setTeam(res.team);
      })
      .catch(() => {
        setError("Failed to load templates");
        setList([]);
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    if (!open) return;
    setPreview(null);
    setEditing(null);
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const editorOpen = editing !== null;
  useEffect(() => {
    if (!editorOpen || lookups.teams.length > 0) return;
    let cancelled = false;
    void Promise.allSettled([
      fetchCategories(),
      fetchTeams(),
      team ? fetchTeamMembers(team.id) : Promise.resolve({ data: [] }),
    ]).then(([categories, teams, members]) => {
      if (cancelled) return;
      // Partial failure is survivable: a dropdown with nothing in it still
      // beats losing the whole editor, and an action with no id chosen is
      // dropped on save rather than sent.
      setLookups({
        categories:
          categories.status === "fulfilled"
            ? (categories.value.data ?? []).map((c) => ({
                id: c.id,
                name: c.name,
              }))
            : [],
        teams:
          teams.status === "fulfilled"
            ? (teams.value.data ?? []).map((x) => ({ id: x.id, name: x.name }))
            : [],
        people:
          members.status === "fulfilled"
            ? ((members.value as { data?: { user?: { id: string; displayName?: string; email?: string } }[] })
                .data ?? []
              ).map((m) => ({
                id: m.user?.id ?? "",
                name: m.user?.displayName || m.user?.email || "Unknown",
              }))
            : [],
      });
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editorOpen, team]);

  if (!open) return null;

  async function choose(item: CannedResponseRecord) {
    // Nothing to fill against, and no ticket to act on.
    if (!ticketId) {
      onSelect(item.content);
      onClose();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      setPreview(await renderCannedResponse(item.id, ticketId));
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not prepare that template",
      );
    } finally {
      setBusy(false);
    }
  }

  async function saveTemplate() {
    if (!editing) return;
    setBusy(true);
    setError(null);
    try {
      // Only complete rows are sent. A half-filled action would come back as a
      // whole-form 400 that does not say which row is wrong.
      // Empty id fields are stripped as well as filtered. `isActionComplete`
      // catches a blank row, but a stray empty string on an unrelated key would
      // still fail the server's UUID check, and a whole-form 400 does not say
      // which row is wrong.
      const actions = editing.actions.filter(isActionComplete).map((action) =>
        Object.fromEntries(
          Object.entries(action).filter(([, value]) => value !== ""),
        ),
      ) as MacroAction[];
      const payload = {
        name: editing.name.trim(),
        content: editing.content,
        actions,
      };
      // The sharing choice travels on both routes now. On edit it is sent as
      // an explicit value - a team id to share, or null to make it private
      // again - because omitting it means "leave it as it is". Only the author
      // may change it; the server refuses a lead who tries, and the control is
      // hidden from them below.
      const sharing = editing.shareWithTeam && team ? team.id : null;
      if (editing.id) {
        await updateCannedResponse(editing.id, { ...payload, teamId: sharing });
      } else {
        await createCannedResponse({
          ...payload,
          ...(sharing ? { teamId: sharing } : {}),
        });
      }
      setEditing(null);
      await reload();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not save that template",
      );
    } finally {
      setBusy(false);
    }
  }

  async function removeTemplate(id: string) {
    setBusy(true);
    setError(null);
    try {
      await deleteCannedResponse(id);
      setEditing(null);
      await reload();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not delete that template",
      );
    } finally {
      setBusy(false);
    }
  }

  /** Swap an action for a different kind, discarding the old parameters. */
  function replaceAction(index: number, next: MacroAction) {
    setEditing((prev) =>
      prev
        ? {
            ...prev,
            actions: prev.actions.map((action, i) =>
              i === index ? next : action,
            ),
          }
        : prev,
    );
  }

  function patchAction(index: number, patch: Partial<MacroAction>) {
    setEditing((prev) =>
      prev
        ? {
            ...prev,
            actions: prev.actions.map((action, i) =>
              i === index ? { ...action, ...patch } : action,
            ),
          }
        : prev,
    );
  }

  async function confirm() {
    if (!preview || !ticketId) return;
    setBusy(true);
    setError(null);
    try {
      // Actions first, then the text goes into the composer. The message is
      // still sent by the composer itself, which is the only path that applies
      // the messaging rules - a macro has no send of its own to get wrong.
      if (preview.actions.length > 0) {
        await applyCannedResponse(preview.id, ticketId);
        onApplied?.();
      }
      onSelect(preview.content);
      onClose();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not apply that template",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-slate-900/20"
        aria-hidden
        onClick={onClose}
      />
      <div
        ref={dialogRef}
        className={`fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-popover shadow-xl ${className}`}
        role="dialog"
        aria-modal="true"
        aria-label="Insert canned response"
        tabIndex={-1}
      >
        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
          <h3 className="text-sm font-semibold text-foreground">
            {editing
              ? editing.id
                ? "Edit template"
                : "New template"
              : preview
                ? preview.name
                : "Insert template"}
          </h3>
          <div className="flex items-center gap-1">
            {!editing && !preview && (
              <button
                type="button"
                onClick={() =>
                  setEditing({
                    name: "",
                    content: "",
                    shareWithTeam: false,
                    actions: [],
                  })
                }
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <Plus className="h-3.5 w-3.5" />
                New template
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {error && (
          <p role="alert" className="px-4 pt-3 text-sm text-destructive">
            {error}
          </p>
        )}

        {editing ? (
          <div className="max-h-[70vh] overflow-auto p-4">
            <label
              className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-muted-foreground"
              htmlFor="tpl-name"
            >
              Name
            </label>
            <input
              id="tpl-name"
              value={editing.name}
              onChange={(e) =>
                setEditing({ ...editing, name: e.target.value })
              }
              placeholder="Password reset done"
              className="mb-4 w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/30"
            />

            <label
              className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-muted-foreground"
              htmlFor="tpl-content"
            >
              The reply
            </label>
            <textarea
              id="tpl-content"
              value={editing.content}
              onChange={(e) =>
                setEditing({ ...editing, content: e.target.value })
              }
              rows={5}
              placeholder="Hi {{requester.firstName}}, ..."
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/30"
            />
            <p className="mb-4 mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
              Placeholders:{" "}
              {TEMPLATE_PLACEHOLDERS.map((key, i) => (
                <span key={key}>
                  {i > 0 && ", "}
                  <button
                    type="button"
                    onClick={() =>
                      setEditing({
                        ...editing,
                        content: `${editing.content}${key}`,
                      })
                    }
                    className="font-mono text-primary hover:underline"
                  >
                    {key}
                  </button>
                </span>
              ))}
              . Anything else fills in as nothing.
            </p>

            {/* Shown when EDITING as well as creating, so a template can move
                between private and shared after the fact. Hidden from anybody
                who is not the author: a lead may maintain their team's shared
                template, but un-sharing it would hide it from the team, and
                sharing somebody's private draft would publish unfinished work.
                The server refuses them either way; this stops the control
                promising something that would be refused. */}
            {(!editing.id || editing.isMine) && (
              <label className="mb-4 flex items-center gap-2 text-sm text-foreground">
                <input
                  type="checkbox"
                  checked={editing.shareWithTeam}
                  disabled={!team}
                  onChange={(e) =>
                    setEditing({ ...editing, shareWithTeam: e.target.checked })
                  }
                  className="h-3.5 w-3.5"
                />
                {team
                  ? `Share with ${team.name}`
                  : "Private (you are on no team)"}
              </label>
            )}
            {editing.id && !editing.isMine && (
              <p className="mb-4 text-[11px] text-muted-foreground">
                Shared with {team?.name ?? "the team"}. Only its author can
                change that.
              </p>
            )}

            <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              <Zap className="h-3 w-3" />
              And it will
            </p>
            <ul className="mb-2 space-y-2">
              {editing.actions.map((action, index) => (
                <li key={index} className="flex items-start gap-1.5">
                  <select
                    aria-label="Action"
                    value={action.type}
                    onChange={(e) =>
                      // REPLACE, never merge. Merging left the previous type's
                      // parameter behind - switch to "Set category" and back to
                      // "Move to team" and the action carried both a teamId and
                      // an empty categoryId, which the server rejects as "must
                      // be a UUID". Found by changing my mind in the editor,
                      // which no unit test does.
                      replaceAction(index, blankAction(e.target.value))
                    }
                    className="rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground"
                  >
                    {EDITABLE_ACTION_TYPES.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                  {action.type === "set_status" && (
                    <select
                      aria-label="Status"
                      value={action.status ?? ""}
                      onChange={(e) =>
                        patchAction(index, { status: e.target.value })
                      }
                      className="rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground"
                    >
                      {TEMPLATE_STATUS_OPTIONS.map((opt) => (
                        <option key={opt} value={opt}>
                          {opt.replace(/_/g, " ").toLowerCase()}
                        </option>
                      ))}
                    </select>
                  )}
                  {action.type === "set_priority" && (
                    <select
                      aria-label="Priority"
                      value={action.priority ?? ""}
                      onChange={(e) =>
                        patchAction(index, { priority: e.target.value })
                      }
                      className="rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground"
                    >
                      {TEMPLATE_PRIORITY_OPTIONS.map((opt) => (
                        <option key={opt} value={opt}>
                          {opt}
                        </option>
                      ))}
                    </select>
                  )}
                  {(action.type === "add_tag" ||
                    action.type === "remove_tag") && (
                    <input
                      aria-label="Tags"
                      value={(action.tags ?? []).join(", ")}
                      onChange={(e) =>
                        patchAction(index, {
                          tags: e.target.value
                            .split(",")
                            .map((tag) => tag.trim())
                            .filter(Boolean),
                        })
                      }
                      placeholder="password, vpn"
                      className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground"
                    />
                  )}
                  {action.type === "add_follower" && (
                    <select
                      aria-label="Follower"
                      value={action.target ?? "requester"}
                      onChange={(e) =>
                        patchAction(index, { target: e.target.value })
                      }
                      className="rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground"
                    >
                      {TEMPLATE_FOLLOWER_TARGETS.map((opt) => (
                        <option key={opt} value={opt}>
                          {opt}
                        </option>
                      ))}
                    </select>
                  )}
                  {action.type === "add_internal_note" && (
                    <input
                      aria-label="Note"
                      value={action.body ?? ""}
                      onChange={(e) =>
                        patchAction(index, { body: e.target.value })
                      }
                      placeholder="Standard reset performed."
                      className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground"
                    />
                  )}
                  {action.type === "set_category" && (
                    <select
                      aria-label="Category"
                      value={action.categoryId ?? ""}
                      onChange={(e) =>
                        patchAction(index, { categoryId: e.target.value })
                      }
                      className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground"
                    >
                      <option value="">Choose a category…</option>
                      {lookups.categories.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  )}
                  {action.type === "assign_team" && (
                    <select
                      aria-label="Team"
                      value={action.teamId ?? ""}
                      onChange={(e) =>
                        patchAction(index, { teamId: e.target.value })
                      }
                      className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground"
                    >
                      <option value="">Choose a team…</option>
                      {lookups.teams.map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.name}
                        </option>
                      ))}
                    </select>
                  )}
                  {action.type === "assign_user" && (
                    <select
                      aria-label="Assignee"
                      value={action.userId ?? ""}
                      onChange={(e) =>
                        patchAction(index, { userId: e.target.value })
                      }
                      className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground"
                    >
                      <option value="">
                        {lookups.people.length > 0
                          ? "Choose a person…"
                          : "No team members to choose"}
                      </option>
                      {lookups.people.map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.name}
                        </option>
                      ))}
                    </select>
                  )}
                  <button
                    type="button"
                    aria-label="Remove this action"
                    onClick={() =>
                      setEditing({
                        ...editing,
                        actions: editing.actions.filter((_, i) => i !== index),
                      })
                    }
                    className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={() =>
                setEditing({
                  ...editing,
                  actions: [...editing.actions, blankAction("set_status")],
                })
              }
              className="mb-4 inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <Plus className="h-3.5 w-3.5" />
              Add an action
            </button>
            {/* Named, so nobody hunts for a control that is deliberately absent. */}
            <p className="mb-4 text-[11px] text-muted-foreground">
              A template cannot send email or notify anyone — that is enforced on
              the server, on save and again when it runs.
            </p>

            <div className="flex items-center justify-between gap-2">
              {editing.id ? (
                <button
                  type="button"
                  onClick={() => void removeTemplate(editing.id as string)}
                  disabled={busy}
                  className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-destructive hover:bg-destructive/10 disabled:opacity-60"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete
                </button>
              ) : (
                <span />
              )}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setEditing(null)}
                  disabled={busy}
                  className="rounded-lg px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted disabled:opacity-60"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void saveTemplate()}
                  disabled={
                    busy ||
                    editing.name.trim() === "" ||
                    editing.content.trim() === ""
                  }
                  className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60"
                >
                  {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  Save template
                </button>
              </div>
            </div>
          </div>
        ) : preview ? (
          <div className="p-4">
            <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              The reply
            </p>
            <p className="mb-4 whitespace-pre-wrap rounded-lg border border-border bg-background p-3 text-sm text-foreground">
              {preview.content}
            </p>
            {preview.actions.length > 0 && (
              <>
                <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                  <Zap className="h-3 w-3" />
                  And it will
                </p>
                <ul className="mb-4 space-y-1">
                  {preview.actions.map((action, index) => (
                    <li
                      key={`${action.type}-${index}`}
                      className="text-sm text-foreground"
                    >
                      · {describeMacroAction(action)}
                    </li>
                  ))}
                </ul>
              </>
            )}
            {preview.skippedActions.length > 0 && (
              <p className="mb-4 text-xs text-muted-foreground">
                {preview.skippedActions.join(", ")} will be skipped — a template
                cannot send email or notify anyone.
              </p>
            )}
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setPreview(null)}
                disabled={busy}
                className="rounded-lg px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted disabled:opacity-60"
              >
                Back
              </button>
              <button
                type="button"
                onClick={() => void confirm()}
                disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60"
              >
                {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {preview.actions.length > 0 ? "Insert and apply" : "Insert"}
              </button>
            </div>
          </div>
        ) : (
          <div className="max-h-72 overflow-auto p-2">
            {loading && (
              <p className="py-4 text-center text-sm text-muted-foreground">
                Loading…
              </p>
            )}
            {!loading && !error && list.length === 0 && (
              <p className="py-4 text-center text-sm text-muted-foreground">
                No templates saved.
              </p>
            )}
            {!loading && list.length > 0 && (
              <ul className="space-y-1">
                {list.map((item) => (
                  <li key={item.id} className="flex items-start gap-1">
                    <button
                      type="button"
                      disabled={busy}
                      className="flex w-full items-start gap-3 rounded-lg px-3 py-2 text-left text-sm hover:bg-muted disabled:opacity-60"
                      onClick={() => void choose(item)}
                    >
                      <FileText className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-foreground">
                          {item.name}
                        </p>
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">
                          {item.content.slice(0, 80)}
                          {item.content.length > 80 ? "…" : ""}
                        </p>
                      </div>
                      {(item.actions?.length ?? 0) > 0 && (
                        <span className="mt-0.5 inline-flex shrink-0 items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                          <Zap className="h-2.5 w-2.5" />
                          {item.actions?.length}
                        </span>
                      )}
                      {item.teamId && (
                        <span className="mt-0.5 shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                          team
                        </span>
                      )}
                    </button>
                    {/* Present only when the SERVER says this person may write
                        it. The rule lives there, not here. */}
                    {item.canWrite && (
                      <button
                        type="button"
                        aria-label={`Edit ${item.name}`}
                        onClick={() =>
                          setEditing({
                            id: item.id,
                            name: item.name,
                            content: item.content,
                            shareWithTeam: item.teamId != null,
                            isMine: item.isMine ?? false,
                            actions: item.actions ?? [],
                          })
                        }
                        className="shrink-0 rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </>
  );
}
