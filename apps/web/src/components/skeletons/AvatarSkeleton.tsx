import { cn } from '@/lib/utils';

/** Skeleton for avatar (e.g. assignee, requester, message author). Matches h-9 w-9 rounded-full. */
export function AvatarSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn('h-9 w-9 flex-shrink-0 rounded-full skeleton-shimmer', className)}
      aria-hidden
    />
  );
}
