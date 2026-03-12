import { describe, expect, it } from "vitest";

import {
  shouldEnableNotificationPolling,
  shouldRefreshNotificationsAfterCountPoll,
} from "./notification-fallback";

describe("notification fallback policy", () => {
  it("enables polling only when realtime is unavailable", () => {
    expect(shouldEnableNotificationPolling(false)).toBe(true);
    expect(shouldEnableNotificationPolling(true)).toBe(false);
  });

  it("refreshes the notification list when the polled unread count changes", () => {
    expect(shouldRefreshNotificationsAfterCountPoll(0, 1)).toBe(true);
    expect(shouldRefreshNotificationsAfterCountPoll(3, 1)).toBe(true);
  });

  it("keeps the current list when the polled unread count is unchanged", () => {
    expect(shouldRefreshNotificationsAfterCountPoll(2, 2)).toBe(false);
  });
});
