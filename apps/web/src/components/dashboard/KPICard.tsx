import { type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

interface KPICardProps {
  icon: LucideIcon;
  value: number;
  label: string;
  variant?: 'blue' | 'green' | 'default';
  dropdown?: string;
  helper?: string;
}

const bgGradients: Record<NonNullable<KPICardProps['variant']>, string> = {
  blue: 'bg-card',
  green: 'bg-card',
  default: 'bg-card',
};

const iconBgs: Record<NonNullable<KPICardProps['variant']>, string> = {
  blue: 'bg-[hsl(var(--status-progress-bg))] text-[hsl(var(--status-progress))]',
  green: 'bg-[hsl(var(--status-resolved-bg))] text-[hsl(var(--status-resolved))]',
  default: 'bg-[hsl(var(--kpi-yellow))] text-amber-600',
};

export function KPICard({
  icon: Icon,
  value,
  label,
  variant = 'default',
  dropdown,
  helper,
}: KPICardProps) {
  return (
    <div
      className={cn(
        'relative flex items-center gap-2 rounded-lg border border-border/80 p-3 shadow-card transition-all duration-200 hover:shadow-elevated',
        bgGradients[variant],
      )}
    >
      <div className={cn('flex h-9 w-9 items-center justify-center rounded-lg', iconBgs[variant])}>
        <Icon className="h-5 w-5" />
      </div>

      <div className="flex-1">
        <div className="text-xl font-bold leading-tight text-foreground tracking-tight">
          {value.toLocaleString()}
        </div>
        <div className="mt-0 text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">
          {label}
        </div>
        {helper && (
          <div className="mt-0 text-xs leading-tight text-muted-foreground">
            {helper}
          </div>
        )}
      </div>

      {dropdown && (
        <span
          className="absolute right-4 top-4 flex items-center gap-1 text-xs text-muted-foreground"
          aria-hidden
        >
          {dropdown}
        </span>
      )}
    </div>
  );
}
