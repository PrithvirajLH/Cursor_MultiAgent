import { useMinuteTick } from '../hooks/useMinuteTick';
import { formatDateLong, formatRelative } from '../utils/format';

type RelativeTimeProps = {
  value: string | Date | null | undefined;
  className?: string;
  variant?: 'default' | 'compact';
};

/**
 * Displays a timestamp as relative time ("2 hours ago") with absolute date/time on hover.
 * Updates every minute while mounted.
 */
function formatRelativeCompact(value: string | Date): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) {
    return '—';
  }
  const now = Date.now();
  const ms = now - date.getTime();
  const absMs = Math.abs(ms);
  const seconds = Math.floor(absMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (ms < 0) {
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
  if (seconds < 60) {
    return 'now';
  }
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  if (hours < 24) {
    return `${hours}h ago`;
  }
  if (days < 7) {
    return `${days}d ago`;
  }
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function RelativeTime({ value, className, variant = 'default' }: RelativeTimeProps) {
  useMinuteTick(value != null);

  if (value == null) {
    return <span className={className}>—</span>;
  }

  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) {
    return <span className={className}>—</span>;
  }

  const title = formatDateLong(date);
  const text = variant === 'compact' ? formatRelativeCompact(value) : formatRelative(value);

  return (
    <time dateTime={date.toISOString()} title={title} className={className}>
      {text}
    </time>
  );
}
