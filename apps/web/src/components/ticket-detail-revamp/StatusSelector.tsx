import { useEffect, useRef, useState } from 'react';
import { Pill, Icn, I } from '../atoms';
import type { PillTone } from '../atoms';
import type { TicketStatus } from '../../api/client';

interface StatusSelectorProps {
  current: TicketStatus;
  currentLabel: string;
  currentTone: PillTone;
  /** From `TicketDetail.allowedTransitions` — only these are clickable. */
  allowed: TicketStatus[];
  onChange: (next: TicketStatus) => void;
  disabled?: boolean;
}

const STATUS_LABEL: Record<TicketStatus, string> = {
  NEW:                  'new',
  TRIAGED:              'triaged',
  ASSIGNED:             'assigned',
  IN_PROGRESS:          'in progress',
  WAITING_ON_REQUESTER: 'pending',
  WAITING_ON_VENDOR:    'pending (vendor)',
  RESOLVED:             'resolved',
  CLOSED:               'closed',
  REOPENED:             'reopened',
};

const STATUS_TONE: Record<TicketStatus, PillTone> = {
  NEW:                  'gray',
  TRIAGED:              'gray',
  ASSIGNED:             'amber',
  IN_PROGRESS:          'amber',
  WAITING_ON_REQUESTER: 'blue',
  WAITING_ON_VENDOR:    'blue',
  RESOLVED:             'green',
  CLOSED:               'gray',
  REOPENED:             'red',
};

export function StatusSelector({
  current,
  currentLabel,
  currentTone,
  allowed,
  onChange,
  disabled = false,
}: StatusSelectorProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  return (
    <div ref={ref} className="relative inline-block">
      <button
        onClick={() => !disabled && setOpen(o => !o)}
        disabled={disabled || allowed.length === 0}
        className="inline-flex items-center gap-1 disabled:cursor-not-allowed"
        title={allowed.length === 0 ? 'No transitions available' : 'Change status'}
      >
        <Pill tone={currentTone} dot>
          {currentLabel}
        </Pill>
        {!disabled && allowed.length > 0 && <Icn d={I.chevD} s={10} />}
      </button>

      {open && allowed.length > 0 && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-1 z-10 rounded shadow-soft border min-w-[180px] py-1"
          style={{ backgroundColor: 'var(--c-surface)', borderColor: 'var(--c-border)' }}
        >
          {allowed.map(s => (
            <button
              key={s}
              role="menuitem"
              onClick={() => {
                onChange(s);
                setOpen(false);
              }}
              className="w-full text-left px-2.5 py-1.5 text-[12px] flex items-center gap-2 hover:bg-[var(--c-surface-2)]"
              style={{
                color: s === current ? 'var(--c-accent)' : 'var(--c-fg-2)',
                fontWeight: s === current ? 600 : 400,
              }}
            >
              <Pill tone={STATUS_TONE[s]} dot>
                {STATUS_LABEL[s]}
              </Pill>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
