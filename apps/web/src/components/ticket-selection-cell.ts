/**
 * How a ticket row's select-me checkbox is wired (card 1.49).
 *
 * ⚠️ THIS EXISTS SO THE WIRING CAN BE TESTED AT ALL.
 *
 * The bug: the `<td>` owned the toggle and the `<input>` had
 * `onChange={() => {}}` — a no-op — plus `onClick` stopPropagation. So a click
 * on the box was stopped before it reached the only handler that acted, while a
 * click on the surrounding padding worked. It read as flaky rather than dead,
 * and it took Space with it: a focused checkbox dispatches a click, so the
 * control was unreachable by keyboard and the row had no other way to be
 * selected. Card 1.12 made bulk selection something agents use every day.
 *
 * ⚠️ EXACTLY ONE TOGGLE PER CLICK. The input keeps `stopPropagation` so the
 * cell's handler does not also fire — two toggles net to zero and look
 * *identical* to the original bug. The cell keeps its own handler because the
 * padding is a much bigger target than a 16px box.
 *
 * The project's vitest runs in a node environment with no jsdom, so nothing in
 * the suite can dispatch a real click. Returning the handlers from a plain
 * function is what makes "the box actually toggles" assertable; the browser
 * pass is what proves this is the wiring the component uses.
 */
export type TicketSelectionCellWiring = {
  /** Props for the `<td>` around the box — the larger click target. */
  cell: { onClick: (event: SelectionClickEvent) => void };
  /** Props for the `<input type="checkbox">` itself. */
  input: {
    onChange: () => void;
    onClick: (event: SelectionClickEvent) => void;
  };
};

/** Just the bits of a React mouse event this needs, so it is testable. */
export type SelectionClickEvent = {
  stopPropagation: () => void;
  preventDefault: () => void;
};

export function ticketSelectionCellWiring(
  ticketId: string,
  toggle: (ticketId: string) => void,
): TicketSelectionCellWiring {
  return {
    cell: {
      onClick: (event) => {
        // The row itself opens the ticket, so selecting must not also navigate.
        event.stopPropagation();
        event.preventDefault();
        toggle(ticketId);
      },
    },
    input: {
      // The fix. This was `() => {}`, which is why clicking the box did
      // nothing and Space did nothing either.
      onChange: () => toggle(ticketId),
      // Keeps the cell's handler and the row's navigation out of it, so one
      // click is one toggle.
      onClick: (event) => event.stopPropagation(),
    },
  };
}
