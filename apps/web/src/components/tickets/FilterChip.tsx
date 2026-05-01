import { Icn, I } from '../atoms';

interface FilterChipProps {
  label: string;
  value: string;
  active?: boolean;
  removable?: boolean;
  onRemove?: () => void;
}

export function FilterChip({ label, value, active = false, removable = true, onRemove }: FilterChipProps) {
  return (
    <span
      className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded-[3px] border"
      style={{
        backgroundColor: active ? 'var(--c-accent-tint)' : 'var(--c-surface)',
        borderColor:     active ? 'var(--c-accent-tint-2)' : 'var(--c-border)',
        color:           active ? 'var(--c-accent)' : 'var(--c-fg-2)',
      }}
    >
      <span style={{ color: active ? 'var(--c-accent)' : 'var(--c-fg-4)' }}>{label}:</span>
      <span className="font-medium">{value}</span>
      {removable && (
        <button onClick={onRemove} className="hover:opacity-70" aria-label={`Remove ${label} filter`}>
          <Icn d={I.x} s={10} />
        </button>
      )}
    </span>
  );
}
