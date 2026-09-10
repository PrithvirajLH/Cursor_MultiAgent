import { describe, expect, it } from "vitest";
import { ApiError } from "./client";
import { isAbortError } from "./is-abort-error";

describe("isAbortError", () => {
  it("recognises the DOMException a real AbortController produces", async () => {
    const controller = new AbortController();
    controller.abort();
    const err = await fetch("https://example.invalid", {
      signal: controller.signal,
    }).catch((caught: unknown) => caught);
    expect(isAbortError(err)).toBe(true);
  });

  it("recognises an AbortError that is a plain Error, not a DOMException", () => {
    const err = new Error("The operation was aborted.");
    err.name = "AbortError";
    expect(isAbortError(err)).toBe(true);
  });

  it("does NOT treat the 30s timeout as a cancellation", () => {
    // fetchWithTimeout aborts on its own deadline and rethrows it as this.
    // It is a real failure and must keep reaching the user.
    expect(isAbortError(new ApiError("Request timed out", 408))).toBe(false);
  });

  it("does not swallow an ordinary failure", () => {
    expect(isAbortError(new ApiError("Request failed", 500))).toBe(false);
    expect(isAbortError(new Error("boom"))).toBe(false);
    expect(isAbortError(new TypeError("Failed to fetch"))).toBe(false);
  });

  it("is safe on non-errors", () => {
    expect(isAbortError(null)).toBe(false);
    expect(isAbortError(undefined)).toBe(false);
    expect(isAbortError("AbortError")).toBe(false);
    expect(isAbortError({ name: "AbortError" })).toBe(false);
  });
});
