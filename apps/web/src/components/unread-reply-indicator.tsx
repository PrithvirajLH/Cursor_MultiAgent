import { MessageSquare } from "lucide-react";

/**
 * The red bar down the left edge of a row with unread replies (card 1.138).
 *
 * ⚠️ AN INSET BOX-SHADOW, NOT A BORDER, because one of the two lists is a
 * `<table>` and a `border-left` on a `<tr>` does not render under
 * `border-collapse`. The selected-row treatment beside it already solved this
 * the same way, so the two sit together instead of fighting.
 *
 * ⚠️ EXPORTED AS A STRING AND NOT COPIED. Both lists need the identical bar,
 * and a Tailwind class written out twice is how the queue table and the rail
 * would drift apart - the failure this project keeps paying for.
 */
export const UNREAD_REPLY_ROW_BAR =
  "shadow-[inset_3px_0_0_0_theme(colors.red.500)]";

/**
 * How many unread replies, as the red badge from the owner's design 3.
 *
 * ⚠️ IT MEANS UNREAD, NOT "THE REQUESTER SPOKE LAST". It replaced the quiet
 * blue "Replied" pill, which stayed on a row after somebody had read the reply
 * - the owner's words were *"seen doesn't show up as reply received"*. This
 * disappears the moment anyone on the desk opens the ticket.
 *
 * @param count Unread replies from outside the desk; renders nothing at zero.
 */
export function UnreadReplyBadge({ count }: { count: number }) {
  if (count <= 0) {
    return null;
  }
  return (
    <span
      data-unread-replies={count}
      title={
        count === 1
          ? "One reply nobody has read yet"
          : `${count} replies nobody has read yet`
      }
      className="inline-flex shrink-0 items-center gap-1 rounded-full bg-red-600 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white"
    >
      <MessageSquare className="h-3 w-3" aria-hidden="true" />
      {/* Capped, so a long-neglected thread cannot widen the column. */}
      <span>{count > 9 ? "9+" : count}</span>
    </span>
  );
}
