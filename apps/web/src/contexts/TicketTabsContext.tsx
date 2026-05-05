import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";

export type TicketTab = {
  id: string;
  displayId: string;
  subject: string;
  status: string;
  priority: string;
};

type TicketTabsContextValue = {
  tabs: TicketTab[];
  activeTabId: string | null;
  openTab: (tab: TicketTab) => void;
  /**
   * Swap the active tab's content for the given ticket. If no tab is active,
   * behaves like openTab. If the ticket is already open in another tab, just
   * switches to that existing tab without duplicating it.
   */
  replaceActiveTab: (tab: TicketTab) => void;
  closeTab: (id: string) => void;
  switchTab: (id: string) => void;
  closeOtherTabs: (id: string) => void;
  closeAllTabs: () => void;
  updateTab: (id: string, updates: Partial<TicketTab>) => void;
  setActiveTabId: (id: string | null) => void;
  /**
   * Reorder tabs by moving the tab with id `fromId` to either before or after
   * the tab with id `toId`. Used for drag-and-drop reordering.
   */
  reorderTabs: (
    fromId: string,
    toId: string,
    position?: "before" | "after",
  ) => void;
};

const STORAGE_KEY = "csh-ticket-tabs";
const MAX_TABS = 15;

function loadTabs(): TicketTab[] {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as TicketTab[];
  } catch {}
  return [];
}

function saveTabs(tabs: TicketTab[]) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(tabs));
  } catch {}
}

function loadActiveId(): string | null {
  try {
    return sessionStorage.getItem(STORAGE_KEY + ":active") || null;
  } catch {
    return null;
  }
}

function saveActiveId(id: string | null) {
  try {
    if (id) {
      sessionStorage.setItem(STORAGE_KEY + ":active", id);
    } else {
      sessionStorage.removeItem(STORAGE_KEY + ":active");
    }
  } catch {}
}

const TicketTabsContext = createContext<TicketTabsContextValue | null>(null);

export function TicketTabsProvider({ children }: { children: ReactNode }) {
  const [tabs, setTabs] = useState<TicketTab[]>(loadTabs);
  const [activeTabId, setActiveTabIdState] = useState<string | null>(
    loadActiveId,
  );

  const setActiveTabId = useCallback((id: string | null) => {
    setActiveTabIdState(id);
    saveActiveId(id);
  }, []);

  const openTab = useCallback(
    (tab: TicketTab) => {
      setTabs((prev) => {
        const existing = prev.find((t) => t.id === tab.id);
        if (existing) {
          // Update metadata if changed
          const updated = prev.map((t) =>
            t.id === tab.id ? { ...t, ...tab } : t,
          );
          saveTabs(updated);
          return updated;
        }
        // Add new tab, evict oldest if at max
        const next =
          prev.length >= MAX_TABS ? [...prev.slice(1), tab] : [...prev, tab];
        saveTabs(next);
        return next;
      });
      setActiveTabId(tab.id);
    },
    [setActiveTabId],
  );

  const replaceActiveTab = useCallback(
    (tab: TicketTab) => {
      setTabs((prev) => {
        // If the ticket is already open in some tab, just refresh its
        // metadata and switch to it — no duplicate tab.
        const existingIdx = prev.findIndex((t) => t.id === tab.id);
        if (existingIdx !== -1) {
          const updated = prev.map((t) =>
            t.id === tab.id ? { ...t, ...tab } : t,
          );
          saveTabs(updated);
          return updated;
        }
        // No active tab — fall back to appending.
        if (!activeTabId) {
          const next =
            prev.length >= MAX_TABS
              ? [...prev.slice(1), tab]
              : [...prev, tab];
          saveTabs(next);
          return next;
        }
        // Replace the active tab in place.
        const idx = prev.findIndex((t) => t.id === activeTabId);
        if (idx === -1) {
          const next =
            prev.length >= MAX_TABS
              ? [...prev.slice(1), tab]
              : [...prev, tab];
          saveTabs(next);
          return next;
        }
        const next = [...prev];
        next[idx] = tab;
        saveTabs(next);
        return next;
      });
      setActiveTabId(tab.id);
    },
    [activeTabId, setActiveTabId],
  );

  const closeTab = useCallback(
    (id: string) => {
      setTabs((prev) => {
        const idx = prev.findIndex((t) => t.id === id);
        if (idx === -1) return prev;
        const next = prev.filter((t) => t.id !== id);
        saveTabs(next);

        // If closing the active tab, switch to adjacent
        if (activeTabId === id) {
          const newActive =
            next.length === 0
              ? null
              : idx < next.length
                ? next[idx].id
                : next[next.length - 1].id;
          setActiveTabId(newActive);
        }

        return next;
      });
    },
    [activeTabId, setActiveTabId],
  );

  const switchTab = useCallback(
    (id: string) => {
      setActiveTabId(id);
    },
    [setActiveTabId],
  );

  const closeOtherTabs = useCallback(
    (id: string) => {
      setTabs((prev) => {
        const keep = prev.filter((t) => t.id === id);
        saveTabs(keep);
        return keep;
      });
      setActiveTabId(id);
    },
    [setActiveTabId],
  );

  const closeAllTabs = useCallback(() => {
    setTabs([]);
    saveTabs([]);
    setActiveTabId(null);
  }, [setActiveTabId]);

  const reorderTabs = useCallback(
    (
      fromId: string,
      toId: string,
      position: "before" | "after" = "before",
    ) => {
      if (fromId === toId) return;
      setTabs((prev) => {
        const fromIdx = prev.findIndex((t) => t.id === fromId);
        const toIdx = prev.findIndex((t) => t.id === toId);
        if (fromIdx === -1 || toIdx === -1) return prev;
        // Insert position is the target's index (before) or +1 (after).
        // After splicing the moved tab out, the target's index might shift
        // left by one if it sat after the moved tab — compensate.
        let insertIdx = position === "after" ? toIdx + 1 : toIdx;
        if (fromIdx < insertIdx) insertIdx--;
        if (insertIdx === fromIdx) return prev;
        const next = [...prev];
        const [moved] = next.splice(fromIdx, 1);
        next.splice(insertIdx, 0, moved);
        saveTabs(next);
        return next;
      });
    },
    [],
  );

  const updateTab = useCallback((id: string, updates: Partial<TicketTab>) => {
    setTabs((prev) => {
      const next = prev.map((t) => (t.id === id ? { ...t, ...updates } : t));
      saveTabs(next);
      return next;
    });
  }, []);

  return (
    <TicketTabsContext.Provider
      value={{
        tabs,
        activeTabId,
        openTab,
        replaceActiveTab,
        closeTab,
        switchTab,
        closeOtherTabs,
        closeAllTabs,
        updateTab,
        setActiveTabId,
        reorderTabs,
      }}
    >
      {children}
    </TicketTabsContext.Provider>
  );
}

export function useTicketTabs(): TicketTabsContextValue {
  const ctx = useContext(TicketTabsContext);
  if (!ctx) {
    throw new Error("useTicketTabs must be used within TicketTabsProvider");
  }
  return ctx;
}
