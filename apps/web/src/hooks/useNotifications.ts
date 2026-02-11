import { useCallback, useEffect, useRef, useState } from 'react';
import {
  fetchNotifications,
  fetchUnreadNotificationCount,
  getDemoUserEmail,
  markAllNotificationsAsRead,
  markNotificationAsRead,
  type NotificationRecord
} from '../api/client';

type UseNotificationsOptions = {
  /** Polling interval in milliseconds (default: 30000 = 30 seconds) */
  pollingInterval?: number;
  /** Whether to enable polling (default: true) */
  enablePolling?: boolean;
  /** Page size for fetching notifications (default: 20) */
  pageSize?: number;
  /** User key (e.g., email) to reset notifications when user changes */
  userKey?: string;
};

export function useNotifications(options: UseNotificationsOptions = {}) {
  const { pollingInterval = 30000, enablePolling = true, pageSize = 20, userKey } = options;

  const [notifications, setNotifications] = useState<NotificationRecord[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [page, setPage] = useState(1);
  // Track when userKey is synced to storage to prevent fetching with stale credentials
  const [userKeySynced, setUserKeySynced] = useState(false);
  const [isTabVisible, setIsTabVisible] = useState(() => {
    if (typeof document === 'undefined') return true;
    return document.visibilityState === 'visible';
  });

  const pollingRef = useRef<number | null>(null);
  const mountedRef = useRef(true);
  const previousUserKeyRef = useRef(userKey);
  // Track current userKey for guarding stale responses - updated synchronously
  const currentUserKeyRef = useRef(userKey);
  currentUserKeyRef.current = userKey;
  const countInFlightRef = useRef(false);

  // Check if userKey matches the persisted email to prevent fetching with stale credentials
  const isUserKeySynced = useCallback(() => {
    if (!userKey) return true; // No userKey specified, proceed
    const persistedEmail = getDemoUserEmail();
    return persistedEmail === userKey;
  }, [userKey]);

  // Fetch notifications with request cancellation support
  const fetchData = useCallback(
    async (pageNum: number = 1, append: boolean = false) => {
      if (!mountedRef.current) return;
      
      // Guard: don't fetch until userKey is synced to storage
      if (!isUserKeySynced()) {
        return;
      }

      // Capture userKey at request start to guard against stale responses
      const requestUserKey = currentUserKeyRef.current;

      setLoading(true);
      setError(null);

      try {
        const response = await fetchNotifications({
          page: pageNum,
          pageSize
        });

        // Guard: don't apply results if user changed during request
        if (!mountedRef.current || currentUserKeyRef.current !== requestUserKey) {
          return;
        }

        if (append) {
          setNotifications((prev) => [...prev, ...response.data]);
        } else {
          setNotifications(response.data);
        }

        setUnreadCount(response.meta.unreadCount);
        setHasMore(pageNum < response.meta.totalPages);
        setPage(pageNum);
      } catch (err) {
        // Guard: don't apply error if user changed during request
        if (!mountedRef.current || currentUserKeyRef.current !== requestUserKey) {
          return;
        }
        setError('Failed to load notifications');
        console.error('Failed to fetch notifications', err);
      } finally {
        // Guard: don't update loading if user changed during request
        if (mountedRef.current && currentUserKeyRef.current === requestUserKey) {
          setLoading(false);
        }
      }
    },
    [pageSize, isUserKeySynced]
  );

  // Fetch just the unread count (lightweight polling) with request cancellation support
  const fetchCount = useCallback(async () => {
    if (!mountedRef.current) return;
    
    // Guard: don't fetch until userKey is synced to storage
    if (!isUserKeySynced()) {
      return;
    }

    // Avoid overlapping poll requests (can happen on slow networks).
    if (countInFlightRef.current) return;
    countInFlightRef.current = true;

    // Capture userKey at request start to guard against stale responses
    const requestUserKey = currentUserKeyRef.current;

    try {
      const response = await fetchUnreadNotificationCount();
      // Guard: don't apply results if user changed during request
      if (mountedRef.current && currentUserKeyRef.current === requestUserKey) {
        setUnreadCount(response.count);
      }
    } catch (err) {
      console.error('Failed to fetch unread count', err);
    } finally {
      countInFlightRef.current = false;
    }
  }, [isUserKeySynced]);

  // Load more notifications (pagination)
  const loadMore = useCallback(() => {
    if (!loading && hasMore) {
      fetchData(page + 1, true);
    }
  }, [loading, hasMore, page, fetchData]);

  // Refresh notifications (reset to page 1)
  const refresh = useCallback(() => {
    fetchData(1, false);
  }, [fetchData]);

  // Mark a single notification as read
  const markAsRead = useCallback(async (notificationId: string) => {
    try {
      await markNotificationAsRead(notificationId);

      // Optimistically update local state
      setNotifications((prev) =>
        prev.map((n) =>
          n.id === notificationId ? { ...n, isRead: true, readAt: new Date().toISOString() } : n
        )
      );
      setUnreadCount((prev) => Math.max(0, prev - 1));
    } catch (err) {
      console.error('Failed to mark notification as read', err);
    }
  }, []);

  // Mark all notifications as read
  const markAllAsRead = useCallback(async () => {
    try {
      await markAllNotificationsAsRead();

      // Optimistically update local state
      setNotifications((prev) =>
        prev.map((n) => ({ ...n, isRead: true, readAt: new Date().toISOString() }))
      );
      setUnreadCount(0);
    } catch (err) {
      console.error('Failed to mark all notifications as read', err);
    }
  }, []);

  // Reset state when user changes (prevents cross-user data leak)
  useEffect(() => {
    if (previousUserKeyRef.current !== userKey) {
      // User changed - clear all state immediately to prevent showing old user's data
      setNotifications([]);
      setUnreadCount(0);
      setError(null);
      setHasMore(true);
      setPage(1);
      setUserKeySynced(false);
      previousUserKeyRef.current = userKey;
    }
  }, [userKey]);

  // Pause polling when the tab is not visible to reduce background contention.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const handleVisibility = () => setIsTabVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, []);

  // Check if userKey is synced to storage and trigger fetch when ready
  useEffect(() => {
    if (!userKey) {
      setUserKeySynced(true);
      return;
    }

    // Check periodically until userKey matches persisted email
    const checkSync = () => {
      if (isUserKeySynced()) {
        setUserKeySynced(true);
        return true;
      }
      return false;
    };

    // Check immediately
    if (checkSync()) return;

    // If not synced, poll briefly (setDemoUserEmail runs in useEffect, so it should sync quickly)
    const interval = setInterval(() => {
      if (checkSync()) {
        clearInterval(interval);
      }
    }, 10);

    // Clean up after a reasonable timeout
    const timeout = setTimeout(() => {
      clearInterval(interval);
      setUserKeySynced(true); // Proceed anyway after timeout
    }, 500);

    return () => {
      clearInterval(interval);
      clearTimeout(timeout);
    };
  }, [userKey, isUserKeySynced]);

  // Initial fetch and refetch when user changes and is synced
  useEffect(() => {
    mountedRef.current = true;
    
    // Only fetch when userKey is synced to storage
    if (userKeySynced) {
      fetchData(1, false);
    }

    return () => {
      mountedRef.current = false;
    };
  }, [fetchData, userKeySynced]);

  // Set up polling (only when user is synced)
  useEffect(() => {
    if (!enablePolling || pollingInterval <= 0 || !userKeySynced || !isTabVisible) {
      return;
    }

    // Poll for unread count (lightweight)
    pollingRef.current = window.setInterval(() => {
      fetchCount();
    }, pollingInterval);

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, [enablePolling, pollingInterval, fetchCount, userKeySynced, isTabVisible]);

  return {
    notifications,
    unreadCount,
    loading,
    error,
    hasMore,
    loadMore,
    refresh,
    markAsRead,
    markAllAsRead
  };
}
