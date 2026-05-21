export type PrioLevel = 'SEV1' | 'SEV2' | 'SEV3' | 'SEV4';

interface PrioProps {
  level: PrioLevel;
  className?: string;
}

const COLOR_MAP: Record<PrioLevel, [string, string, string]> = {
  SEV1: ['var(--c-red)',   'var(--c-red)',   'var(--c-red)'],
  SEV2: ['var(--c-amber)', 'var(--c-amber)', 'var(--c-fg-5)'],
  SEV3: ['var(--c-fg-3)',  'var(--c-fg-5)',  'var(--c-fg-5)'],
  SEV4: ['var(--c-fg-5)',  'var(--c-fg-5)',  'var(--c-fg-5)'],
};

export function Prio({ level, className = '' }: PrioProps) {
  const [c1, c2, c3] = COLOR_MAP[level];
  return (
    <span className={`inline-flex gap-px items-end h-3 ${className}`} title={level}>
      <i className="block w-[3px] h-1"   style={{ backgroundColor: c1 }} />
      <i className="block w-[3px] h-2"   style={{ backgroundColor: c2 }} />
      <i className="block w-[3px] h-3"   style={{ backgroundColor: c3 }} />
    </span>
  );
}
