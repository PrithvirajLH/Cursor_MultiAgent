import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Icn, I } from '../atoms';

/**
 * Topbar search input.
 *
 *  - On `/tickets-revamp(/:id)?` routes, typing live-updates `?q=` (debounced 250ms).
 *  - On any other route, pressing Enter navigates to `/tickets-revamp?q=<value>`.
 *  - ⌘K / Ctrl+K focuses the input from anywhere.
 */
export function TopbarSearch() {
  const location = useLocation();
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const onTicketsRevamp = location.pathname.startsWith('/tickets-revamp');

  // Read current q from URL (source of truth)
  const params = new URLSearchParams(location.search);
  const urlQ = params.get('q') ?? '';

  // Local input state — synced from URL on path/url changes
  const [draft, setDraft] = useState(urlQ);

  useEffect(() => {
    setDraft(urlQ);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlQ]);

  // Debounced URL writeback (only on tickets-revamp routes — else Enter to navigate)
  useEffect(() => {
    if (!onTicketsRevamp) return;
    if (draft === urlQ) return;
    const handle = window.setTimeout(() => {
      const next = new URLSearchParams(location.search);
      if (draft.trim()) next.set('q', draft.trim());
      else next.delete('q');
      next.delete('page'); // reset pagination on new search
      navigate(
        { pathname: location.pathname, search: next.toString() ? `?${next}` : '' },
        { replace: true },
      );
    }, 250);
    return () => window.clearTimeout(handle);
  }, [draft, urlQ, onTicketsRevamp, location.pathname, location.search, navigate]);

  // ⌘K / Ctrl+K focus
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (onTicketsRevamp) return; // already live-updating
    const q = draft.trim();
    navigate(`/tickets-revamp${q ? `?q=${encodeURIComponent(q)}` : ''}`);
  }

  return (
    <form
      onSubmit={onSubmit}
      className="flex items-center rounded gap-1.5 text-[12px] w-80 px-2 py-[3px] border focus-within:border-[var(--c-accent)]"
      style={{ backgroundColor: 'var(--c-surface-2)', borderColor: 'var(--c-border)', color: 'var(--c-fg-4)' }}
    >
      <Icn d={I.search} s={13} />
      <input
        ref={inputRef}
        type="search"
        value={draft}
        onChange={e => setDraft(e.target.value)}
        placeholder="Search tickets, customers, KB…"
        className="flex-1 bg-transparent outline-none text-[12px]"
        style={{ color: 'var(--c-fg)' }}
        aria-label="Search tickets"
      />
      <span
        className="font-mono text-[10px] px-1 py-px rounded-sm border"
        style={{
          backgroundColor: 'var(--c-surface-3)',
          borderColor: 'var(--c-border)',
          borderBottomWidth: 2,
          color: 'var(--c-fg-3)',
        }}
      >⌘K</span>
    </form>
  );
}
