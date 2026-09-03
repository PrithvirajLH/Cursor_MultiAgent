import { useState } from "react";
import { ChevronDown, ChevronRight, X } from "lucide-react";
import type { MessageAudience as Audience } from "../../api/client";
import { ConfirmDialog } from "../ConfirmDialog";

export type MessageAudienceProps = {
  /** The public audience. Null while it is still being fetched. */
  publicAudience: Audience | null;
  /** The internal audience. Null while it is still being fetched. */
  internalAudience: Audience | null;
  /** Which one to show — follows the composer's toggle. */
  messageType: "PUBLIC" | "INTERNAL";
  /** True when either fetch failed. */
  error: boolean;
  /** Unfollow someone from the ticket. Resolves once the audience is refreshed. */
  onRemove: (userId: string, name: string) => Promise<void>;
  /**
   * Why this agent cannot reply publicly, when they cannot (card 1.41).
   *
   * Null for everyone who is not blocked - including a LEAD who has simply
   * chosen to write an internal note, who must see none of this. Card 1.38's
   * rule is AGENT-only and this wording must not widen it.
   */
  blockedReason?: "unassigned" | "assigned-to-teammate" | null;
  /** Assign the ticket to the current user. Present only when that is the way out. */
  onAssignSelf?: () => void;
  /** True while that assignment is in flight. */
  assigning?: boolean;
};

/**
 * Who this message will reach, directly above the compose box (card 1.28).
 *
 * Card 1.33 made a reply ONE email (To: the requester, Cc: the rest) and 1.34
 * took "Also copied" out of the body, so this line is now the only place
 * anybody sees the audience. An agent writing something candid on a
 * termination ticket would otherwise have to hunt three people to identify
 * them. On payroll and HR tickets that is a safety gap, not a convenience —
 * which is why it sits where it cannot be missed while writing rather than in
 * the sidebar or behind a disclosure.
 *
 * Removal unfollows from the TICKET, not from this one message. A per-message
 * exclusion is state nobody would understand in three months, and it would
 * silently vary the audience between messages in one thread.
 */
export function MessageAudience({
  publicAudience,
  internalAudience,
  messageType,
  error,
  onRemove,
  blockedReason = null,
  onAssignSelf,
  assigning = false,
}: MessageAudienceProps) {
  const [expanded, setExpanded] = useState(false);
  const [pending, setPending] = useState<{ id: string; name: string } | null>(
    null,
  );
  const [removing, setRemoving] = useState(false);
  const audience =
    messageType === "INTERNAL" ? internalAudience : publicAudience;

  // Never silently show nothing: absence reads as "nobody", which is the one
  // wrong answer. An error says so; a load in progress renders nothing because
  // this is secondary furniture and a spinner here would be noise.
  if (error) {
    return (
      <p className="px-3 pt-2 text-[11px] text-muted-foreground">
        Couldn’t check who this reaches
      </p>
    );
  }
  if (!audience) return null;

  if (!audience.emails) {
    return (
      <div className="px-3 pt-2 text-[11px] text-muted-foreground">
        <p>Internal note — staff only, no email sent.</p>
        {/*
          Card 1.41. Card 1.38 stops an agent sending a public reply that would
          be silently stored as private, then explained the way out in a `title`
          on a <span> - hover-only, and a span cannot take focus, so a keyboard
          user could never reach it at all. The sentence lives here instead:
          already visible, already directly above the box they are about to type
          in, and no new layout. The chip stays as the at-a-glance marker.

          The two blocked cases stay distinct, because card 1.38's owner ruling
          turns on the difference.
        */}
        {blockedReason === "unassigned" ? (
          <p className="mt-0.5">
            {onAssignSelf ? (
              <>
                <button
                  type="button"
                  onClick={onAssignSelf}
                  disabled={assigning}
                  className="rounded font-medium text-primary underline underline-offset-2 hover:no-underline focus:outline-none focus:ring-2 focus:ring-ring/30 disabled:opacity-60"
                >
                  {assigning ? "Assigning…" : "Assign this ticket to yourself"}
                </button>{" "}
                to reply to the requester — until then anything you write is an
                internal note.
              </>
            ) : (
              <>
                Assign this ticket to yourself to reply to the requester — until
                then anything you write is an internal note.
              </>
            )}
          </p>
        ) : null}
        {blockedReason === "assigned-to-teammate" ? (
          <p className="mt-0.5">
            This ticket is assigned to a teammate, so you can only leave internal
            notes on it.
          </p>
        ) : null}
      </div>
    );
  }

  const names = [
    ...(audience.to ? [audience.to.name] : []),
    ...audience.cc.map((entry) => entry.name),
  ];

  return (
    <div className="px-3 pt-2 text-[11px] text-muted-foreground">
      <div className="flex items-start gap-1.5">
        <button
          type="button"
          onClick={() => setExpanded((open) => !open)}
          className="inline-flex items-center gap-1 text-left hover:text-foreground"
          aria-expanded={expanded}
        >
          {expanded ? (
            <ChevronDown className="h-3 w-3 shrink-0" />
          ) : (
            <ChevronRight className="h-3 w-3 shrink-0" />
          )}
          <span>
            {names.length > 0 ? (
              <>
                Goes to{" "}
                <span className="text-foreground">{names[0]}</span>
                {names.length > 1 ? (
                  <span> · {names.slice(1).join(", ")}</span>
                ) : null}
              </>
            ) : (
              "Goes to nobody — no reachable recipients"
            )}
          </span>
        </button>
        {audience.refused.length > 0 ? (
          <span
            className="shrink-0 cursor-help text-amber-600 dark:text-amber-400"
            title={audience.refused
              .map((entry) => `${entry.address}: ${entry.reason}`)
              .join("\n")}
          >
            {audience.refused.length} address
            {audience.refused.length === 1 ? "" : "es"} cannot be emailed
          </span>
        ) : null}
      </div>

      {expanded ? (
        <ul className="mt-1.5 space-y-1 pl-4">
          {audience.to ? (
            <li className="flex items-center gap-2">
              <span className="text-foreground">{audience.to.name}</span>
              {/* A public reply with no To: is not a thing. */}
              <span className="text-muted-foreground">requester</span>
            </li>
          ) : null}
          {audience.cc.map((entry) => (
            <li key={entry.id} className="flex items-center gap-2">
              <span className="text-foreground">{entry.name}</span>
              {entry.removable ? (
                <button
                  type="button"
                  onClick={() => setPending({ id: entry.id, name: entry.name })}
                  className="rounded p-0.5 hover:bg-muted hover:text-foreground"
                  aria-label={`Stop ${entry.name} following this ticket`}
                  title={`Stop ${entry.name} following this ticket`}
                >
                  <X className="h-3 w-3" />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      <ConfirmDialog
        open={pending !== null}
        title="Stop following?"
        message={
          pending
            ? `${pending.name} will stop following this ticket and will not receive this reply or any later one. They can be added back as a follower.`
            : ""
        }
        confirmLabel="Stop following"
        destructive
        loading={removing}
        onConfirm={() => {
          if (!pending) return;
          setRemoving(true);
          void onRemove(pending.id, pending.name).finally(() => {
            setRemoving(false);
            setPending(null);
          });
        }}
        onCancel={() => setPending(null)}
      />
    </div>
  );
}
