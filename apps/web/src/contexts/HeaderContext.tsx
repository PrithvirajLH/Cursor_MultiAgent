import { createContext, useContext, type ReactNode } from 'react';
import type { CurrentUserSession, NotificationRecord } from '../api/client';

export type HeaderContextValue = {
  title: string;
  subtitle: string;
  currentEmail: string;
  personas: { label: string; email: string; role?: string }[];
  onEmailChange: (email: string) => void;
  onOpenSearch?: () => void;
  currentUser?: CurrentUserSession | null;
  onSignOut?: () => void;
  notificationProps?: {
    notifications: NotificationRecord[];
    unreadCount: number;
    loading: boolean;
    hasMore: boolean;
    onLoadMore: () => void;
    onMarkAsRead: (id: string) => void;
    onMarkAllAsRead: () => void;
    onRefresh: () => void;
  };
};

const HeaderContext = createContext<HeaderContextValue | null>(null);

export function HeaderProvider({
  value,
  children,
}: {
  value: HeaderContextValue;
  children: ReactNode;
}) {
  return <HeaderContext.Provider value={value}>{children}</HeaderContext.Provider>;
}

/**
 * Access the header context value. Must be used within a HeaderProvider.
 * Returns null if not inside a provider (safe for standalone rendering).
 */
export function useHeaderContext(): HeaderContextValue | null {
  return useContext(HeaderContext);
}
