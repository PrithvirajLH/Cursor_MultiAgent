import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ListFreshnessNotice } from "./ListFreshnessNotice";

const LAST_UPDATED = "2026-09-01T16:42:00.000Z";

describe("ListFreshnessNotice", () => {
  it("renders nothing at all while the socket is connected", () => {
    const html = renderToStaticMarkup(
      <ListFreshnessNotice connected lastUpdatedAt={LAST_UPDATED} />,
    );
    expect(html).toBe("");
  });

  it("says it is reconnecting, with the time the list was last loaded", () => {
    const html = renderToStaticMarkup(
      <ListFreshnessNotice connected={false} lastUpdatedAt={LAST_UPDATED} />,
    );
    expect(html).toContain("Reconnecting");
    expect(html).toContain("list last updated");
    const expectedTime = new Date(LAST_UPDATED).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
    expect(html).toContain(expectedTime);
  });

  it("still says something sensible before the first load", () => {
    const html = renderToStaticMarkup(
      <ListFreshnessNotice connected={false} lastUpdatedAt={null} />,
    );
    expect(html).toContain("Reconnecting");
    expect(html).toContain("list may be out of date");
    expect(html).not.toContain("undefined");
    expect(html).not.toContain("null");
  });

  it("does not print Invalid Date when the timestamp is unusable", () => {
    const html = renderToStaticMarkup(
      <ListFreshnessNotice connected={false} lastUpdatedAt="not-a-date" />,
    );
    expect(html).not.toContain("Invalid Date");
    expect(html).toContain("list may be out of date");
  });

  it("is announced to screen readers without stealing focus", () => {
    const html = renderToStaticMarkup(
      <ListFreshnessNotice connected={false} lastUpdatedAt={LAST_UPDATED} />,
    );
    expect(html).toContain('role="status"');
  });
});
