import { useRef } from 'react';
import { X } from 'lucide-react';
import { useModalFocusTrap } from '../hooks/useModalFocusTrap';

export type ShortcutContext = 'global' | 'tickets-list' | 'ticket-detail';

type ShortcutItem = {
  keys: string[];
  description: string;
};

const GLOBAL_SHORTCUTS: ShortcutItem[] = [
  { keys: ['⌘', 'K'], description: 'Open command palette' },
  { keys: ['Alt', 'N'], description: 'Create new ticket' },
  { keys: ['⌘', '/'], description: 'Focus search' },
  { keys: ['?'], description: 'Show keyboard shortcuts' }
];

const TICKETS_LIST_SHORTCUTS: ShortcutItem[] = [
  { keys: ['J'], description: 'Next ticket' },
  { keys: ['K'], description: 'Previous ticket' },
  { keys: ['Enter'], description: 'Open selected ticket' },
  { keys: ['X'], description: 'Toggle selection' },
  { keys: ['Shift', 'X'], description: 'Select range' }
];

const TICKET_DETAIL_SHORTCUTS: ShortcutItem[] = [
  { keys: ['R'], description: 'Focus reply' },
  { keys: ['A'], description: 'Assign to me' },
  { keys: ['S'], description: 'Open status dropdown' },
  { keys: ['Esc'], description: 'Go back' }
];

function ShortcutRow({ keys, description }: ShortcutItem) {
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <span className="text-sm text-slate-600">{description}</span>
      <div className="flex items-center gap-1">
        {keys.map((key) => (
          <kbd
            key={key}
            className="px-2 py-1 rounded border border-slate-200 bg-slate-50 text-xs font-medium text-slate-700"
          >
            {key}
          </kbd>
        ))}
      </div>
    </div>
  );
}

export function KeyboardShortcutsHelp({
  open,
  onClose,
  context
}: {
  open: boolean;
  onClose: () => void;
  context: ShortcutContext;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useModalFocusTrap({ open, containerRef: dialogRef, onClose });

  if (!open) return null;

  const showTicketsList = context === 'tickets-list' || context === 'global';
  const showTicketDetail = context === 'ticket-detail' || context === 'global';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm">
      <div
        ref={dialogRef}
        className="glass-card-strong w-full max-w-md overflow-hidden shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        tabIndex={-1}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <h2 className="text-lg font-semibold text-slate-900">Keyboard shortcuts</h2>
          <button
            type="button"
            onClick={onClose}
            className="h-8 w-8 rounded-lg border border-slate-200 flex items-center justify-center text-slate-500 hover:text-slate-700 hover:bg-slate-50"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-4 space-y-4 max-h-[70vh] overflow-y-auto">
          <div>
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">
              Global
            </h3>
            <div className="divide-y divide-slate-100">
              {GLOBAL_SHORTCUTS.map((item) => (
                <ShortcutRow key={item.description} keys={item.keys} description={item.description} />
              ))}
            </div>
          </div>

          {showTicketsList && (
            <div>
              <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">
                Ticket list
              </h3>
              <div className="divide-y divide-slate-100">
                {TICKETS_LIST_SHORTCUTS.map((item) => (
                  <ShortcutRow key={item.description} keys={item.keys} description={item.description} />
                ))}
              </div>
            </div>
          )}

          {showTicketDetail && (
            <div>
              <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">
                Ticket detail
              </h3>
              <div className="divide-y divide-slate-100">
                {TICKET_DETAIL_SHORTCUTS.map((item) => (
                  <ShortcutRow key={item.description} keys={item.keys} description={item.description} />
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="border-t border-slate-200 px-4 py-2 text-xs text-slate-500">
          Press <kbd className="px-1 py-0.5 rounded border border-slate-200 bg-slate-50">?</kbd> anytime to show this help
        </div>
      </div>
    </div>
  );
}
