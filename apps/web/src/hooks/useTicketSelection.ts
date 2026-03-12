import { useCallback, useEffect, useState } from "react";

export function useTicketSelection(ticketIds: string[]) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Prune selection when visible ticket list changes (filters/search/persona)
  useEffect(() => {
    setSelectedIds((prev) => {
      const allowed = new Set(ticketIds);
      const next = new Set([...prev].filter((id) => allowed.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [ticketIds]);

  const isSelected = useCallback(
    (id: string) => selectedIds.has(id),
    [selectedIds],
  );

  const toggle = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    const allSelected =
      ticketIds.length > 0 && ticketIds.every((id) => selectedIds.has(id));
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(ticketIds));
    }
  }, [ticketIds, selectedIds]);

  const selectAll = useCallback(() => {
    setSelectedIds(new Set(ticketIds));
  }, [ticketIds]);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const isAllSelected =
    ticketIds.length > 0 && ticketIds.every((id) => selectedIds.has(id));
  const isSomeSelected = selectedIds.size > 0;
  const selectedCount = selectedIds.size;
  const selectedIdsArray = Array.from(selectedIds);

  return {
    selectedIds: selectedIdsArray,
    selectedCount,
    isSelected,
    isAllSelected,
    isSomeSelected,
    toggle,
    toggleAll,
    selectAll,
    clearSelection,
  };
}
