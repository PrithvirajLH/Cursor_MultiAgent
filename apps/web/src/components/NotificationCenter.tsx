import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
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
  X,
} from "lucide-react";
import type { NotificationRecord } from "../api/client";
import { useModalFocusTrap } from "../hooks/useModalFocusTrap";
import { formatTicketId } from "../utils/format";
import { AnimatedList } from "./ui/animated-list";

type NotificationCenterProps = {
  notifications: NotificationRecord[];
  unreadCount: number;
  loading: boolean;
  actionError: string | null;
  hasMore: boolean;
  onLoadMore: () => void;
  onMarkAsRead: (id: string) => void;
  onMarkAllAsRead: () => void;
  onRefresh: () => void;
  /** When true (bell dropdown), show only unread; items disappear when marked read. Default true. */
  unreadOnly?: boolean;
};

export const NOTIFICATION_DROPDOWN_TITLE = "Notifications";
export const NOTIFICATION_DRAWER_TITLE = "All notifications";
const UNREAD_NOTIFICATIONS_LABEL = "Unread notifications";
const ALL_NOTIFICATIONS_LIST_LABEL = "All notifications";

const NOTIFICATION_ICON_CONFIG: Record<
  string,
  { icon: ReactNode; bgClass: string }
> = {
  TICKET_ASSIGNED: {
    icon: <UserPlus className="h-4 w-4 text-white" />,
    bgClass: "bg-blue-500",
  },
  NEW_MESSAGE: {
    icon: <MessageSquare className="h-4 w-4 text-white" />,
    bgClass: "bg-pink-500",
  },
  SLA_AT_RISK: {
    icon: <Clock className="h-4 w-4 text-white" />,
    bgClass: "bg-amber-500",
  },
  SLA_BREACHED: {
    icon: <AlertTriangle className="h-4 w-4 text-white" />,
    bgClass: "bg-red-500",
  },
  TICKET_RESOLVED: {
    icon: <CheckCircle className="h-4 w-4 text-white" />,
    bgClass: "bg-emerald-500",
  },
  TICKET_TRANSFERRED: {
    icon: <ArrowRightLeft className="h-4 w-4 text-white" />,
    bgClass: "bg-violet-500",
  },
  TICKET_MENTIONED: {
    icon: <MessageSquare className="h-4 w-4 text-white" />,
    bgClass: "bg-blue-500",
  },
};

function getNotificationIcon(type: string) {
  const config = NOTIFICATION_ICON_CONFIG[type] ?? {
    icon: <Bell className="h-4 w-4 text-white" />,
    bgClass: "bg-slate-500",
  };
  return (
    <div
      className={`h-9 w-9 rounded-full flex items-center justify-center flex-shrink-0 ${config.bgClass}`}
    >
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

  if (diffMinutes < 1) return "Just now";
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

export function NotificationCard({
  notification,
  onMarkAsRead,
  onClick,
}: NotificationCardProps) {
  const iconEl = getNotificationIcon(notification.type);
  const source =
    notification.ticket?.displayId ??
    notification.ticket?.subject ??
    notification.body ??
    null;
  const cardClasses = `group w-full flex items-start gap-4 rounded-[16px] border p-4 text-left transition-all ${
    !notification.isRead
      ? "border-primary/20 bg-primary/5 ring-1 ring-primary/20"
      : "border-border bg-muted/50 hover:bg-muted"
  }`;

  return (
    <div className={cardClasses}>
      <button
        type="button"
        onClick={() => onClick(notification)}
        aria-label={`${notification.title}${!notification.isRead ? ", unread" : ""}`}
        className="flex min-w-0 flex-1 items-start gap-4 text-left"
      >
        {iconEl}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground leading-tight">
            {notification.title}
            <span className="font-normal text-slate-400 mx-1">·</span>
            <span className="font-normal text-muted-foreground text-sm">
              {formatRelativeTime(notification.createdAt)}
            </span>
          </p>
          {source && (
            <p className="text-xs text-muted-foreground mt-1 truncate">
              {notification.ticket?.displayId
                ? formatTicketId(notification.ticket)
                : (notification.ticket?.subject ?? notification.body)}
            </p>
          )}
        </div>
      </button>
      {!notification.isRead && (
        <button
          type="button"
          onClick={() => onMarkAsRead(notification.id)}
          className="flex-shrink-0 h-7 w-7 rounded-full hover:bg-accent flex items-center justify-center text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 focus:opacity-100 transition"
          aria-label="Mark as read"
        >
          <Check className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

export function NotificationErrorBanner({ message }: { message: string }) {
  return (
    <div
      className="mb-3 rounded-xl border border-amber-200 bg-amber-500/10 px-4 py-3 text-left"
      role="alert"
    >
      <p className="text-sm font-semibold text-amber-950">
        Notification update failed
      </p>
      <p className="mt-1 text-sm text-amber-900">{message}</p>
    </div>
  );
}

type NotificationDropdownPanelProps = {
  panelId?: string;
  panelRef?: RefObject<HTMLDivElement | null>;
  titleId: string;
  unreadCount: number;
  onMarkAllAsRead: () => void;
  onClose: () => void;
  children: ReactNode;
};

export function NotificationDropdownPanel({
  panelId,
  panelRef,
  titleId,
  unreadCount,
  onMarkAllAsRead,
  onClose,
  children,
}: NotificationDropdownPanelProps) {
  return (
    <div
      id={panelId}
      ref={panelRef}
      className="absolute right-0 top-full mt-2 w-[380px] max-w-[calc(100vw-2rem)] rounded-[20px] border border-border bg-card shadow-[0_8px_30px_rgb(0,0,0,0.08)] z-50 overflow-hidden"
      role="dialog"
      aria-labelledby={titleId}
      tabIndex={-1}
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <h3 id={titleId} className="text-sm font-semibold text-foreground">
          {NOTIFICATION_DROPDOWN_TITLE}
        </h3>
        <div className="flex items-center gap-2">
          {unreadCount > 0 && (
            <button
              type="button"
              onClick={onMarkAllAsRead}
              className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition"
            >
              <CheckCheck className="h-3.5 w-3.5" />
              Mark all read
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="h-6 w-6 rounded-full hover:bg-muted flex items-center justify-center text-muted-foreground hover:text-foreground"
            aria-label="Close notifications"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
      {children}
    </div>
  );
}

type NotificationDrawerPanelProps = {
  panelId?: string;
  panelRef?: RefObject<HTMLDivElement | null>;
  titleId: string;
  unreadCount: number;
  onMarkAllAsRead: () => void;
  onClose: () => void;
  children: ReactNode;
};

export function NotificationDrawerPanel({
  panelId,
  panelRef,
  titleId,
  unreadCount,
  onMarkAllAsRead,
  onClose,
  children,
}: NotificationDrawerPanelProps) {
  return (
    <div
      id={panelId}
      ref={panelRef}
      className="fixed right-0 top-0 bottom-0 w-full max-w-md bg-background border-l border-border shadow-[0_0_40px_rgb(0,0,0,0.3)] z-[101] flex flex-col animate-in slide-in-from-right duration-300"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-border flex-shrink-0">
        <h3 id={titleId} className="text-base font-semibold text-foreground">
          {NOTIFICATION_DRAWER_TITLE}
        </h3>
        <div className="flex items-center gap-2">
          {unreadCount > 0 && (
            <button
              type="button"
              onClick={onMarkAllAsRead}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Mark all read
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="h-8 w-8 rounded-full hover:bg-muted flex items-center justify-center text-muted-foreground hover:text-foreground"
            aria-label="Close notifications"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
      {children}
    </div>
  );
}

export function NotificationCenter({
  notifications,
  unreadCount,
  loading,
  actionError,
  hasMore,
  onLoadMore,
  onMarkAsRead,
  onMarkAllAsRead,
  onRefresh,
  unreadOnly = true,
}: NotificationCenterProps) {
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [isMounted, setIsMounted] = useState(false);
  useEffect(() => setIsMounted(true), []);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);
  const dropdownId = useId();
  const dropdownTitleId = useId();
  const drawerId = useId();
  const drawerTitleId = useId();

  const displayList = unreadOnly
    ? notifications.filter((n) => !n.isRead)
    : notifications;

  const restoreBellFocus = useCallback(() => {
    window.setTimeout(() => buttonRef.current?.focus(), 0);
  }, []);

  const closeDropdown = useCallback(
    ({ restoreFocus = true }: { restoreFocus?: boolean } = {}) => {
      setIsOpen(false);
      if (restoreFocus) {
        restoreBellFocus();
      }
    },
    [restoreBellFocus],
  );

  const closeDrawer = useCallback(
    ({ restoreFocus = true }: { restoreFocus?: boolean } = {}) => {
      setDrawerOpen(false);
      if (restoreFocus) {
        restoreBellFocus();
      }
    },
    [restoreBellFocus],
  );

  useModalFocusTrap({
    open: drawerOpen,
    containerRef: drawerRef,
    onClose: () => closeDrawer(),
  });

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(event.target as Node)
      ) {
        closeDropdown({ restoreFocus: false });
      }
    }

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () =>
        document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [closeDropdown, isOpen]);

  // Close dropdown on escape.
  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape" && isOpen) {
        closeDropdown();
      }
    }

    if (isOpen) {
      document.addEventListener("keydown", handleEscape);
      return () => document.removeEventListener("keydown", handleEscape);
    }
  }, [closeDropdown, isOpen]);

  // Refresh when opening
  useEffect(() => {
    if (isOpen) {
      onRefresh();
    }
  }, [isOpen, onRefresh]);

  useEffect(() => {
    if (!isOpen) return;
    const timer = window.setTimeout(() => dropdownRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [isOpen]);

  function handleNotificationClick(
    notification: NotificationRecord,
    closeDrawerOnNavigate = false,
  ) {
    if (!notification.isRead) {
      onMarkAsRead(notification.id);
    }
    if (notification.ticket) {
      closeDropdown({ restoreFocus: false });
      if (closeDrawerOnNavigate) {
        closeDrawer({ restoreFocus: false });
      }
      navigate(`/tickets/${notification.ticket.id}`);
    }
  }

  function openDrawer() {
    closeDropdown({ restoreFocus: false });
    setDrawerOpen(true);
    onRefresh();
  }

  return (
    <div className="relative">
      {/* Bell Button */}
      <button
        ref={buttonRef}
        type="button"
        onClick={() => {
          if (isOpen) {
            closeDropdown();
            return;
          }
          setIsOpen(true);
        }}
        className="relative h-10 w-10 rounded-full border border-border bg-card flex items-center justify-center text-muted-foreground hover:text-foreground hover:border-border transition"
        aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ""}`}
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        aria-controls={isOpen ? dropdownId : undefined}
      >
        <Bell className="h-5 w-5" />
        {unreadCount > 0 && (
          <span
            className="absolute -top-1 -right-1 h-5 w-5 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center"
            aria-live="polite"
            aria-atomic="true"
          >
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown */}
      {isOpen && (
        <NotificationDropdownPanel
          panelId={dropdownId}
          panelRef={dropdownRef}
          titleId={dropdownTitleId}
          unreadCount={unreadCount}
          onMarkAllAsRead={onMarkAllAsRead}
          onClose={() => closeDropdown()}
        >
          {/* Notification List */}
          <div className="max-h-[360px] overflow-y-auto p-3">
            {actionError && <NotificationErrorBanner message={actionError} />}

            {loading && displayList.length === 0 && (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <div
                    key={i}
                    className="animate-pulse rounded-xl bg-card border border-border shadow-sm p-4 flex gap-3"
                  >
                    <div className="h-9 w-9 rounded-full bg-accent flex-shrink-0" />
                    <div className="flex-1 space-y-2 min-w-0">
                      <div className="h-4 w-3/4 rounded bg-accent" />
                      <div className="h-3 w-1/2 rounded bg-muted" />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {!loading && displayList.length === 0 && (
              <div className="py-12 px-4 text-center">
                <Bell className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">
                  {unreadOnly
                    ? "No unread notifications"
                    : "No notifications yet"}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {unreadOnly
                    ? "Marked items disappear from the bell. View all below."
                    : "You'll be notified about ticket updates here"}
                </p>
              </div>
            )}

            <AnimatedList
              className="flex flex-col gap-3"
              role="list"
              aria-label={
                unreadOnly
                  ? UNREAD_NOTIFICATIONS_LABEL
                  : ALL_NOTIFICATIONS_LIST_LABEL
              }
              staggerDelayMs={80}
            >
              {displayList.map((notification) => (
                <div key={notification.id} role="listitem">
                  <NotificationCard
                    notification={notification}
                    onMarkAsRead={onMarkAsRead}
                    onClick={handleNotificationClick}
                  />
                </div>
              ))}
            </AnimatedList>

            {/* Load more (full page drawer only) */}
            {!unreadOnly && hasMore && notifications.length > 0 && (
              <div className="pt-3 border-t border-border">
                <button
                  type="button"
                  onClick={onLoadMore}
                  disabled={loading}
                  className="w-full py-2 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg transition disabled:opacity-50"
                >
                  {loading ? "Loading..." : "Load more"}
                </button>
              </div>
            )}
          </div>

          {/* Sticky footer: See all notifications (always visible) */}
          {unreadOnly && (
            <div className="border-t border-border p-3">
              <button
                type="button"
                onClick={openDrawer}
                className="w-full py-2 text-xs font-medium text-primary hover:text-primary/80 hover:bg-muted rounded-lg transition"
              >
                View all notifications
              </button>
            </div>
          )}
        </NotificationDropdownPanel>
      )}

      {/* Slide-over drawer: all notifications + Load more (no route) */}
      {drawerOpen && isMounted && createPortal(
        <>
          <div
            role="presentation"
            className="fixed inset-0 bg-black/50 z-[100] transition-opacity"
            onClick={() => closeDrawer()}
            aria-hidden
          />
          <NotificationDrawerPanel
            panelId={drawerId}
            panelRef={drawerRef}
            titleId={drawerTitleId}
            unreadCount={unreadCount}
            onMarkAllAsRead={onMarkAllAsRead}
            onClose={() => closeDrawer()}
          >
            <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-3">
              {actionError && <NotificationErrorBanner message={actionError} />}

              {loading && notifications.length === 0 && (
                <div className="space-y-3">
                  {[1, 2, 3].map((i) => (
                    <div
                      key={i}
                      className="animate-pulse rounded-xl bg-card border border-border shadow-sm p-4 flex gap-3"
                    >
                      <div className="h-9 w-9 rounded-full bg-accent flex-shrink-0" />
                      <div className="flex-1 space-y-2 min-w-0">
                        <div className="h-4 w-3/4 rounded bg-accent" />
                        <div className="h-3 w-1/2 rounded bg-muted" />
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {!loading && notifications.length === 0 && (
                <div className="py-12 px-4 text-center">
                  <Bell className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
                  <p className="text-sm text-muted-foreground">No notifications yet</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    You'll be notified about ticket updates here
                  </p>
                </div>
              )}
              {notifications.length > 0 && (
                <>
                  <div
                    role="list"
                    aria-label={ALL_NOTIFICATIONS_LIST_LABEL}
                    className="space-y-3"
                  >
                    {notifications.map((notification) => (
                      <div key={notification.id} role="listitem">
                        <NotificationCard
                          notification={notification}
                          onMarkAsRead={onMarkAsRead}
                          onClick={(n) => handleNotificationClick(n, true)}
                        />
                      </div>
                    ))}
                  </div>
                  {hasMore && (
                    <div className="pt-2">
                      <button
                        type="button"
                        onClick={onLoadMore}
                        disabled={loading}
                        className="w-full py-2 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg border border-border transition disabled:opacity-50"
                      >
                        {loading ? "Loading..." : "Load more"}
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          </NotificationDrawerPanel>
        </>,
        document.body,
      )}
    </div>
  );
}
