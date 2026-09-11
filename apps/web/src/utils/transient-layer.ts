/**
 * Whether a transient layer — a dialog, a popover, a context menu — is open.
 *
 * ⚠️ CARD 1.76. A page-level keyboard shortcut must stand down while one of
 * these is up, or the key the reader pressed to dismiss the layer also fires the
 * shortcut behind it. On the ticket page that meant pressing Escape to close a
 * context menu navigated you off the ticket entirely — and the navigation was
 * the dominant effect, not a side effect.
 *
 * ⚠️ AND `stopPropagation` CANNOT FIX THAT, which is worth recording because it
 * is the obvious wrong answer. `TicketDetailPage` registers its handler on
 * `window` with `capture: true`; an overlay's own listener is on `document` in
 * the bubble phase. Capture runs first and `window` is the first node in the
 * capture path, so the page has already navigated before the overlay's listener
 * is reached. Nothing the overlay does afterwards can undo it. The shortcut has
 * to ask, up front, whether it should run at all.
 *
 * ⚠️ WHY ROLES RATHER THAN AN OPT-IN ATTRIBUTE. The guard this replaces asked
 * for `[role="dialog"][aria-modal="true"]`, which required every overlay to
 * remember to be modal. Four overlays in this app are deliberately NOT modal —
 * the notification panel, the profile popover, the save-view popover and the
 * saved-view delete confirmation. They are anchored popovers: they do not trap
 * focus and the page behind them stays usable, so claiming `aria-modal` would be
 * a false promise to a screen reader and a worse bug than the one being fixed.
 * Asking about the ROLE covers all of them, and covers the next one for free —
 * which matters, because this list has grown twice and the growth is what broke
 * it. `data-transient-layer` remains as an escape hatch for a layer that is
 * neither a dialog nor a menu.
 *
 * Every such overlay in this app is conditionally rendered, so a match means one
 * is genuinely open rather than merely defined.
 *
 * @returns True when the caller should let the key through untouched.
 */
export function isTransientLayerOpen(): boolean {
  return Boolean(
    document.querySelector(
      '[role="dialog"], [role="menu"], [data-transient-layer]',
    ),
  );
}
