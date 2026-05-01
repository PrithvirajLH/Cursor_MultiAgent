export type AvatarTone = 'a' | 'b' | 'c' | 'd' | 'e' | 'f' | 'g';
export type AvatarSize = 'sm' | 'md' | 'lg' | 'xl';

interface AvatarProps {
  name: string;
  size?: AvatarSize;
  tone?: AvatarTone;
  className?: string;
}

const TONE: Record<AvatarTone, { bg: string; fg: string }> = {
  a: { bg: '#e6eef9', fg: '#1454a8' },
  b: { bg: '#fdf3e7', fg: '#b54708' },
  c: { bg: '#e7f5ee', fg: '#1d7a4d' },
  d: { bg: '#f1ebf9', fg: '#6b3aa3' },
  e: { bg: '#fdecec', fg: '#b42318' },
  f: { bg: '#eef0fb', fg: '#2d3da3' },
  g: { bg: '#f1f3f5', fg: '#5c6573' },
};

const SIZE: Record<AvatarSize, { box: string; font: string }> = {
  sm: { box: 'w-[18px] h-[18px]', font: 'text-[9px]'  },
  md: { box: 'w-[22px] h-[22px]', font: 'text-[10px]' },
  lg: { box: 'w-[32px] h-[32px]', font: 'text-[12px]' },
  xl: { box: 'w-[40px] h-[40px]', font: 'text-[14px]' },
};

export function toneFromName(name: string): AvatarTone {
  const tones: AvatarTone[] = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
  const sum = name.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  return tones[sum % tones.length];
}

export function Avatar({ name, size = 'md', tone, className = '' }: AvatarProps) {
  const t = TONE[tone ?? toneFromName(name)];
  const s = SIZE[size];
  return (
    <span
      className={`${s.box} ${s.font} rounded-full inline-flex items-center justify-center font-semibold flex-none ${className}`}
      style={{ backgroundColor: t.bg, color: t.fg }}
    >
      {name}
    </span>
  );
}
