import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  NOTIFICATION_DRAWER_TITLE,
  NOTIFICATION_DROPDOWN_TITLE,
  NotificationCard,
  NotificationDrawerPanel,
  NotificationDropdownPanel,
  NotificationErrorBanner,
} from "./NotificationCenter";

describe("notification mutation errors", () => {
  it("renders a visible notification action error banner", () => {
    const html = renderToStaticMarkup(
      <NotificationErrorBanner message="Network error. Please check your connection." />,
    );

    expect(html).toContain("Notification update failed");
    expect(html).toContain("Network error. Please check your connection.");
  });

  it("renders separate sibling buttons for opening and marking a notification as read", () => {
    const html = renderToStaticMarkup(
      <NotificationCard
        notification={{
          id: "notification-1",
          type: "NEW_MESSAGE",
          title: "Status updated",
          body: "Status changed from CLOSED to REOPENED.",
          isRead: false,
          createdAt: "2026-03-10T12:00:00.000Z",
          readAt: null,
          ticket: {
            id: "ticket-1",
            number: 101,
            subject: "Network is Down",
            displayId: "AI_20260220_001",
          },
        }}
        onMarkAsRead={() => {}}
        onClick={() => {}}
      />,
    );

    expect(html).not.toContain('role="button"');
    expect(html.match(/<button/g)?.length).toBe(2);
    expect(html).toContain('aria-label="Mark as read"');
  });
});

describe("notification accessibility shells", () => {
  it("renders the bell popover as a dialog with list semantics", () => {
    const html = renderToStaticMarkup(
      <NotificationDropdownPanel
        titleId="notifications-popover-title"
        unreadCount={1}
        onMarkAllAsRead={() => {}}
        onClose={() => {}}
      >
        <div role="list" aria-label="Unread notifications">
          <div role="listitem">First notification</div>
        </div>
      </NotificationDropdownPanel>,
    );

    expect(html).toContain('role="dialog"');
    expect(html).not.toContain('role="menu"');
    expect(html).toContain(`>${NOTIFICATION_DROPDOWN_TITLE}<`);
    expect(html).toContain('role="list"');
    expect(html).toContain('role="listitem"');
  });

  it("renders the drawer as a modal dialog", () => {
    const html = renderToStaticMarkup(
      <NotificationDrawerPanel
        titleId="notifications-drawer-title"
        unreadCount={2}
        onMarkAllAsRead={() => {}}
        onClose={() => {}}
      >
        <div role="list" aria-label="All notifications">
          <div role="listitem">First notification</div>
        </div>
      </NotificationDrawerPanel>,
    );

    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain(`>${NOTIFICATION_DRAWER_TITLE}<`);
    expect(html).toContain('Close notifications');
  });
});
