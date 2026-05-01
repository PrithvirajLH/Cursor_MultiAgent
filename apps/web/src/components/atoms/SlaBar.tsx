export type SlaState = 'ok' | 'warn' | 'breach';

interface SlaBarProps {
  pct: number;
  state?: SlaState;
  className?: string;
}

const COLOR: Record<SlaState, string> = {
  ok:     'var(--c-green)',
  warn:   'var(--c-amber)',
  breach: 'var(--c-red)',
};

export function SlaBar({ pct, state = 'ok', className = '' }: SlaBarProps) {
  const clamped = Math.min(100, Math.max(0, pct));
  return (
    <div
      className={`h-1 rounded-sm overflow-hidden relative ${className}`}
      style={{ backgroundColor: 'var(--c-surface-3)' }}
      role="progressbar"
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <span className="block h-full" style={{ width: `${clamped}%`, backgroundColor: COLOR[state] }} />
    </div>
  );
}
