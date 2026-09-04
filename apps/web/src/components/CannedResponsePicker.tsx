import { useEffect, useRef, useState } from "react";
import { FileText, Loader2, X, Zap } from "lucide-react";
import {
  applyCannedResponse,
  fetchCannedResponses,
  renderCannedResponse,
  type CannedResponseRecord,
  type MacroAction,
  type MacroPreview,
} from "../api/client";
import { useModalFocusTrap } from "../hooks/useModalFocusTrap";

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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<MacroPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  useModalFocusTrap({ open, containerRef: dialogRef, onClose });

  useEffect(() => {
    if (!open) return;
    setPreview(null);
    setLoading(true);
    setError(null);
    fetchCannedResponses()
      .then((data) => setList(Array.isArray(data) ? data : []))
      .catch(() => {
        setError("Failed to load templates");
        setList([]);
      })
      .finally(() => setLoading(false));
  }, [open]);

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
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h3 className="text-sm font-semibold text-foreground">
            {preview ? preview.name : "Insert template"}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {error && (
          <p role="alert" className="px-4 pt-3 text-sm text-destructive">
            {error}
          </p>
        )}

        {preview ? (
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
                  <li key={item.id}>
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
                    </button>
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
