import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function jsonResponse(payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function hangingFetch() {
  return vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
    return new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (signal?.aborted) {
        reject(new DOMException("Aborted", "AbortError"));
        return;
      }
      signal?.addEventListener(
        "abort",
        () => reject(new DOMException("Aborted", "AbortError")),
        { once: true },
      );
    });
  });
}

describe("notification client caching", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("bypasses the hot GET cache for notification list reads", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            {
              id: "notification-1",
              type: "TEST",
              title: "First",
              body: null,
              isRead: false,
              readAt: null,
              createdAt: "2026-03-10T12:00:00.000Z",
            },
          ],
          meta: {
            page: 1,
            pageSize: 20,
            total: 1,
            totalPages: 1,
            unreadCount: 1,
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            {
              id: "notification-2",
              type: "TEST",
              title: "Second",
              body: null,
              isRead: false,
              readAt: null,
              createdAt: "2026-03-10T12:00:01.000Z",
            },
          ],
          meta: {
            page: 1,
            pageSize: 20,
            total: 1,
            totalPages: 1,
            unreadCount: 2,
          },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const client = await import("./client");
    const first = await client.fetchNotifications();
    const second = await client.fetchNotifications();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(first.data[0]?.id).toBe("notification-1");
    expect(second.data[0]?.id).toBe("notification-2");
  });

  it("bypasses the hot GET cache for unread notification count reads", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ count: 1 }))
      .mockResolvedValueOnce(jsonResponse({ count: 2 }));
    vi.stubGlobal("fetch", fetchMock);

    const client = await import("./client");
    const first = await client.fetchUnreadNotificationCount();
    const second = await client.fetchUnreadNotificationCount();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(first.count).toBe(1);
    expect(second.count).toBe(2);
  });

  it("keeps the shared hot GET cache for non-notification endpoints", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        assignedToMe: 1,
        triage: 2,
        open: 3,
        unassigned: 4,
        resolved: 5,
        resolvedByMe: 6,
        atRisk: 7,
        overdue: 8,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = await import("./client");
    const first = await client.fetchTicketCounts();
    const second = await client.fetchTicketCounts();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
  });

  it("times out shared apiFetch requests instead of hanging forever", async () => {
    vi.useFakeTimers();
    const fetchMock = hangingFetch();
    vi.stubGlobal("fetch", fetchMock);

    const client = await import("./client");
    const pending = expect(client.fetchTicketCounts()).rejects.toMatchObject({
      message: "Request timed out",
      status: 408,
    });

    await vi.advanceTimersByTimeAsync(30_001);

    await pending;
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("times out direct export fetches instead of hanging forever", async () => {
    vi.useFakeTimers();
    const fetchMock = hangingFetch();
    vi.stubGlobal("fetch", fetchMock);

    const client = await import("./client");
    const pending = expect(client.fetchAuditLogExport()).rejects.toMatchObject({
      message: "Request timed out",
      status: 408,
    });

    await vi.advanceTimersByTimeAsync(30_001);

    await pending;
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("formats validation error arrays from shared apiFetch responses", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          statusCode: 400,
          message: [
            "subject must be a string",
            "priority must be one of P1, P2, P3, P4",
          ],
          error: "Bad Request",
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = await import("./client");
    const { handleApiError } = await import("../utils/handleApiError");
    const error = await client.fetchTicketCounts().catch((caught) => caught);

    expect(error).toMatchObject({
      message: "subject must be a string. priority must be one of P1, P2, P3, P4",
      status: 400,
    });
    expect(handleApiError(error)).toBe(
      "subject must be a string. priority must be one of P1, P2, P3, P4",
    );
  });

  it("searches cached users across all paginated user pages", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);

      if (url.endsWith("/tickets?q=zoe&pageSize=5")) {
        return Promise.resolve(jsonResponse({ data: [] }));
      }

      if (url.endsWith("/users?page=1&pageSize=100")) {
        return Promise.resolve(
          jsonResponse({
            data: [
              {
                id: "user-1",
                displayName: "Alice Agent",
                email: "alice@example.com",
              },
            ],
            meta: {
              page: 1,
              pageSize: 100,
              total: 101,
              totalPages: 2,
            },
          }),
        );
      }

      if (url.endsWith("/users?page=2&pageSize=100")) {
        return Promise.resolve(
          jsonResponse({
            data: [
              {
                id: "user-101",
                displayName: "Zoe Agent",
                email: "zoe@example.com",
              },
            ],
            meta: {
              page: 2,
              pageSize: 100,
              total: 101,
              totalPages: 2,
            },
          }),
        );
      }

      if (url.endsWith("/teams")) {
        return Promise.resolve(jsonResponse({ data: [] }));
      }

      return Promise.reject(new Error(`Unexpected URL: ${url}`));
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = await import("./client");
    const results = await client.searchAll("zoe");

    expect(results.users).toEqual([
      {
        id: "user-101",
        displayName: "Zoe Agent",
        email: "zoe@example.com",
      },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("propagates abort through command-palette search requests", async () => {
    const fetchMock = hangingFetch();
    vi.stubGlobal("fetch", fetchMock);

    const client = await import("./client");
    const controller = new AbortController();
    const pending = client.searchAll("agent", controller.signal);

    controller.abort();

    await expect(pending).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
