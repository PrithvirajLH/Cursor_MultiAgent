import type { ReactNode } from 'react';
import { ChevronDown, Search } from 'lucide-react';
import type { NotificationRecord } from '../api/client';
import { initialsFor } from '../utils/format';
import { NotificationCenter } from './NotificationCenter';

type NotificationProps = {
  notifications: NotificationRecord[];
  unreadCount: number;
  loading: boolean;
  hasMore: boolean;
  onLoadMore: () => void;
  onMarkAsRead: (id: string) => void;
  onMarkAllAsRead: () => void;
  onRefresh: () => void;
};

export function TopBar({
  title,
  subtitle,
  currentEmail,
  personas,
  onEmailChange,
  onOpenSearch,
  notificationProps,
  leftAction,
  leftContent
}: {
  title: string;
  subtitle: string;
  currentEmail: string;
  personas: { label: string; email: string }[];
  onEmailChange: (email: string) => void;
  onOpenSearch?: () => void;
  notificationProps?: NotificationProps;
  leftAction?: ReactNode;
  /** When provided, replaces the default title+subtitle block (e.g. ticket overview). */
  leftContent?: ReactNode;
}) {
  const avatarSeed = currentEmail.split('@')[0]?.replace(/[._-]+/g, ' ') || currentEmail;
  const avatarInitials = initialsFor(avatarSeed);

  return (
    <header className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        {leftAction}
        {leftContent != null ? (
          leftContent
        ) : (
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold leading-tight text-slate-900">{title}</h1>
            <p className="mt-0.5 truncate text-sm leading-snug text-slate-500">{subtitle}</p>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {onOpenSearch && (
          <button
            type="button"
            onClick={onOpenSearch}
            className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-600 transition hover:border-slate-400 hover:text-slate-900"
            aria-label="Search"
          >
            <Search className="h-4 w-4" />
          </button>
        )}

        <div className="relative">
          <select
            className="h-10 appearance-none rounded-md border border-slate-300 bg-white px-3 pr-10 text-sm font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
            value={currentEmail}
            onChange={(event) => onEmailChange(event.target.value)}
          >
            {personas.map((persona) => (
              <option key={persona.email} value={persona.email}>
                {persona.label}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
        </div>

        {notificationProps && (
          <NotificationCenter
            notifications={notificationProps.notifications}
            unreadCount={notificationProps.unreadCount}
            loading={notificationProps.loading}
            hasMore={notificationProps.hasMore}
            onLoadMore={notificationProps.onLoadMore}
            onMarkAsRead={notificationProps.onMarkAsRead}
            onMarkAllAsRead={notificationProps.onMarkAllAsRead}
            onRefresh={notificationProps.onRefresh}
            unreadOnly={true}
          />
        )}

        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-600 text-sm font-semibold text-white">
          {avatarInitials}
        </div>
      </div>
    </header>
  );
}
