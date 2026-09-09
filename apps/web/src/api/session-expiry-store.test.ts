import { beforeEach, describe, expect, it, vi } from "vitest";
import { sessionExpiryStore } from "./session-expiry-store";

/**
 * Card 1.54 — the signal that lets a screen tell "signed out" from "load failed".
 *
 * The owner's page showed *"Unable to load tickets"* with a Retry button beside
 * sidebar badges still holding their last good numbers, while every request on
 * the page was 401ing. Both surfaces read this store now.
 */
describe("sessionExpiryStore", () => {
  beforeEach(() => {
    sessionExpiryStore.listeners.clear();
    sessionExpiryStore.expired = false;
  });

  it("⚠️ notifies once when many requests fail together, not once per request", () => {
    // THE ASSERTION THAT FAILS IF THE BUG COMES BACK. Eleven requests 401'd in
    // a 70 ms burst. A store that re-notified per failure would drive eleven
    // re-renders and, through `fireAuthFailure`, eleven redirects.
    const listener = vi.fn();
    sessionExpiryStore.subscribe(listener);
    sessionExpiryStore.set(true);
    sessionExpiryStore.set(true);
    sessionExpiryStore.set(true);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(true);
  });

  it("reports recovery, so a screen can clear the banner", () => {
    const listener = vi.fn();
    sessionExpiryStore.subscribe(listener);
    sessionExpiryStore.set(true);
    sessionExpiryStore.set(false);
    expect(listener).toHaveBeenNthCalledWith(2, false);
    expect(sessionExpiryStore.isExpired()).toBe(false);
  });

  it("stops notifying after unsubscribe", () => {
    const listener = vi.fn();
    const unsubscribe = sessionExpiryStore.subscribe(listener);
    unsubscribe();
    sessionExpiryStore.set(true);
    expect(listener).not.toHaveBeenCalled();
  });

  it("exposes the current value for a first render before any event", () => {
    expect(sessionExpiryStore.isExpired()).toBe(false);
    sessionExpiryStore.set(true);
    expect(sessionExpiryStore.isExpired()).toBe(true);
  });
});
