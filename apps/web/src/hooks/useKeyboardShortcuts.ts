import { useCallback, useEffect, useState } from "react";

export type ShortcutContext = "global" | "tickets-list" | "ticket-detail";

/**
 * Derive keyboard shortcut context from pathname for help modal.
 */
export function getShortcutContext(pathname: string): ShortcutContext {
  if (pathname.match(/^\/tickets\/[^/]+$/)) {
    return "ticket-detail";
  }
  if (pathname.startsWith("/tickets") || pathname === "/triage") {
    return "tickets-list";
  }
  return "global";
}

const FOCUS_SEARCH_EVENT = "focus-search";

/**
 * Dispatch focus-search so pages with a search input can focus it.
 */
export function dispatchFocusSearch() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(FOCUS_SEARCH_EVENT));
  }
}

/**
 * Listen for focus-search (e.g. from Cmd+/) and focus the given ref.
 */
export function useFocusSearchOnShortcut(inputRef: {
  current: HTMLInputElement | null;
}) {
  useEffect(() => {
    function handleFocusSearch() {
      inputRef.current?.focus();
    }
    window.addEventListener(FOCUS_SEARCH_EVENT, handleFocusSearch);
    return () =>
      window.removeEventListener(FOCUS_SEARCH_EVENT, handleFocusSearch);
  }, [inputRef]);
}

/**
 * Global keyboard shortcuts: Cmd+/, ? (show help).
 * Cmd+K and Alt+N are handled by useCommandPalette.
 */
export function useKeyboardShortcuts() {
  const [showHelp, setShowHelp] = useState(false);

  const openHelp = useCallback(() => setShowHelp(true), []);
  const closeHelp = useCallback(() => setShowHelp(false), []);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement;
      const isInput =
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable;

      // ? - Show keyboard shortcuts help (only when not typing)
      if (
        event.key === "?" &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey
      ) {
        if (!isInput) {
          event.preventDefault();
          setShowHelp((prev) => !prev);
        }
        return;
      }

      // Cmd/Ctrl + / - Focus search (dispatch so current page can focus its search input)
      if ((event.metaKey || event.ctrlKey) && event.key === "/") {
        event.preventDefault();
        if (!isInput) {
          dispatchFocusSearch();
        }
        return;
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return {
    showHelp,
    openHelp,
    closeHelp,
  };
}
