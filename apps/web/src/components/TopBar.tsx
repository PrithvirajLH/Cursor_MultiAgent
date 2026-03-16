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
      className="w-[340px] max-h-[70vh] overflow-y-auto rounded-xl border shadow-elevated"
      role="dialog"
      aria-labelledby={titleId}
      style={{
        ...style,
        background: "hsl(var(--popover))",
        borderColor: "hsl(var(--border))",
      }}
    >
      <h2 id={titleId} className="sr-only">
        {PROFILE_POPOVER_TITLE}
      </h2>

      {/* Profile header */}
      <div className="p-4 border-b" style={{ borderColor: "hsl(var(--border))" }}>
        <div className="flex items-center gap-3">
          <div
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-sm font-bold text-white shadow-glow-sm"
            style={{
              background: avatarDataUrl
                ? "transparent"
                : "linear-gradient(135deg, hsl(var(--primary)) 0%, hsl(217 91% 60%) 100%)",
            }}
          >
            {avatarDataUrl ? (
              <img
                src={avatarDataUrl}
                alt={avatarAlt}
                className="h-10 w-10 rounded-xl object-cover"
              />
            ) : (
              <span style={{ color: "hsl(var(--primary-foreground))" }}>
                {avatarInitials}
              </span>
            )}
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-foreground">
              {displayName}
            </p>
            <p className="truncate text-xs text-muted-foreground">{email}</p>
          </div>
        </div>
      </div>

      {/* Profile rows */}
      <div className="p-4 space-y-3">
        {profileRows.map((row) => (
          <div
            key={row.label}
            className="grid grid-cols-[110px_minmax(0,1fr)] gap-3 text-xs"
          >
            <span className="font-medium text-muted-foreground">{row.label}</span>
            <span className="break-words text-foreground/80">{row.value}</span>
          </div>
        ))}
      </div>

      {/* Sign out */}
      {onSignOut && (
        <div className="p-2 border-t" style={{ borderColor: "hsl(var(--border))" }}>
          <button
            type="button"
            onClick={onSignOut}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-muted-foreground transition-all hover:bg-accent hover:text-foreground"
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
  leftContent?: ReactNode;
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
    const menuWidth = 340;
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
      {/* Left: title + nav toggle */}
      <div className="flex min-w-0 flex-1 items-center gap-3">
        {resolvedOpenNavigation && (
          <button
            type="button"
            onClick={resolvedOpenNavigation}
            className="inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground transition-all hover:border-white/20 hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring/30 lg:hidden"
            aria-label="Open navigation"
          >
            <Menu className="h-4 w-4" />
          </button>
        )}
        {leftAction}
        {leftContent != null ? (
          leftContent
        ) : (
          <div className="min-w-0">
            <h1 className="truncate text-[19px] font-semibold leading-tight tracking-tight text-foreground">
              {title}
            </h1>
            {subtitle && (
              <p className="mt-0.5 truncate text-[13px] leading-snug text-muted-foreground">
                {subtitle}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Right: search + notifications + avatar */}
      <div className="flex flex-wrap items-center gap-2">
        {onOpenSearch && (
          <button
            type="button"
            onClick={onOpenSearch}
            className="inline-flex items-center gap-2 h-9 px-3 rounded-lg border border-border bg-card text-muted-foreground text-[13px] transition-all hover:border-white/20 hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring/30"
            aria-label="Search (⌘K)"
          >
            <Search className="h-3.5 w-3.5 flex-shrink-0" />
            <span className="hidden sm:inline">Search</span>
            <kbd className="hidden sm:inline-flex items-center gap-0.5 rounded border border-white/10 bg-white/[0.06] px-1.5 py-0.5 text-[10px] font-medium text-white/35">
              ⌘K
            </kbd>
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

        {/* Avatar / user menu */}
        <div className="relative">
          <button
            ref={triggerRef}
            type="button"
            onClick={() => setUserMenuOpen((open) => !open)}
            className="flex h-9 w-9 items-center justify-center rounded-xl text-[13px] font-bold text-white transition-all ring-2 ring-transparent hover:ring-[hsl(var(--primary)/0.3)] focus:outline-none shadow-glow-sm"
            style={{
              background:
                "linear-gradient(135deg, hsl(var(--primary)) 0%, hsl(217 91% 60%) 100%)",
            }}
            aria-label="Account"
            aria-expanded={userMenuOpen}
            aria-haspopup="dialog"
            aria-controls={userMenuOpen ? profilePopoverId : undefined}
          >
            {resolvedUser?.avatarDataUrl ? (
              <img
                src={resolvedUser.avatarDataUrl}
                alt={resolvedUser.displayName || resolvedUser.email || "User avatar"}
                className="h-full w-full rounded-xl object-cover"
              />
            ) : (
              <span style={{ color: "hsl(var(--primary-foreground))" }}>
                {avatarInitials}
              </span>
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
