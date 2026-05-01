import { Icn, I } from './Icn';

interface AiChipProps {
  conf: number;
  className?: string;
}

export function AiChip({ conf, className = '' }: AiChipProps) {
  const low = conf < 70;
  const color = low ? 'var(--c-amber)' : 'var(--c-accent)';
  const bg    = low ? 'var(--c-amber-tint)' : 'var(--c-accent-tint)';
  const border= low ? '#f4d8b6' : 'var(--c-accent-tint-2)';
  return (
    <span
      className={`inline-flex items-center gap-1 px-1.5 py-px rounded-sm text-[11px] font-semibold border ${className}`}
      style={{ backgroundColor: bg, color, borderColor: border }}
    >
      <Icn d={I.sparkle} s={11} />
      <span className="tabular-nums">{conf}%</span>
    </span>
  );
}
