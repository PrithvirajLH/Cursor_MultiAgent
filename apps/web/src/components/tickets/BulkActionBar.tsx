interface BulkActionBarProps {
  count: number;
  onClear?: () => void;
}

export function BulkActionBar({ count, onClear }: BulkActionBarProps) {
  if (count === 0) return null;
  return (
    <div
      className="flex items-center gap-2.5 text-[12px] border-b"
      style={{ backgroundColor: 'var(--c-accent-tint)', borderColor: 'var(--c-accent-tint-2)', padding: '6px 18px' }}
    >
      <span className="font-semibold" style={{ color: 'var(--c-accent)' }}>
        {count} ticket{count === 1 ? '' : 's'} selected
      </span>
      <span className="w-px h-3.5" style={{ backgroundColor: 'var(--c-accent-tint-2)' }} />
      <button className="text-[12px] px-2 py-0.5 rounded border bg-white" style={{ borderColor: 'var(--c-border-strong)', color: 'var(--c-fg-2)' }}>Assign</button>
      <button className="text-[12px] px-2 py-0.5 rounded border bg-white" style={{ borderColor: 'var(--c-border-strong)', color: 'var(--c-fg-2)' }}>Set status</button>
      <button className="text-[12px] px-2 py-0.5 rounded border bg-white" style={{ borderColor: 'var(--c-border-strong)', color: 'var(--c-fg-2)' }}>Set priority</button>
      <button className="text-[12px] px-2 py-0.5 rounded border bg-white" style={{ borderColor: 'var(--c-border-strong)', color: 'var(--c-fg-2)' }}>Add tag</button>
      <button className="text-[12px] px-2 py-0.5 rounded border bg-white" style={{ borderColor: 'var(--c-border-strong)', color: 'var(--c-fg-2)' }}>Merge</button>
      <button className="text-[12px] px-2 py-0.5 rounded border bg-white" style={{ borderColor: 'var(--c-border-strong)', color: 'var(--c-fg-2)' }}>Apply macro…</button>
      <span className="flex-1" />
      <button onClick={onClear} className="text-[12px]" style={{ color: 'var(--c-fg-4)' }}>
        <span className="font-mono text-[10px] px-1 rounded-sm border" style={{ backgroundColor: 'var(--c-surface-3)', borderColor: 'var(--c-border)' }}>Esc</span>
        {' '}to clear
      </button>
    </div>
  );
}
