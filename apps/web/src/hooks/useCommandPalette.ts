import { useCallback, useEffect, useState } from "react";

const RECENT_SEARCHES_KEY = "commandPalette:recentSearches";
const MAX_RECENT_SEARCHES = 5;

export type RecentSearch = {
  query: string;
  timestamp: number;
};

type UseCommandPaletteOptions = {
  onCreateTicket?: () => void;
};

export function useCommandPalette(options: UseCommandPaletteOptions = {}) {
  const [isOpen, setIsOpen] = useState(false);
  const [recentSearches, setRecentSearches] = useState<RecentSearch[]>([]);

  // Load recent searches from localStorage on mount
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const stored = window.localStorage.getItem(RECENT_SEARCHES_KEY);
      if (stored) {
        setRecentSearches(JSON.parse(stored));
      }
    } catch {
      // Ignore parse errors
    }
  }, []);

  // Save recent searches to localStorage
  const saveRecentSearches = useCallback((searches: RecentSearch[]) => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(
        RECENT_SEARCHES_KEY,
        JSON.stringify(searches),
      );
    } catch {
      // Ignore storage errors
    }
  }, []);

  // Add a search to recent searches
  const addRecentSearch = useCallback(
    (query: string) => {
      if (!query.trim()) return;

      setRecentSearches((prev) => {
        // Remove existing entry with same query
        const filtered = prev.filter(
          (s) => s.query.toLowerCase() !== query.toLowerCase(),
        );
        // Add new entry at the beginning
        const updated = [{ query, timestamp: Date.now() }, ...filtered].slice(
          0,
          MAX_RECENT_SEARCHES,
        );
        saveRecentSearches(updated);
        return updated;
      });
    },
    [saveRecentSearches],
  );

  // Clear recent searches
  const clearRecentSearches = useCallback(() => {
    setRecentSearches([]);
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(RECENT_SEARCHES_KEY);
    }
  }, []);

  // Open the command palette
  const open = useCallback(() => setIsOpen(true), []);

  // Close the command palette
  const close = useCallback(() => setIsOpen(false), []);

  // Toggle the command palette
  const toggle = useCallback(() => setIsOpen((prev) => !prev), []);

  // Handle keyboard shortcuts (Cmd/Ctrl + K, Alt + N)
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      // Don't trigger if user is typing in an input/textarea
      const target = event.target as HTMLElement;
      const isInput =
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable;

      // Don't trigger open/create shortcuts when typing (but allow Escape to close palette when its input is focused)
      if (isInput) {
        if (!(event.key === "Escape" && isOpen)) return;
      }

      // Cmd/Ctrl + K to toggle command palette
      if ((event.metaKey || event.ctrlKey) && event.key === "k") {
        event.preventDefault();
        toggle();
        return;
      }

      // Cmd/Ctrl + N to create new ticket (Task 1.4 acceptance criteria)
      if (
        (event.metaKey || event.ctrlKey) &&
        event.key === "n" &&
        options.onCreateTicket
      ) {
        event.preventDefault();
        close(); // Close palette if open
        options.onCreateTicket();
        return;
      }

      // Alt + N to create new ticket (alternative shortcut)
      if (event.altKey && event.key === "n" && options.onCreateTicket) {
        event.preventDefault();
        close(); // Close palette if open
        options.onCreateTicket();
        return;
      }

      // Escape to close
      if (event.key === "Escape" && isOpen) {
        event.preventDefault();
        close();
        return;
      }

      // "/" to open (only if not in input and palette is closed)
      if (
        event.key === "/" &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        !isInput &&
        !isOpen
      ) {
        event.preventDefault();
        open();
        return;
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, open, close, toggle, options]);

  return {
    isOpen,
    open,
    close,
    toggle,
    recentSearches,
    addRecentSearch,
    clearRecentSearches,
  };
}
