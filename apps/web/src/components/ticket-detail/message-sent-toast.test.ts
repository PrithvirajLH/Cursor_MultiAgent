import { describe, expect, it } from "vitest";
import { messageSentToast } from "./message-sent-toast";

/**
 * Card 1.38, 5a. The toast used to key off the local `messageType`, so an
 * agent whose PUBLIC reply the server stored as INTERNAL read "Reply sent" and
 * believed the requester had been emailed. Nothing anywhere said otherwise.
 */
describe("messageSentToast", () => {
  it("says so when the server stored an internal note we did not ask for", () => {
    expect(messageSentToast("PUBLIC", "INTERNAL")).toBe(
      "Saved as an internal note — the requester was not emailed.",
    );
  });

  it("does not nag when an internal note is what was asked for", () => {
    expect(messageSentToast("INTERNAL", "INTERNAL")).toBe(
      "Internal note added",
    );
  });

  it("confirms a public reply that really went out", () => {
    expect(messageSentToast("PUBLIC", "PUBLIC")).toBe("Reply sent");
  });

  it("reports the server's answer even when it is more public than requested", () => {
    // Not a case the API produces today, but the function must not invent a
    // withheld-email warning that did not happen.
    expect(messageSentToast("INTERNAL", "PUBLIC")).toBe("Reply sent");
  });
});
