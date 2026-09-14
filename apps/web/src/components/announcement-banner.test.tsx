import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import type { ActiveAnnouncement } from "../api/client";
import { AnnouncementBannerView } from "./AnnouncementBanner";
import {
  canDismissPermanently,
  visibleAnnouncements,
} from "../utils/announcement-dismissal";

const noop = () => {};

function make(
  id: string,
  severity: ActiveAnnouncement["severity"],
  title = id,
): ActiveAnnouncement {
  return {
    id,
    title,
    body: `${id} body`,
    severity,
    linkedTicketId: null,
    endsAt: null,
  };
}

function render(
  announcements: ActiveAnnouncement[],
  collapsedIds: string[] = [],
) {
  return renderToStaticMarkup(
    <MemoryRouter>
      <AnnouncementBannerView
        announcements={announcements}
        collapsedIds={collapsedIds}
        onDismiss={noop}
        onToggleCollapse={noop}
      />
    </MemoryRouter>,
  );
}

describe("announcement banner (card 2.7)", () => {
  it("⚠️ renders NOTHING when there is nothing active", () => {
    // The state the app is in almost all of the time: no empty bar, no
    // wrapper, no gap in the layout.
    expect(render([])).toBe("");
  });

  it("renders an active announcement", () => {
    const html = render([make("a1", "OUTAGE", "VPN is down")]);
    expect(html).toContain("VPN is down");
    expect(html).toContain("a1 body");
  });

  it("⚠️ an outage offers COLLAPSE, never a permanent dismiss", () => {
    // The owner's decision: a banner cleared at 9am does not stop duplicate
    // tickets at 2pm.
    const html = render([make("a1", "OUTAGE")]);
    expect(html).toContain("Collapse: a1");
    expect(html).not.toContain("Dismiss: a1");
  });

  it("⚠️ an info notice offers a dismiss", () => {
    // The discriminating half: if both rendered the same control, the test
    // above would pass with the rule inverted.
    const html = render([make("a1", "INFO")]);
    expect(html).toContain("Dismiss: a1");
    expect(html).not.toContain("Collapse: a1");
  });

  it("a collapsed outage keeps its title and drops its body", () => {
    const html = render([make("a1", "OUTAGE", "Still broken")], ["a1"]);
    expect(html).toContain("Still broken");
    expect(html).not.toContain("a1 body");
    expect(html).toContain("Expand: Still broken");
  });

  it("renders several at once, loudest treatment intact", () => {
    const html = render([make("a1", "OUTAGE"), make("a2", "INFO")]);
    expect(html).toContain("Collapse: a1");
    expect(html).toContain("Dismiss: a2");
  });

  it("links to the ticket tracking it when there is one", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <AnnouncementBannerView
          announcements={[{ ...make("a1", "OUTAGE"), linkedTicketId: "IT-0042" }]}
          collapsedIds={[]}
          onDismiss={noop}
          onToggleCollapse={noop}
        />
      </MemoryRouter>,
    );
    expect(html).toContain('href="/tickets/IT-0042"');
  });

  it("announces itself politely to a screen reader", () => {
    const html = render([make("a1", "OUTAGE")]);
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
  });
});

describe("dismissal rules (card 2.7)", () => {
  it("⚠️ dismissing one does not dismiss another", () => {
    const rows = [make("a1", "INFO"), make("a2", "INFO")];
    const left = visibleAnnouncements(rows, ["a1"]);
    expect(left.map((r) => r.id)).toEqual(["a2"]);
  });

  it("⚠️ a dismissed id cannot hide an OUTAGE", () => {
    // An announcement edited up to OUTAGE after somebody dismissed it must
    // come back, or it stays invisible to exactly the people who need it.
    const rows = [make("a1", "OUTAGE")];
    expect(visibleAnnouncements(rows, ["a1"]).map((r) => r.id)).toEqual(["a1"]);
  });

  it("says which severities may be dismissed for good", () => {
    expect(canDismissPermanently("INFO")).toBe(true);
    expect(canDismissPermanently("WARNING")).toBe(true);
    expect(canDismissPermanently("OUTAGE")).toBe(false);
  });
});

describe("⚠️ how the banner loads (card 2.7, regression)", () => {
  // The browser pass caught this: the banner stayed empty on every route while
  // the endpoint returned the outage correctly to curl. `apiFetch`
  // de-duplicates in-flight GETs by path and hands the second caller the first
  // one's promise, ignoring their signal - so mount -> abort -> mount (React
  // StrictMode, or any remount) made the second load inherit an AbortError.
  const source = readFileSync(
    join(__dirname, "AnnouncementBanner.tsx"),
    "utf8",
  ).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  it("⚠️ does not abort its own load", () => {
    expect(source).not.toMatch(/new AbortController/);
    expect(source).not.toMatch(/\.abort\(\)/);
  });

  it("drops a late response instead, with a cancelled flag", () => {
    expect(source).toMatch(/let cancelled = false/);
    expect(source).toMatch(/if \(!cancelled\)/);
  });
});
