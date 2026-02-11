import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';
import type { ToastType } from '../contexts/ToastContext';
import { cn } from '../lib/utils';

const TOAST_STYLES: Record<
  ToastType,
  { container: string; icon: string; Icon: typeof CheckCircle2 }
> = {
  success: {
    container: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    icon: 'text-emerald-600',
    Icon: CheckCircle2
  },
  error: {
    container: 'border-rose-200 bg-rose-50 text-rose-800',
    icon: 'text-rose-600',
    Icon: AlertCircle
  },
  warning: {
    container: 'border-amber-200 bg-amber-50 text-amber-800',
    icon: 'text-amber-600',
    Icon: AlertCircle
  },
  info: {
    container: 'border-sky-200 bg-sky-50 text-sky-800',
    icon: 'text-sky-600',
    Icon: Info
  }
};

export interface ToastProps {
  id: string;
  message: string;
  type: ToastType;
  onDismiss: (id: string) => void;
}

export function Toast({ id, message, type, onDismiss }: ToastProps) {
  const { container, icon, Icon } = TOAST_STYLES[type];
  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className={cn(
        'flex items-start gap-3 rounded-2xl border px-4 py-3 text-sm font-medium shadow-lg',
        container
      )}
    >
      <Icon className={cn('h-5 w-5 flex-shrink-0', icon)} aria-hidden />
      <p className="min-w-0 flex-1 leading-snug">{message}</p>
      <button
        type="button"
        onClick={() => onDismiss(id)}
        className="flex-shrink-0 rounded p-1 opacity-70 hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-offset-1"
        aria-label="Dismiss notification"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
