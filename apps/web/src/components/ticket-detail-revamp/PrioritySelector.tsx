import { useEffect, useRef, useState } from 'react';
import { Prio, Icn, I } from '../atoms';
import type { TicketPriority } from '../../api/client';

interface PrioritySelectorProps {
  current: TicketPriority;
  onChange: (next: TicketPriority) => void;
  disabled?: boolean;
}

const ALL: TicketPriority[] = ['SEV1', 'SEV2', 'SEV3', 'SEV4'];

const LABEL: Record<TicketPriority, string> = {
  SEV1: 'SEV1 · Critical',
  SEV2: 'SEV2 · High',
  SEV3: 'SEV3 · Normal',
  SEV4: 'SEV4 · Low',
};

export function PrioritySelector({ current, onChange, disabled = false }: PrioritySelectorProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  return (
    <div ref={ref} className="relative inline-block">
      <button
        onClick={() => !disabled && setOpen(o => !o)}
        disabled={disabled}
        className="inline-flex items-center gap-1.5 disabled:cursor-not-allowed"
      >
        <Prio level={current} />
        <span className="text-[12px] font-medium" style={{ color: 'var(--c-fg)' }}>
          {current}
        </span>
        {!disabled && <Icn d={I.chevD} s={10} />}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-1 z-10 rounded shadow-soft border min-w-[160px] py-1"
          style={{ backgroundColor: 'var(--c-surface)', borderColor: 'var(--c-border)' }}
        >
          {ALL.map(p => (
            <button
              key={p}
              role="menuitem"
              onClick={() => {
                onChange(p);
                setOpen(false);
              }}
              className="w-full text-left px-2.5 py-1.5 text-[12px] flex items-center gap-2 hover:bg-[var(--c-surface-2)]"
              style={{
                color: p === current ? 'var(--c-accent)' : 'var(--c-fg-2)',
                fontWeight: p === current ? 600 : 400,
              }}
            >
              <Prio level={p} />
              <span>{LABEL[p]}</span>
              {p === current && <Icn d={I.check} s={11} className="ml-auto" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
