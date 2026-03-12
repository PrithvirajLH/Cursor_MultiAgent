export function shouldEnableNotificationPolling(
  realtimeAvailable: boolean,
): boolean {
  return !realtimeAvailable;
}

export function shouldRefreshNotificationsAfterCountPoll(
  previousUnreadCount: number,
  nextUnreadCount: number,
): boolean {
  return previousUnreadCount !== nextUnreadCount;
}
