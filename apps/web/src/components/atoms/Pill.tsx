import type { ReactNode } from 'react';

export type PillTone = 'gray' | 'red' | 'amber' | 'green' | 'blue' | 'purple' | 'accent';

interface PillProps {
  tone?: PillTone;
  dot?: boolean;
  children: ReactNode;
  className?: string;
}

const TONE_STYLES: Record<PillTone, { bg: string; fg: string; border: string }> = {
  gray:   { bg: 'var(--c-surface-3)',     fg: 'var(--c-fg-3)',  border: 'var(--c-border)' },
  red:    { bg: 'var(--c-red-tint)',      fg: 'var(--c-red)',   border: '#f3c7c2' },
  amber:  { bg: 'var(--c-amber-tint)',    fg: 'var(--c-amber)', border: '#f4d8b6' },
  green:  { bg: 'var(--c-green-tint)',    fg: 'var(--c-green)', border: '#bfe2ce' },
  blue:   { bg: 'var(--c-blue-tint)',     fg: 'var(--c-blue)',  border: '#c0d4ee' },
  purple: { bg: 'var(--c-purple-tint)',   fg: 'var(--c-purple)',border: '#d8c5ec' },
  accent: { bg: 'var(--c-accent-tint)',   fg: 'var(--c-accent)',border: 'var(--c-accent-tint-2)' },
};

export function Pill({ tone = 'gray', dot = false, children, className = '' }: PillProps) {
  const t = TONE_STYLES[tone];
  return (
    <span
      className={`inline-flex items-center gap-1 px-1.5 py-px rounded-sm text-[11px] font-semibold uppercase tracking-[0.03em] leading-[1.5] border whitespace-nowrap ${className}`}
      style={{ backgroundColor: t.bg, color: t.fg, borderColor: t.border }}
    >
      {dot && <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: 'currentColor' }} />}
      {children}
    </span>
  );
}
