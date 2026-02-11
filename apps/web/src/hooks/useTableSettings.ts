import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const STORAGE_KEY = 'tickets-table-settings';

export type ViewMode = 'grid' | 'table';

export const TABLE_COLUMN_IDS = [
  'checkbox',
  'id',
  'subject',
  'status',
  'priority',
  'team',
  'assignee',
  'requester',
  'createdAt',
  'slaStatus',
] as const;

export type TableColumnId = (typeof TABLE_COLUMN_IDS)[number];

export const DEFAULT_WIDTHS: Record<TableColumnId, number> = {
  checkbox: 44,
  id: 100,
  subject: 240,
  status: 110,
  priority: 80,
  team: 120,
  assignee: 140,
  requester: 140,
  createdAt: 120,
  slaStatus: 100,
};

const MIN_WIDTH = 60;
const MAX_WIDTH = 400;

export type TableSettings = {
  viewMode: ViewMode;
  columnWidths: Record<TableColumnId, number>;
  columnVisibility: Record<TableColumnId, boolean>;
};

function loadStored(): Partial<TableSettings> | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== 'object' || parsed === null) return null;
    return parsed as Partial<TableSettings>;
  } catch {
    return null;
  }
}

function mergeWithDefaults(stored: Partial<TableSettings> | null): TableSettings {
  const viewMode: ViewMode =
    stored?.viewMode === 'table' || stored?.viewMode === 'grid' ? stored.viewMode : 'grid';

  const columnWidths = { ...DEFAULT_WIDTHS };
  if (stored?.columnWidths && typeof stored.columnWidths === 'object') {
    for (const id of TABLE_COLUMN_IDS) {
      const w = stored.columnWidths[id];
      if (typeof w === 'number' && w >= MIN_WIDTH && w <= MAX_WIDTH) {
        columnWidths[id] = w;
      }
    }
  }

  const columnVisibility: Record<TableColumnId, boolean> = {} as Record<TableColumnId, boolean>;
  for (const id of TABLE_COLUMN_IDS) {
    if (stored?.columnVisibility && typeof stored.columnVisibility[id] === 'boolean') {
      columnVisibility[id] = stored.columnVisibility[id];
    } else {
      columnVisibility[id] = true;
    }
  }

  return { viewMode, columnWidths, columnVisibility };
}

function persist(settings: TableSettings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // ignore
  }
}

export function useTableSettings() {
  const [settings, setSettings] = useState<TableSettings>(() => {
    const stored = loadStored();
    return mergeWithDefaults(stored);
  });

  const persistTimerRef = useRef<number | null>(null);
  const lastScheduledSettingsRef = useRef<TableSettings | null>(null);

  const schedulePersist = useCallback((next: TableSettings) => {
    // localStorage writes are synchronous; debounce to avoid jank during drag resizing.
    lastScheduledSettingsRef.current = next;
    if (persistTimerRef.current != null) {
      window.clearTimeout(persistTimerRef.current);
    }
    persistTimerRef.current = window.setTimeout(() => {
      persist(next);
      persistTimerRef.current = null;
      lastScheduledSettingsRef.current = null;
    }, 250);
  }, []);

  useEffect(() => {
    return () => {
      if (persistTimerRef.current != null) {
        // Ensure last settings aren't dropped if the component unmounts before debounce fires.
        if (lastScheduledSettingsRef.current) {
          persist(lastScheduledSettingsRef.current);
          lastScheduledSettingsRef.current = null;
        }
        window.clearTimeout(persistTimerRef.current);
        persistTimerRef.current = null;
      }
    };
  }, []);

  const setViewMode = useCallback((viewMode: ViewMode) => {
    setSettings((prev) => {
      const next = { ...prev, viewMode };
      schedulePersist(next);
      return next;
    });
  }, [schedulePersist]);

  const setColumnWidth = useCallback((columnId: TableColumnId, width: number) => {
    const clamped = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, width));
    setSettings((prev) => {
      const next = {
        ...prev,
        columnWidths: { ...prev.columnWidths, [columnId]: clamped },
      };
      schedulePersist(next);
      return next;
    });
  }, [schedulePersist]);

  const setColumnVisible = useCallback((columnId: TableColumnId, visible: boolean) => {
    setSettings((prev) => {
      const next = {
        ...prev,
        columnVisibility: { ...prev.columnVisibility, [columnId]: visible },
      };
      schedulePersist(next);
      return next;
    });
  }, [schedulePersist]);

  const visibleColumns = useMemo(
    () => TABLE_COLUMN_IDS.filter((id) => settings.columnVisibility[id]),
    [settings.columnVisibility]
  );

  return {
    viewMode: settings.viewMode,
    columnWidths: settings.columnWidths,
    columnVisibility: settings.columnVisibility,
    setViewMode,
    setColumnWidth,
    setColumnVisible,
    visibleColumns,
  };
}
