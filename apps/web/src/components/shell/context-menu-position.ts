/**
 * Where a context menu should sit, given the pointer and the viewport.
 *
 * ⚠️ THE DIVISION BY ZOOM IS THE SUBTLE PART, and it is why this is extracted
 * rather than re-derived. `x`/`y` are VISUAL cursor coordinates, but a `fixed`
 * element is laid out at `value * zoom`, so placing the menu under the cursor
 * means dividing first. Getting it wrong puts the menu progressively further
 * from the pointer the further down the page you click, which is the kind of
 * bug that gets described as "it feels off" rather than reported.
 *
 * Card 1.73 pulled this out of `TicketContextMenu` so the message menu could
 * share it. It is a pure function specifically so it can be tested: this web
 * suite runs in a node environment with no DOM, so the alternative was no
 * coverage of the one piece of arithmetic in the component.
 *
 * The clamps keep the menu on screen. They subtract an estimate of the menu's
 * own size, so a click near the bottom or right edge opens upward/leftward
 * instead of overflowing.
 *
 * @param input Pointer position, viewport size, zoom, and the menu's estimated
 *   extent. `zoom` of 0 or less is treated as 1 — a broken zoom reading should
 *   misplace a menu slightly, never divide by zero.
 * @returns `top` and `left` in CSS pixels for a `position: fixed` element.
 */
export function contextMenuPosition(input: {
  readonly x: number;
  readonly y: number;
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  readonly zoom: number;
  readonly menuHeight: number;
  readonly menuWidth: number;
}): { top: number; left: number } {
  const zoom = input.zoom > 0 ? input.zoom : 1;
  return {
    top: Math.min(input.y, input.viewportHeight - input.menuHeight) / zoom,
    left: Math.min(input.x, input.viewportWidth - input.menuWidth) / zoom,
  };
}
