import { describe, expect, it, vi } from "vitest";
import {
  shouldRowKeyActivate,
  ticketSelectionCellWiring,
} from "./ticket-selection-cell";

const clickEvent = () => ({
  stopPropagation: vi.fn(),
  preventDefault: vi.fn(),
});

/**
 * Card 1.49 — the row checkbox did nothing, and no test noticed.
 *
 * The one test that touched this control passed `toggle: () => {}` as a stub
 * and used the checkbox's `aria-label` only as a text anchor to find a row.
 * Nothing clicked the box and asserted the selection changed, which is why a
 * dead control sat in the product through a full green suite.
 */
describe("ticket row selection wiring", () => {
  it("⚠️ toggles when the CHECKBOX itself changes", () => {
    // THE ASSERTION THAT FAILS IF THE BUG COMES BACK. `onChange` used to be
    // `() => {}`, so clicking the box - and pressing Space on it - did nothing
    // at all while clicking the padding beside it worked.
    const toggle = vi.fn();
    const wiring = ticketSelectionCellWiring("t-1", toggle);
    wiring.input.onChange();
    expect(toggle).toHaveBeenCalledTimes(1);
    expect(toggle).toHaveBeenCalledWith("t-1");
  });

  it("⚠️ is reachable by keyboard, because Space goes through the same handler", () => {
    // Space on a focused checkbox dispatches a click, which React delivers to
    // onChange. That is the same path as the mouse, so the fix covers both -
    // and the row had no other way to be selected.
    const toggle = vi.fn();
    const wiring = ticketSelectionCellWiring("t-2", toggle);
    const event = clickEvent();
    wiring.input.onClick(event);
    wiring.input.onChange();
    expect(toggle).toHaveBeenCalledTimes(1);
    expect(toggle).toHaveBeenCalledWith("t-2");
  });

  it("toggles when the surrounding cell is clicked", () => {
    const toggle = vi.fn();
    const wiring = ticketSelectionCellWiring("t-3", toggle);
    const event = clickEvent();
    wiring.cell.onClick(event);
    expect(toggle).toHaveBeenCalledTimes(1);
    expect(event.stopPropagation).toHaveBeenCalled();
    expect(event.preventDefault).toHaveBeenCalled();
  });

  it("⚠️ does not toggle twice for one click on the box", () => {
    // Two toggles net to zero and look IDENTICAL to the original bug. The
    // input stops propagation, so the cell's handler never sees the click.
    const toggle = vi.fn();
    const wiring = ticketSelectionCellWiring("t-4", toggle);
    const event = clickEvent();
    wiring.input.onClick(event);
    expect(event.stopPropagation).toHaveBeenCalled();
    // A real click that reached the cell too would call the cell handler here;
    // stopPropagation is what guarantees it cannot.
    wiring.input.onChange();
    expect(toggle).toHaveBeenCalledTimes(1);
  });

  it("keeps the row's own click out of it, so selecting never navigates", () => {
    const toggle = vi.fn();
    const wiring = ticketSelectionCellWiring("t-5", toggle);
    const event = clickEvent();
    wiring.cell.onClick(event);
    expect(event.stopPropagation).toHaveBeenCalled();
  });
});

/**
 * Card 1.49, the keyboard half — found in the browser pass, after the click
 * fix was already committed.
 */
describe("row key activation", () => {
  const row = { tag: "tr" };
  const box = { tag: "input" };

  it("⚠️ does NOT open the ticket when Space came from the checkbox", () => {
    // THE ASSERTION THAT FAILS IF THE BUG COMES BACK. Space on a focused
    // checkbox both ticked it and navigated away, so the selection was made
    // and instantly abandoned — worse than the dead control it replaced.
    expect(
      shouldRowKeyActivate({ key: " ", target: box, currentTarget: row }),
    ).toBe(false);
    expect(
      shouldRowKeyActivate({ key: "Enter", target: box, currentTarget: row }),
    ).toBe(false);
  });

  it("still opens the ticket from the row itself", () => {
    expect(
      shouldRowKeyActivate({ key: "Enter", target: row, currentTarget: row }),
    ).toBe(true);
    expect(
      shouldRowKeyActivate({ key: " ", target: row, currentTarget: row }),
    ).toBe(true);
  });

  it("ignores other keys, so typing never navigates", () => {
    expect(
      shouldRowKeyActivate({ key: "a", target: row, currentTarget: row }),
    ).toBe(false);
    expect(
      shouldRowKeyActivate({ key: "Tab", target: row, currentTarget: row }),
    ).toBe(false);
  });
});
