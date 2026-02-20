import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, LogOut, Search } from 'lucide-react';
import type { CurrentUserSession, NotificationRecord } from '../api/client';
import { useHeaderContext } from '../contexts/HeaderContext';
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

/** Formats role for display (e.g. TEAM_ADMIN -> Team Admin). */
function formatRole(role: string): string {
  return role.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

type ProfileRow = {
  label: string;
  value: string;
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
  leftContent,
  user,
  onSignOut
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
  /** Current user from auth session; when set, avatar opens a user menu with details. */
  user?: CurrentUserSession | null;
  onSignOut?: () => void;
}) {
  const headerCtx = useHeaderContext();
  const resolvedUser = user ?? headerCtx?.currentUser ?? null;
  const resolvedSignOut = onSignOut ?? headerCtx?.onSignOut;
  const avatarSource = resolvedUser?.displayName || resolvedUser?.email || currentEmail;
  const avatarSeed = avatarSource.split('@')[0]?.replace(/[._-]+/g, ' ') || avatarSource;
  const avatarInitials = initialsFor(avatarSeed);
  const graphProfile = resolvedUser?.graphProfile ?? null;
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const displayName =
    resolvedUser?.displayName ?? graphProfile?.displayName ?? currentEmail?.split('@')[0] ?? '—';
  const jobTitle = graphProfile?.jobTitle?.trim() ?? '—';
  const officeLocation = graphProfile?.officeLocation?.trim() ?? '—';
  const email = resolvedUser?.email ?? currentEmail ?? graphProfile?.mail?.trim() ?? '—';
  const departmentOrTeam =
    graphProfile?.department?.trim() ||
    (resolvedUser?.teamRole ? formatRole(resolvedUser.teamRole) : null) ||
    '—';

  const profileRows: ProfileRow[] = [
    { label: 'Display Name', value: displayName },
    { label: 'Job Title', value: jobTitle },
    { label: 'Office Location', value: officeLocation },
    { label: 'Email', value: email },
    { label: 'Department / Team', value: departmentOrTeam },
  ];

  const handleCloseUserMenu = useCallback(() => setUserMenuOpen(false), []);

  useLayoutEffect(() => {
    if (!userMenuOpen || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const menuWidth = 384; // w-96
    const padding = 8;
    const left = Math.max(
      padding,
      Math.min(rect.right - menuWidth, document.documentElement.clientWidth - menuWidth - padding),
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
      if (event.key === 'Escape') setUserMenuOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [userMenuOpen]);

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

        {personas.length > 1 && (
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
        )}

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

        <div className="relative">
          <button
            ref={triggerRef}
            type="button"
            onClick={() => setUserMenuOpen((open) => !open)}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-600 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
            aria-label="User menu"
            aria-expanded={userMenuOpen}
            aria-haspopup="true"
          >
            {resolvedUser?.avatarDataUrl ? (
              <img
                src={resolvedUser.avatarDataUrl}
                alt={resolvedUser.displayName || resolvedUser.email || 'User avatar'}
                className="h-10 w-10 rounded-full object-cover"
              />
            ) : (
              avatarInitials
            )}
          </button>

          {userMenuOpen &&
            createPortal(
              <div
                ref={panelRef}
                className="w-96 max-h-[70vh] overflow-y-auto rounded-xl border border-slate-200 bg-white py-2 shadow-lg"
                role="menu"
                aria-orientation="vertical"
                style={{
                  position: 'fixed',
                  top: menuPosition.top,
                  left: menuPosition.left,
                  zIndex: 9999,
                }}
              >
                <div className="border-b border-slate-100 px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-100 text-sm font-semibold text-blue-700">
                      {resolvedUser?.avatarDataUrl ? (
                        <img
                          src={resolvedUser.avatarDataUrl}
                          alt={resolvedUser.displayName || resolvedUser.email || 'User avatar'}
                          className="h-10 w-10 rounded-full object-cover"
                        />
                      ) : (
                        resolvedUser
                          ? initialsFor(resolvedUser.displayName || resolvedUser.email)
                          : avatarInitials
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-900">
                        {resolvedUser?.displayName ?? currentEmail.split('@')[0] ?? 'User'}
                      </p>
                      <p className="truncate text-xs text-slate-500">{resolvedUser?.email ?? currentEmail}</p>
                    </div>
                  </div>
                </div>
                <div className="border-t border-slate-100 px-4 py-2">
                  <div className="space-y-1.5">
                    {profileRows.map((row) => (
                      <div key={row.label} className="grid grid-cols-[120px_minmax(0,1fr)] gap-2 text-xs">
                        <span className="font-medium text-slate-500">{row.label}</span>
                        <span className="break-words text-slate-700">{row.value}</span>
                      </div>
                    ))}
                  </div>
                </div>
                {resolvedSignOut && (
                  <div className="border-t border-slate-100 pt-2">
                    <button
                      type="button"
                      onClick={() => {
                        handleCloseUserMenu();
                        resolvedSignOut();
                      }}
                      className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-slate-700 transition hover:bg-slate-50 hover:text-slate-900"
                      role="menuitem"
                    >
                      <LogOut className="h-4 w-4 shrink-0" />
                      Sign out
                    </button>
                  </div>
                )}
              </div>,
              document.body,
            )}
        </div>
      </div>
    </header>
  );
}
