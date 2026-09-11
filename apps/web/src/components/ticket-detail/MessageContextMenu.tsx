import { Copy, Send, Trash2, Users } from "lucide-react";
import { ContextMenuShell } from "../shell/context-menu-shell";

export type MessageMenuMessage = {
  id: string;
  body: string;
  redactedAt?: string | null;
  delivery?: {
    emailed: number;
    refused: number;
    pending: number;
    recipients: string[];
    internal: boolean;
  };
};

const itemClass =
  "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm font-medium text-foreground hover:bg-muted transition-colors text-left";
const readOnlyClass =
  "flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-muted-foreground";

/**
 * What a message's delivery amounts to, in one line (card 1.73).
 *
 * ⚠️ INCLUDES `pending`, WHICH THE SCREEN USED TO DROP. The API had always
 * returned it; the conversation's own `deliveryLabel` type omitted it, so a
 * message whose email was still queued rendered nothing at all — identical to
 * an internal note that was never emailed. Production has no Redis, so the
 * sweeper runs on a 60-second interval and "queued" is a state a person really
 * sees.
 */
function deliverySummary(delivery: MessageMenuMessage["delivery"]): string {
  if (!delivery) return "No delivery information";
  if (delivery.internal) return "Internal note — not emailed";
  const parts: string[] = [];
  if (delivery.emailed > 0) parts.push(`Emailed to ${delivery.emailed}`);
  if (delivery.pending > 0) parts.push(`${delivery.pending} queued`);
  if (delivery.refused > 0) parts.push(`${delivery.refused} refused`);
  return parts.length > 0 ? parts.join(" · ") : "Not emailed";
}

/**
 * The per-message right-click menu the owner asked for.
 *
 * Today the only per-message action is a hover-revealed **Remove** link hanging
 * off the side of the bubble (card 1.11). The owner pointed at it and asked for
 * "all the actions we can do on the chat message" on right-click.
 *
 * ⚠️ CARD 1.11'S CONSTRAINT STILL HOLDS AND IS BETTER SERVED HERE. Its comment
 * explains the control sits *under* the bubble because a control layered over
 * the text would cover the very words somebody is deciding about. A context
 * menu answers that better than the link did: it opens at the pointer and
 * closes again, so it covers the text only while you are choosing. The
 * reasoning was right; the conclusion moved.
 *
 * ⚠️ ITEMS THE VIEWER MAY NOT USE ARE ABSENT, NOT DISABLED — a greyed row
 * invites a support question. Remove appears only under the same guard the link
 * used.
 *
 * The two read-only rows are deliberately not `menuitem`s: they are information,
 * not actions, so they stay out of the Arrow-key rotation and out of the
 * keyboard user's way.
 */
export function MessageContextMenu({
  x,
  y,
  message,
  canRemove,
  onCopy,
  onRemove,
  onClose,
}: {
  x: number;
  y: number;
  message: MessageMenuMessage;
  canRemove: boolean;
  onCopy: (message: MessageMenuMessage) => void;
  onRemove: (message: MessageMenuMessage) => void;
  onClose: () => void;
}) {
  const recipients = message.delivery?.recipients ?? [];
  return (
    <ContextMenuShell
      x={x}
      y={y}
      ariaLabel="Message actions"
      onClose={onClose}
      menuHeight={220}
      menuWidth={260}
      widthClass="w-64"
    >
      <button
        type="button"
        role="menuitem"
        onClick={(e) => {
          e.stopPropagation();
          onCopy(message);
          onClose();
        }}
        className={itemClass}
      >
        <Copy className="h-4 w-4 text-slate-400 shrink-0" />
        Copy text
      </button>

      <div className="my-0.5 border-b border-border" />

      <div className={readOnlyClass}>
        <Send className="mt-0.5 h-3.5 w-3.5 text-slate-400 shrink-0" />
        <span>{deliverySummary(message.delivery)}</span>
      </div>

      <div className={readOnlyClass}>
        <Users className="mt-0.5 h-3.5 w-3.5 text-slate-400 shrink-0" />
        <span>
          {recipients.length > 0 ? (
            <>
              <span className="block font-medium text-foreground">Sent to</span>
              {recipients.map((address) => (
                <span key={address} className="block break-all">
                  {address}
                </span>
              ))}
            </>
          ) : (
            "No recipients recorded"
          )}
        </span>
      </div>

      {canRemove ? (
        <>
          <div className="my-0.5 border-b border-border" />
          <button
            type="button"
            role="menuitem"
            onClick={(e) => {
              e.stopPropagation();
              onRemove(message);
              onClose();
            }}
            className={`${itemClass} hover:text-destructive`}
          >
            <Trash2 className="h-4 w-4 text-slate-400 shrink-0" />
            Remove
          </button>
        </>
      ) : null}
    </ContextMenuShell>
  );
}
