import { useEffect, useState } from 'react';
import type { TicketRow } from './mappers';

interface UseTicketListKeyboardOptions {
  tickets: TicketRow[];
  selected: Set<string>;
  onSelectionChange: (next: Set<string>) => void;
  onOpenTicket: (id: string) => void;
  /** Set false when listening should be disabled (e.g. modal open, page hidden) */
  enabled?: boolean;
  /** Set false to disable the X selection shortcut (e.g. EMPLOYEE role) */
  canSelect?: boolean;
}

interface UseTicketListKeyboardResult {
  focusedRowId: string | null;
  focusedRowIndex: number;
  setFocusedRowIndex: (i: number) => void;
}

/**
 * Wires Linear-style keyboard navigation for the ticket list.
 *   J / K       — move focus down / up
 *   X           — toggle selection on focused row
 *   Shift+X     — range-select from anchor to focused row
 *   Enter       — open focused ticket
 *
 * Skips when the user is typing in an input/textarea/contenteditable.
 * Skips when an open dialog is detected (`[role="dialog"][aria-modal="true"]`).
 */
export function useTicketListKeyboard({
  tickets,
  selected,
  onSelectionChange,
  onOpenTicket,
  enabled = true,
  canSelect = true,
}: UseTicketListKeyboardOptions): UseTicketListKeyboardResult {
  const [focusedRowIndex, setFocusedRowIndex] = useState(0);
  const [rangeAnchor, setRangeAnchor] = useState<number | null>(null);

  // Clamp focused index when ticket list shrinks (e.g. filter narrows results).
  useEffect(() => {
    if (focusedRowIndex >= tickets.length) {
      setFocusedRowIndex(Math.max(0, tickets.length - 1));
    }
  }, [tickets.length, focusedRowIndex]);

  useEffect(() => {
    if (!enabled) return;

    function shouldIgnore(event: KeyboardEvent): boolean {
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return true;
      const target = event.target as HTMLElement | null;
      if (!target) return false;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable
      ) {
        return true;
      }
      return false;
    }

    function onKeyDown(event: KeyboardEvent) {
      if (shouldIgnore(event)) return;

      const key = event.key.toLowerCase();

      if (key === 'j') {
        event.preventDefault();
        setFocusedRowIndex(prev => Math.min(prev + 1, Math.max(tickets.length - 1, 0)));
        return;
      }

      if (key === 'k') {
        event.preventDefault();
        setFocusedRowIndex(prev => Math.max(prev - 1, 0));
        return;
      }

      if (key === 'x' && canSelect) {
        const current = tickets[focusedRowIndex];
        if (!current) return;
        event.preventDefault();

        // Shift+X = range-select from anchor to focused row
        if (event.shiftKey && rangeAnchor !== null && rangeAnchor !== focusedRowIndex) {
          const start = Math.min(rangeAnchor, focusedRowIndex);
          const end = Math.max(rangeAnchor, focusedRowIndex);
          const next = new Set(selected);
          for (let i = start; i <= end; i++) {
            const id = tickets[i]?.id;
            if (id) next.add(id);
          }
          onSelectionChange(next);
          return;
        }

        // Plain X = toggle one row, set as new range anchor
        const next = new Set(selected);
        if (next.has(current.id)) next.delete(current.id);
        else next.add(current.id);
        onSelectionChange(next);
        setRangeAnchor(focusedRowIndex);
        return;
      }

      if (event.key === 'Enter') {
        const current = tickets[focusedRowIndex];
        if (!current) return;
        event.preventDefault();
        onOpenTicket(current.id);
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    tickets,
    selected,
    onSelectionChange,
    onOpenTicket,
    enabled,
    canSelect,
    focusedRowIndex,
    rangeAnchor,
  ]);

  const focusedRowId = tickets[focusedRowIndex]?.id ?? null;
  return { focusedRowId, focusedRowIndex, setFocusedRowIndex };
}
