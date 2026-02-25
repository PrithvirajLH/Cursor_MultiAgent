import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bell,
  Check,
  CheckCheck,
  MessageSquare,
  AlertTriangle,
  Clock,
  UserPlus,
  ArrowRightLeft,
  CheckCircle,
  X
} from 'lucide-react';
import type { NotificationRecord } from '../api/client';
import { formatTicketId } from '../utils/format';
import { AnimatedList } from './ui/animated-list';

type NotificationCenterProps = {
  notifications: NotificationRecord[];
  unreadCount: number;
  loading: boolean;
  hasMore: boolean;
  onLoadMore: () => void;
  onMarkAsRead: (id: string) => void;
  onMarkAllAsRead: () => void;
  onRefresh: () => void;
  /** When true (bell dropdown), show only unread; items disappear when marked read. Default true. */
  unreadOnly?: boolean;
};

const NOTIFICATION_ICON_CONFIG: Record<
  string,
  { icon: ReactNode; bgClass: string }
> = {
  TICKET_ASSIGNED: {
    icon: <UserPlus className="h-4 w-4 text-white" />,
    bgClass: 'bg-blue-500',
  },
  NEW_MESSAGE: {
    icon: <MessageSquare className="h-4 w-4 text-white" />,
    bgClass: 'bg-pink-500',
  },
  SLA_AT_RISK: {
    icon: <Clock className="h-4 w-4 text-white" />,
    bgClass: 'bg-amber-500',
  },
  SLA_BREACHED: {
    icon: <AlertTriangle className="h-4 w-4 text-white" />,
    bgClass: 'bg-red-500',
  },
  TICKET_RESOLVED: {
    icon: <CheckCircle className="h-4 w-4 text-white" />,
    bgClass: 'bg-emerald-500',
  },
  TICKET_TRANSFERRED: {
    icon: <ArrowRightLeft className="h-4 w-4 text-white" />,
    bgClass: 'bg-violet-500',
  },
  TICKET_MENTIONED: {
    icon: <MessageSquare className="h-4 w-4 text-white" />,
    bgClass: 'bg-blue-500',
  },
};

function getNotificationIcon(type: string) {
  const config = NOTIFICATION_ICON_CONFIG[type] ?? {
    icon: <Bell className="h-4 w-4 text-white" />,
    bgClass: 'bg-slate-500',
  };
  return (
    <div className={`h-9 w-9 rounded-full flex items-center justify-center flex-shrink-0 ${config.bgClass}`}>
      {config.icon}
    </div>
  );
}

function formatRelativeTime(dateString: string) {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMinutes = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMinutes < 1) return 'Just now';
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

export type NotificationCardProps = {
  notification: NotificationRecord;
  onMarkAsRead: (id: string) => void;
  onClick: (notification: NotificationRecord) => void;
};

export function NotificationCard({ notification, onMarkAsRead, onClick }: NotificationCardProps) {
  const iconEl = getNotificationIcon(notification.type);
  const source =
    notification.ticket?.displayId ?? notification.ticket?.subject ?? notification.body ?? null;
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onClick(notification)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick(notification);
        }
      }}
      aria-label={`${notification.title}${!notification.isRead ? ', unread' : ''}`}
      className={`group w-full flex items-start gap-4 rounded-[16px] border border-transparent bg-white p-4 text-left shadow-sm transition-all hover:shadow-[0_4px_15px_rgb(0,0,0,0.04)] hover:border-slate-200 cursor-pointer ${!notification.isRead ? 'ring-1 ring-blue-100 bg-blue-50/40 border-blue-100' : ''
        }`}
    >
      {iconEl}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-slate-900 leading-tight">
          {notification.title}
          <span className="font-normal text-slate-400 mx-1">·</span>
          <span className="font-normal text-slate-500 text-sm">
            {formatRelativeTime(notification.createdAt)}
          </span>
        </p>
        {source && (
          <p className="text-xs text-slate-500 mt-1 truncate">
            {notification.ticket?.displayId
              ? formatTicketId(notification.ticket)
              : notification.ticket?.subject ?? notification.body}
          </p>
        )}
      </div>
      {!notification.isRead && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onMarkAsRead(notification.id);
          }}
          className="flex-shrink-0 h-7 w-7 rounded-full hover:bg-slate-200 flex items-center justify-center text-slate-400 hover:text-slate-600 opacity-0 group-hover:opacity-100 focus:opacity-100 transition"
          aria-label="Mark as read"
        >
          <Check className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

export function NotificationCenter({
  notifications,
  unreadCount,
  loading,
  hasMore,
  onLoadMore,
  onMarkAsRead,
  onMarkAllAsRead,
  onRefresh,
  unreadOnly = true
}: NotificationCenterProps) {
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);

  const displayList = unreadOnly
    ? notifications.filter((n) => !n.isRead)
    : notifications;

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  // Close on escape (dropdown or drawer)
  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        if (drawerOpen) setDrawerOpen(false);
        else if (isOpen) setIsOpen(false);
      }
    }

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, drawerOpen]);

  // Refresh when opening
  useEffect(() => {
    if (isOpen) {
      onRefresh();
    }
  }, [isOpen, onRefresh]);

  function handleNotificationClick(notification: NotificationRecord, closeDrawer = false) {
    if (!notification.isRead) {
      onMarkAsRead(notification.id);
    }
    if (notification.ticket) {
      setIsOpen(false);
      if (closeDrawer) setDrawerOpen(false);
      navigate(`/tickets/${notification.ticket.id}`);
    }
  }

  function openDrawer() {
    setIsOpen(false);
    setDrawerOpen(true);
    onRefresh();
  }

  return (
    <div className="relative">
      {/* Bell Button */}
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="relative h-10 w-10 rounded-full border border-slate-300 bg-white flex items-center justify-center text-slate-600 hover:text-slate-900 hover:border-slate-400 transition"
        aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`}
      >
        <Bell className="h-5 w-5" />
        {unreadCount > 0 && (
          <span
            className="absolute -top-1 -right-1 h-5 w-5 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center"
            aria-live="polite"
            aria-atomic="true"
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown */}
      {isOpen && (
        <div
          ref={dropdownRef}
          className="absolute right-0 top-full mt-2 w-[380px] max-w-[calc(100vw-2rem)] rounded-[20px] border border-slate-200 bg-white shadow-[0_8px_30px_rgb(0,0,0,0.08)] z-50 overflow-hidden"
          role="menu"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
            <h3 className="text-sm font-semibold text-slate-900">Notifications</h3>
            <div className="flex items-center gap-2">
              {unreadCount > 0 && (
                <button
                  type="button"
                  onClick={onMarkAllAsRead}
                  className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium text-slate-500 hover:bg-slate-50 hover:text-slate-700 transition"
                >
                  <CheckCheck className="h-3.5 w-3.5" />
                  Mark all read
                </button>
              )}
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="h-6 w-6 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-400 hover:text-slate-600"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Notification List */}
          <div className="max-h-[400px] overflow-y-auto p-3">
            {loading && displayList.length === 0 && (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="animate-pulse rounded-xl bg-white border border-slate-100 shadow-sm p-4 flex gap-3">
                    <div className="h-9 w-9 rounded-full bg-slate-200 flex-shrink-0" />
                    <div className="flex-1 space-y-2 min-w-0">
                      <div className="h-4 w-3/4 rounded bg-slate-200" />
                      <div className="h-3 w-1/2 rounded bg-slate-100" />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {!loading && displayList.length === 0 && (
              <div className="py-12 px-4 text-center">
                <Bell className="h-10 w-10 text-slate-300 mx-auto mb-3" />
                <p className="text-sm text-slate-500">
                  {unreadOnly ? 'No unread notifications' : 'No notifications yet'}
                </p>
                <p className="text-xs text-slate-400 mt-1">
                  {unreadOnly
                    ? 'Marked items disappear from the bell. View all below.'
                    : "You'll be notified about ticket updates here"}
                </p>
                {unreadOnly && (
                  <button
                    type="button"
                    onClick={openDrawer}
                    className="mt-3 text-sm font-medium text-blue-600 hover:text-blue-700"
                  >
                    See all notifications
                  </button>
                )}
              </div>
            )}

            <AnimatedList className="flex flex-col gap-3" staggerDelayMs={80}>
              {displayList.map((notification) => (
                <NotificationCard
                  key={notification.id}
                  notification={notification}
                  onMarkAsRead={onMarkAsRead}
                  onClick={handleNotificationClick}
                />
              ))}
            </AnimatedList>

            {/* See all (bell) or Load more (full page) */}
            {unreadOnly ? (
              displayList.length > 0 && (
                <div className="p-3 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={openDrawer}
                    className="w-full py-2 text-xs font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-50 rounded-lg transition"
                  >
                    See all notifications
                  </button>
                </div>
              )
            ) : (
              hasMore && notifications.length > 0 && (
                <div className="p-3 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={onLoadMore}
                    disabled={loading}
                    className="w-full py-2 text-xs font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-50 rounded-lg transition disabled:opacity-50"
                  >
                    {loading ? 'Loading...' : 'Load more'}
                  </button>
                </div>
              )
            )}
          </div>
        </div>
      )}

      {/* Slide-over drawer: all notifications + Load more (no route) */}
      {drawerOpen && (
        <>
          <div
            role="presentation"
            className="fixed inset-0 bg-black/20 z-[100] transition-opacity"
            onClick={() => setDrawerOpen(false)}
            aria-hidden
          />
          <div
            ref={drawerRef}
            className="fixed right-0 top-0 bottom-0 w-full max-w-md bg-white shadow-[0_0_40px_rgb(0,0,0,0.1)] z-[101] flex flex-col animate-in slide-in-from-right duration-300"
            role="dialog"
            aria-label="All notifications"
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 flex-shrink-0">
              <h3 className="text-base font-semibold text-slate-900">All notifications</h3>
              <div className="flex items-center gap-2">
                {unreadCount > 0 && (
                  <button
                    type="button"
                    onClick={onMarkAllAsRead}
                    className="text-xs text-slate-500 hover:text-slate-700"
                  >
                    Mark all read
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setDrawerOpen(false)}
                  className="h-8 w-8 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-500 hover:text-slate-700"
                  aria-label="Close"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-3">
              {loading && notifications.length === 0 && (
                <div className="space-y-3">
                  {[1, 2, 3].map((i) => (
                    <div
                      key={i}
                      className="animate-pulse rounded-xl bg-white border border-slate-100 shadow-sm p-4 flex gap-3"
                    >
                      <div className="h-9 w-9 rounded-full bg-slate-200 flex-shrink-0" />
                      <div className="flex-1 space-y-2 min-w-0">
                        <div className="h-4 w-3/4 rounded bg-slate-200" />
                        <div className="h-3 w-1/2 rounded bg-slate-100" />
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {!loading && notifications.length === 0 && (
                <div className="py-12 px-4 text-center">
                  <Bell className="h-10 w-10 text-slate-300 mx-auto mb-3" />
                  <p className="text-sm text-slate-500">No notifications yet</p>
                  <p className="text-xs text-slate-400 mt-1">
                    You'll be notified about ticket updates here
                  </p>
                </div>
              )}
              {notifications.length > 0 && (
                <>
                  {notifications.map((notification) => (
                    <NotificationCard
                      key={notification.id}
                      notification={notification}
                      onMarkAsRead={onMarkAsRead}
                      onClick={(n) => handleNotificationClick(n, true)}
                    />
                  ))}
                  {hasMore && (
                    <div className="pt-2">
                      <button
                        type="button"
                        onClick={onLoadMore}
                        disabled={loading}
                        className="w-full py-2 text-xs font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-50 rounded-lg border border-slate-200 transition disabled:opacity-50"
                      >
                        {loading ? 'Loading...' : 'Load more'}
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
