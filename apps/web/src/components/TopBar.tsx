import {
  useId,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { LogOut, Menu, Search } from "lucide-react";
import type { CurrentUserSession, NotificationRecord } from "../api/client";
import { useHeaderContext } from "../contexts/HeaderContext";
import { initialsFor } from "../utils/format";
import { NotificationCenter } from "./NotificationCenter";

type NotificationProps = {
  notifications: NotificationRecord[];
  unreadCount: number;
  loading: boolean;
  actionError: string | null;
  hasMore: boolean;
  onLoadMore: () => void;
  onMarkAsRead: (id: string) => void;
  onMarkAllAsRead: () => void;
  onRefresh: () => void;
};

type ProfileRow = {
  label: string;
  value: string;
};

export const PROFILE_POPOVER_TITLE = "Account";

type ProfilePopoverPanelProps = {
  panelId?: string;
  panelRef?: RefObject<HTMLDivElement | null>;
  titleId: string;
  style?: CSSProperties;
  avatarDataUrl?: string | null;
  avatarAlt: string;
  avatarInitials: string;
  displayName: string;
  email: string;
  profileRows: ProfileRow[];
  onSignOut?: () => void;
};

export function ProfilePopoverPanel({
  panelId,
  panelRef,
  titleId,
  style,
  avatarDataUrl,
  avatarAlt,
  avatarInitials,
  displayName,
  email,
  profileRows,
  onSignOut,
}: ProfilePopoverPanelProps) {
  return (
    <div
      id={panelId}
      ref={panelRef}
      className="w-[380px] max-h-[70vh] overflow-y-auto rounded-[20px] border border-slate-200 bg-white p-2 shadow-[0_8px_30px_rgb(0,0,0,0.08)]"
      role="dialog"
      aria-labelledby={titleId}
      style={style}
    >
      <h2 id={titleId} className="sr-only">
        {PROFILE_POPOVER_TITLE}
      </h2>
      <div className="mb-2 rounded-xl bg-slate-50 p-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-100 text-sm font-semibold text-blue-700">
            {avatarDataUrl ? (
              <img
                src={avatarDataUrl}
                alt={avatarAlt}
                className="h-10 w-10 rounded-full object-cover"
              />
            ) : (
              avatarInitials
            )}
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-slate-900">
              {displayName}
            </p>
            <p className="truncate text-xs text-slate-500">{email}</p>
          </div>
        </div>
      </div>
      <div className="px-2 py-2">
        <div className="space-y-2">
          {profileRows.map((row) => (
            <div
              key={row.label}
              className="grid grid-cols-[120px_minmax(0,1fr)] gap-2 text-xs"
            >
              <span className="font-medium text-slate-500">{row.label}</span>
              <span className="break-words text-slate-700">{row.value}</span>
            </div>
          ))}
        </div>
      </div>
      {onSignOut && (
        <div className="mt-2 border-t border-slate-100 px-2 pt-2">
          <button
            type="button"
            onClick={onSignOut}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100 hover:text-slate-900"
          >
            <LogOut className="h-4 w-4 shrink-0" />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

export function TopBar({
  title,
  subtitle,
  currentEmail,
  onOpenNavigation,
  onOpenSearch,
  notificationProps,
  leftAction,
  leftContent,
  user,
  onSignOut,
}: {
  title: string;
  subtitle: string;
  currentEmail: string;
  onOpenNavigation?: () => void;
  onOpenSearch?: () => void;
  notificationProps?: NotificationProps;
  leftAction?: ReactNode;
  /** When provided, replaces the default title+subtitle block (e.g. ticket overview). */
  leftContent?: ReactNode;
  /** Current user from auth session; when set, avatar opens a user menu with details. */
  user?: CurrentUserSession | null;
  onSignOut?: () => void;
}) {
  const headerCtx = useHeaderContext();
  const resolvedOpenNavigation =
    onOpenNavigation ?? headerCtx?.onOpenNavigation;
  const resolvedUser = user ?? headerCtx?.currentUser ?? null;
  const resolvedSignOut = onSignOut ?? headerCtx?.onSignOut;
  const avatarSource =
    resolvedUser?.displayName || resolvedUser?.email || currentEmail;
  const avatarSeed =
    avatarSource.split("@")[0]?.replace(/[._-]+/g, " ") || avatarSource;
  const avatarInitials = initialsFor(avatarSeed);
  const graphProfile = resolvedUser?.graphProfile ?? null;
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const profilePopoverId = useId();
  const profilePopoverTitleId = useId();

  const displayName =
    resolvedUser?.displayName ??
    graphProfile?.displayName ??
    currentEmail?.split("@")[0] ??
    "—";
  const jobTitle = graphProfile?.jobTitle?.trim() ?? "—";
  const officeLocation = graphProfile?.officeLocation?.trim() ?? "—";
  const email =
    resolvedUser?.email ?? currentEmail ?? graphProfile?.mail?.trim() ?? "—";
  const departmentOrTeam =
    graphProfile?.department?.trim() || resolvedUser?.teamName?.trim() || "—";

  const profileRows: ProfileRow[] = [
    { label: "Display Name", value: displayName },
    { label: "Job Title", value: jobTitle },
    { label: "Office Location", value: officeLocation },
    { label: "Email", value: email },
    { label: "Department / Team", value: departmentOrTeam },
  ];

  const handleCloseUserMenu = useCallback(() => setUserMenuOpen(false), []);

  useLayoutEffect(() => {
    if (!userMenuOpen || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const menuWidth = 384; // w-96
    const padding = 8;
    const left = Math.max(
      padding,
      Math.min(
        rect.right - menuWidth,
        document.documentElement.clientWidth - menuWidth - padding,
      ),
    );
    setMenuPosition({ top: rect.bottom + padding, left });
  }, [userMenuOpen]);

  useEffect(() => {
    if (!userMenuOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        !triggerRef.current?.contains(target) &&
        !panelRef.current?.contains(target)
      ) {
        setUserMenuOpen(false);
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setUserMenuOpen(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [userMenuOpen]);

  return (
    <header className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        {resolvedOpenNavigation && (
          <button
            type="button"
            onClick={resolvedOpenNavigation}
            className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/30 lg:hidden"
            aria-label="Open navigation"
          >
            <Menu className="h-5 w-5" />
          </button>
        )}
        {leftAction}
        {leftContent != null ? (
          leftContent
        ) : (
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold leading-tight text-slate-900">
              {title}
            </h1>
            <p className="mt-0.5 truncate text-sm leading-snug text-slate-500">
              {subtitle}
            </p>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {onOpenSearch && (
          <button
            type="button"
            onClick={onOpenSearch}
            className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
            aria-label="Search"
          >
            <Search className="h-4 w-4" />
          </button>
        )}

        {notificationProps && (
          <NotificationCenter
            notifications={notificationProps.notifications}
            unreadCount={notificationProps.unreadCount}
            loading={notificationProps.loading}
            actionError={notificationProps.actionError}
            hasMore={notificationProps.hasMore}
            onLoadMore={notificationProps.onLoadMore}
            onMarkAsRead={notificationProps.onMarkAsRead}
            onMarkAllAsRead={notificationProps.onMarkAllAsRead}
            onRefresh={notificationProps.onRefresh}
            unreadOnly={true}
          />
        )}

        <div className="relative">
          <button
            ref={triggerRef}
            type="button"
            onClick={() => setUserMenuOpen((open) => !open)}
            className="flex h-10 w-10 items-center justify-center rounded-[12px] bg-blue-600 text-sm font-semibold text-white shadow-sm ring-2 ring-transparent transition hover:bg-blue-700 hover:ring-blue-500/20 focus:outline-none"
            aria-label="Account"
            aria-expanded={userMenuOpen}
            aria-haspopup="dialog"
            aria-controls={userMenuOpen ? profilePopoverId : undefined}
          >
            {resolvedUser?.avatarDataUrl ? (
              <img
                src={resolvedUser.avatarDataUrl}
                alt={
                  resolvedUser.displayName ||
                  resolvedUser.email ||
                  "User avatar"
                }
                className="h-full w-full rounded-[12px] object-cover"
              />
            ) : (
              avatarInitials
            )}
          </button>

          {userMenuOpen &&
            createPortal(
              <ProfilePopoverPanel
                panelId={profilePopoverId}
                panelRef={panelRef}
                titleId={profilePopoverTitleId}
                avatarDataUrl={resolvedUser?.avatarDataUrl}
                avatarAlt={
                  resolvedUser?.displayName ||
                  resolvedUser?.email ||
                  "User avatar"
                }
                avatarInitials={
                  resolvedUser
                    ? initialsFor(
                        resolvedUser.displayName || resolvedUser.email,
                      )
                    : avatarInitials
                }
                displayName={
                  resolvedUser?.displayName ??
                  currentEmail.split("@")[0] ??
                  "User"
                }
                email={resolvedUser?.email ?? currentEmail}
                profileRows={profileRows}
                onSignOut={
                  resolvedSignOut
                    ? () => {
                        handleCloseUserMenu();
                        resolvedSignOut();
                      }
                    : undefined
                }
                style={{
                  position: "fixed",
                  top: menuPosition.top,
                  left: menuPosition.left,
                  zIndex: 9999,
                }}
              />,
              document.body,
            )}
        </div>
      </div>
    </header>
  );
}
