import { useEffect, useRef, type RefObject } from "react";

type UseModalFocusTrapArgs = {
  open: boolean;
  containerRef: RefObject<HTMLElement | null>;
  onClose?: () => void;
};

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "textarea:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

/**
 * Trap focus inside an open modal, and give it back when the modal closes.
 *
 * ⚠️ CARD 1.58. `onClose` USED TO BE IN THE EFFECT'S DEPENDENCY ARRAY, and an
 * inline arrow is the natural thing to pass for it. A fresh function identity on
 * every render meant the effect tore down and re-ran on every render, and its
 * cleanup calls `previouslyFocused?.focus()` - so the caret was yanked out of
 * the dialog and back to whatever had opened it, mid-keystroke.
 *
 * It needs a re-render WHILE the dialog is open, so it never reproduced on a
 * modal you open and immediately click. It blocked a browser check on card 1.56,
 * and it was worse before that card: the old macro tag field called
 * `patchAction` on every keystroke, so every character caused the re-render that
 * stole the caret from the next one.
 *
 * ⚠️ **Fixed in the HOOK, not at the call site**, because there are FIFTEEN call
 * sites across eleven files and several pass an inline arrow. A call-site fix
 * repairs one dialog and leaves the rest broken, and the next person to write
 * `onClose={() => setThing(false)}` re-breaks whichever one they touch. Holding
 * the callback in a ref makes the identity irrelevant for good.
 *
 * ⚠️ **The focus-restore itself is deliberate and must stay** - returning focus
 * to the opener is the accessible behaviour. The bug was WHEN it ran, not that
 * it ran.
 */
export function useModalFocusTrap({
  open,
  containerRef,
  onClose,
}: UseModalFocusTrapArgs) {
  // Always the latest handler, never a dependency. Written on every render so a
  // stale closure can never be invoked, read only when Escape is actually
  // pressed.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });
  useEffect(() => {
    if (!open) return;
    const container = containerRef.current;
    if (!container) return;

    const previouslyFocused =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;

    const focusFirstElement = () => {
      const focusables = Array.from(
        container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      );
      if (focusables.length > 0) {
        focusables[0].focus();
        return;
      }
      container.focus();
    };

    const timer = window.setTimeout(focusFirstElement, 0);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current?.();
        return;
      }

      if (event.key !== "Tab") return;

      const focusables = Array.from(
        container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      );
      if (focusables.length === 0) {
        event.preventDefault();
        container.focus();
        return;
      }

      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement as HTMLElement | null;

      if (event.shiftKey) {
        if (active === first || !container.contains(active)) {
          event.preventDefault();
          last.focus();
        }
        return;
      }

      if (active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("keydown", handleKeyDown);
      previouslyFocused?.focus();
    };
    // ⚠️ `onClose` is deliberately ABSENT: see the note above. `containerRef` is
    // a `useRef` object, whose identity is stable for the component's lifetime,
    // so it costs nothing to keep. Adding anything render-scoped here brings the
    // bug straight back.
  }, [open, containerRef]);
}
