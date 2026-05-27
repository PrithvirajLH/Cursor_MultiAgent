/**
 * The global UI zoom factor applied to <html> via `--ui-zoom` (see styles.css).
 *
 * Why this matters: CSS `zoom` renders a fixed/absolute element's `top/left`
 * at `value * zoom`, but `getBoundingClientRect()` / `innerHeight` report the
 * already-zoomed *visual* coordinates. So when positioning a portal/fixed
 * element from a rect, divide the visual coordinate by the zoom to land it in
 * the right spot: `style.top = rect.bottom / getUiZoom()`.
 */
export function getUiZoom(): number {
  if (typeof document === "undefined") return 1;
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue("--ui-zoom")
    .trim();
  const z = parseFloat(raw);
  return Number.isFinite(z) && z > 0 ? z : 1;
}
