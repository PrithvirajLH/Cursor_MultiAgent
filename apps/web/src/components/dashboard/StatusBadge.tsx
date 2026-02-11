import { cn } from '@/lib/utils';
import { formatStatus } from '@/utils/format';

type StatusTone = 'open' | 'progress' | 'new' | 'resolved' | 'closed';

const toneClasses: Record<StatusTone, string> = {
  open: 'bg-slate-100 text-slate-700 border-slate-200',
  progress: 'bg-amber-100 text-amber-700 border-amber-200',
  new: 'bg-sky-100 text-sky-700 border-sky-200',
  resolved: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  closed: 'bg-zinc-100 text-zinc-700 border-zinc-200',
};

function statusTone(status?: string | null): StatusTone {
  switch (status) {
    case 'NEW':
      return 'new';
    case 'TRIAGED':
    case 'ASSIGNED':
    case 'IN_PROGRESS':
    case 'WAITING_ON_REQUESTER':
    case 'WAITING_ON_VENDOR':
      return 'progress';
    case 'RESOLVED':
      return 'resolved';
    case 'CLOSED':
      return 'closed';
    case 'REOPENED':
    default:
      return 'open';
  }
}

export function StatusBadge({ status }: { status?: string | null }) {
  const tone = statusTone(status);
  const label = status ? formatStatus(status) : 'Unknown';

  return (
    <span
      className={cn(
        'inline-flex min-w-0 max-w-full items-center justify-center overflow-hidden text-ellipsis rounded-md border px-2 py-0.5 text-[11px] font-semibold tracking-[0.1em] whitespace-nowrap',
        toneClasses[tone],
      )}
      title={label}
    >
      {label}
    </span>
  );
}
