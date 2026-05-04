import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchUsers, type UserRef } from '../../api/client';
import { useAuthSession } from '../../hooks/useAuthSession';
import { Avatar, Icn, I, toneFromName } from '../atoms';

interface AssigneeSelectorProps {
  current: UserRef | null;
  onChange: (next: UserRef | null) => void;
  disabled?: boolean;
}

function initials(name: string | undefined | null): string {
  if (!name) return '—';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '—';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function AssigneeSelector({ current, onChange, disabled = false }: AssigneeSelectorProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { user, loading: authLoading } = useAuthSession();

  const { data, isLoading } = useQuery({
    queryKey: ['assignable-users', search],
    queryFn: ({ signal }) =>
      fetchUsers({ q: search || undefined, pageSize: 20 }, { signal }),
    staleTime: 60_000,
    enabled: open && !!user && !authLoading,
  });

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch('');
      }
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const candidates = data?.data ?? [];

  return (
    <div ref={ref} className="relative inline-block">
      {current ? (
        <button
          onClick={() => !disabled && setOpen(o => !o)}
          disabled={disabled}
          className="inline-flex items-center gap-1.5 disabled:cursor-not-allowed"
        >
          <Avatar name={initials(current.displayName)} size="sm" tone={toneFromName(current.displayName)} />
          <span className="text-[12px]" style={{ color: 'var(--c-fg)' }}>{current.displayName}</span>
          {!disabled && <Icn d={I.chevD} s={10} />}
        </button>
      ) : (
        <button
          onClick={() => !disabled && setOpen(o => !o)}
          disabled={disabled}
          className="inline-flex items-center gap-1 text-[12px] disabled:cursor-not-allowed"
          style={{ color: 'var(--c-fg-4)' }}
        >
          Unassigned
          {!disabled && <Icn d={I.chevD} s={10} />}
        </button>
      )}

      {open && (
        <div
          role="dialog"
          className="absolute right-0 top-full mt-1 z-10 rounded shadow-soft border w-[260px] py-1"
          style={{ backgroundColor: 'var(--c-surface)', borderColor: 'var(--c-border)' }}
        >
          <div className="px-2 pb-1.5 border-b" style={{ borderColor: 'var(--c-divider)' }}>
            <input
              ref={inputRef}
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search people…"
              className="w-full text-[12px] px-2 py-1 rounded border outline-none focus:border-[var(--c-accent)]"
              style={{ backgroundColor: 'var(--c-surface-2)', borderColor: 'var(--c-border)', color: 'var(--c-fg)' }}
            />
          </div>

          <div className="max-h-[260px] overflow-auto">
            {/* Quick "Assign to me" if signed in */}
            {user && (
              <button
                onClick={() => {
                  onChange({ id: user.id, email: user.email, displayName: user.displayName });
                  setOpen(false);
                  setSearch('');
                }}
                className="w-full text-left px-2.5 py-1.5 text-[12px] flex items-center gap-2 hover:bg-[var(--c-surface-2)]"
                style={{ color: 'var(--c-fg-2)' }}
              >
                <Avatar name={initials(user.displayName)} size="sm" tone={toneFromName(user.displayName)} />
                <span className="flex-1 truncate">Assign to me</span>
                <span className="font-mono text-[10px]" style={{ color: 'var(--c-fg-4)' }}>⌘.</span>
              </button>
            )}

            {/* Unassign */}
            {current && (
              <button
                onClick={() => {
                  onChange(null);
                  setOpen(false);
                  setSearch('');
                }}
                className="w-full text-left px-2.5 py-1.5 text-[12px] flex items-center gap-2 hover:bg-[var(--c-surface-2)]"
                style={{ color: 'var(--c-fg-3)' }}
              >
                <span className="w-[18px] h-[18px] rounded-full inline-flex items-center justify-center" style={{ backgroundColor: 'var(--c-surface-3)' }}>
                  <Icn d={I.x} s={10} />
                </span>
                <span className="flex-1">Unassign</span>
              </button>
            )}

            <div className="border-t" style={{ borderColor: 'var(--c-divider)' }} />

            {isLoading ? (
              <div className="px-2.5 py-2 text-[11px]" style={{ color: 'var(--c-fg-4)' }}>
                Loading…
              </div>
            ) : candidates.length === 0 ? (
              <div className="px-2.5 py-2 text-[11px]" style={{ color: 'var(--c-fg-4)' }}>
                No matching users
              </div>
            ) : (
              candidates.map(u => {
                const isCurrent = u.id === current?.id;
                return (
                  <button
                    key={u.id}
                    onClick={() => {
                      onChange(u);
                      setOpen(false);
                      setSearch('');
                    }}
                    className="w-full text-left px-2.5 py-1.5 text-[12px] flex items-center gap-2 hover:bg-[var(--c-surface-2)]"
                    style={{
                      color: isCurrent ? 'var(--c-accent)' : 'var(--c-fg-2)',
                      fontWeight: isCurrent ? 600 : 400,
                    }}
                  >
                    <Avatar name={initials(u.displayName)} size="sm" tone={toneFromName(u.displayName)} />
                    <span className="flex-1 min-w-0 truncate">{u.displayName}</span>
                    {isCurrent && <Icn d={I.check} s={11} />}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
