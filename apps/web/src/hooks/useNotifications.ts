import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchNotifications,
  fetchUnreadNotificationCount,
  getDemoUserEmail,
  markAllNotificationsAsRead,
  markNotificationAsRead,
  type NotificationRecord,
} from "../api/client";
import { shouldRefreshNotificationsAfterCountPoll } from "./notification-fallback";
import { handleApiError } from "../utils/handleApiError";

type UseNotificationsOptions = {
  /** Polling interval in milliseconds (default: 30000 = 30 seconds) */
  pollingInterval?: number;
  /** Whether to enable polling (default: true) */
  enablePolling?: boolean;
  /** Page size for fetching notifications (default: 20) */
  pageSize?: number;
  /** User key (e.g., email) to reset notifications when user changes */
  userKey?: string;
  /** Optional callback for surfacing mutation failures to the UI (e.g. toast). */
  onActionError?: (message: string) => void;
};

type RealtimeNotificationUpdate = {
  reason?: string;
  unreadCount?: number;
};

export function useNotifications(options: UseNotificationsOptions = {}) {
  const {
    pollingInterval = 30000,
    enablePolling = true,
    pageSize = 20,
    userKey,
    onActionError,
  } = options;

  const [notifications, setNotifications] = useState<NotificationRecord[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [page, setPage] = useState(1);
  // Track when userKey is synced to storage to prevent fetching with stale credentials
  const [userKeySynced, setUserKeySynced] = useState(false);
  const [isTabVisible, setIsTabVisible] = useState(() => {
    if (typeof document === "undefined") return true;
    return document.visibilityState === "visible";
  });

  const pollingRef = useRef<number | null>(null);
  const mountedRef = useRef(true);
  const previousUserKeyRef = useRef(userKey);
  // Track current userKey for guarding stale responses - updated synchronously
  const currentUserKeyRef = useRef(userKey);
  currentUserKeyRef.current = userKey;
  const countInFlightRef = useRef(false);
  const realtimeRefreshTimerRef = useRef<number | null>(null);
  const unreadCountRef = useRef(0);

  useEffect(() => {
    unreadCountRef.current = unreadCount;
  }, [unreadCount]);

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
          pageSize,
        });

        // Guard: don't apply results if user changed during request
        if (
          !mountedRef.current ||
          currentUserKeyRef.current !== requestUserKey
        ) {
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
        if (
          !mountedRef.current ||
          currentUserKeyRef.current !== requestUserKey
        ) {
          return;
      }
        setError("Failed to load notifications");
      } finally {
        // Guard: don't update loading if user changed during request
        if (
          mountedRef.current &&
          currentUserKeyRef.current === requestUserKey
        ) {
          setLoading(false);
        }
      }
    },
    [pageSize, isUserKeySynced],
  );

  // Poll the unread count, and refresh the first page if the count changed.
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
    const previousUnreadCount = unreadCountRef.current;

    try {
      const response = await fetchUnreadNotificationCount();
      // Guard: don't apply results if user changed during request
      if (mountedRef.current && currentUserKeyRef.current === requestUserKey) {
        setUnreadCount(response.count);
        if (
          shouldRefreshNotificationsAfterCountPoll(
            previousUnreadCount,
            response.count,
          )
        ) {
          void fetchData(1, false);
        }
      }
    } catch {
    } finally {
      countInFlightRef.current = false;
    }
  }, [fetchData, isUserKeySynced]);

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

  const applyRealtimeUpdate = useCallback(
    (payload: RealtimeNotificationUpdate = {}) => {
      if (
        typeof payload.unreadCount === "number" &&
        Number.isFinite(payload.unreadCount)
      ) {
        setUnreadCount(Math.max(0, payload.unreadCount));
      }

      // Fetch latest list on realtime notification updates to keep the drawer
      // content in sync without background polling.
      if (!payload.reason || !isTabVisible) {
        return;
      }

      if (realtimeRefreshTimerRef.current) {
        window.clearTimeout(realtimeRefreshTimerRef.current);
      }
      realtimeRefreshTimerRef.current = window.setTimeout(() => {
        void fetchData(1, false);
      }, 200);
    },
    [fetchData, isTabVisible],
  );

  // Mark a single notification as read
  const markAsRead = useCallback(async (notificationId: string) => {
    setActionError(null);
    try {
      await markNotificationAsRead(notificationId);

      // Optimistically update local state
      setNotifications((prev) =>
        prev.map((n) =>
          n.id === notificationId
            ? { ...n, isRead: true, readAt: new Date().toISOString() }
            : n,
        ),
      );
      setUnreadCount((prev) => Math.max(0, prev - 1));
    } catch (err) {
      const message = handleApiError(err);
      setActionError(message);
      onActionError?.(message);
    }
  }, [onActionError]);

  // Mark all notifications as read
  const markAllAsRead = useCallback(async () => {
    setActionError(null);
    try {
      await markAllNotificationsAsRead();

      // Optimistically update local state
      setNotifications((prev) =>
        prev.map((n) => ({
          ...n,
          isRead: true,
          readAt: new Date().toISOString(),
        })),
      );
      setUnreadCount(0);
    } catch (err) {
      const message = handleApiError(err);
      setActionError(message);
      onActionError?.(message);
    }
  }, [onActionError]);

  // Reset state when user changes (prevents cross-user data leak)
  useEffect(() => {
    if (previousUserKeyRef.current !== userKey) {
      // User changed - clear all state immediately to prevent showing old user's data
      setNotifications([]);
      setUnreadCount(0);
      setError(null);
      setActionError(null);
      setHasMore(true);
      setPage(1);
      setUserKeySynced(false);
      previousUserKeyRef.current = userKey;
    }
  }, [userKey]);

  // Pause polling when the tab is not visible to reduce background contention.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const handleVisibility = () =>
      setIsTabVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", handleVisibility);
    return () =>
      document.removeEventListener("visibilitychange", handleVisibility);
  }, []);

  // Check if userKey is synced to storage and trigger fetch when ready.
  // Use a single delayed check instead of an interval loop.
  useEffect(() => {
    if (!userKey) {
      setUserKeySynced(true);
      return;
    }

    if (isUserKeySynced()) {
      setUserKeySynced(true);
      return;
    }

    const timeout = window.setTimeout(() => {
      setUserKeySynced(true);
    }, 100);

    return () => window.clearTimeout(timeout);
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
    if (
      !enablePolling ||
      pollingInterval <= 0 ||
      !userKeySynced ||
      !isTabVisible
    ) {
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

  useEffect(() => {
    return () => {
      if (realtimeRefreshTimerRef.current) {
        window.clearTimeout(realtimeRefreshTimerRef.current);
        realtimeRefreshTimerRef.current = null;
      }
    };
  }, []);

  return {
    notifications,
    unreadCount,
    loading,
    error,
    actionError,
    hasMore,
    loadMore,
    refresh,
    applyRealtimeUpdate,
    markAsRead,
    markAllAsRead,
  };
}
