import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { OperationsJobRow } from "../../api/client";
import { JobsTable, formatInterval, summarize } from "./JobsTable";

function buildJob(overrides: Partial<OperationsJobRow> = {}): OperationsJobRow {
  return {
    key: "retention",
    label: "Retention",
    description: "Purges soft-deleted and expired records.",
    enabled: false,
    intervalMs: 21_600_000,
    lastRunAt: null,
    lastRunOk: null,
    lastSummary: null,
    nextRunAt: null,
    ...overrides,
  };
}

describe("formatInterval", () => {
  it("reads intervals in the unit that suits them", () => {
    expect(formatInterval(60_000)).toBe("every 1 min");
    expect(formatInterval(300_000)).toBe("every 5 min");
    expect(formatInterval(21_600_000)).toBe("every 6 h");
    expect(formatInterval(30_000)).toBe("every 30s");
  });

  it("says nothing when there is no timer", () => {
    expect(formatInterval(null)).toBe("—");
    expect(formatInterval(0)).toBe("—");
  });
});

describe("summarize", () => {
  it("shows a dash before the first run of this process", () => {
    expect(summarize(buildJob())).toBe("—");
  });

  it("says a dry run deleted nothing", () => {
    expect(
      summarize(
        buildJob({
          lastRunAt: "2026-08-31T10:00:00.000Z",
          lastRunOk: true,
          lastSummary: { dryRun: true, softDeletedTicketsPurged: 0 },
        }),
      ),
    ).toBe("Dry run");
  });

  it("names the counts that are not zero", () => {
    expect(
      summarize(
        buildJob({
          lastRunAt: "2026-08-31T10:00:00.000Z",
          lastRunOk: true,
          lastSummary: { dryRun: false, softDeletedTicketsPurged: 3 },
        }),
      ),
    ).toBe("Soft deleted tickets purged: 3");
  });

  it("says a run that did nothing did nothing, and reports a failure plainly", () => {
    expect(
      summarize(
        buildJob({
          lastRunAt: "2026-08-31T10:00:00.000Z",
          lastRunOk: true,
          lastSummary: { ticketsEnqueued: 0 },
        }),
      ),
    ).toBe("Nothing to do");
    expect(
      summarize(
        buildJob({ lastRunAt: "2026-08-31T10:00:00.000Z", lastRunOk: false }),
      ),
    ).toBe("Failed");
  });

  it('⚠️ names the cause of a failure, not just that there was one', () => {
    // THE ASSERTION THAT FAILS IF THE BUG COMES BACK. Found in card 1.24's
    // browser pass: a failed run rendered a bare "Failed" and discarded the
    // reason the API had already sent. For the inbound mailbox worker that is
    // the difference between "the permission is missing or unscoped" (403)
    // and "the mailbox does not exist yet" (404) - the two outcomes the
    // go-live checklist asks the operator to tell apart.
    expect(
      summarize(
        buildJob({
          lastRunAt: "2026-09-10T10:00:00.000Z",
          lastRunOk: false,
          lastSummary: {
            error: 'Graph GET 404: {"code":"ErrorInvalidUser"}',
          },
        }),
      ),
    ).toBe('Failed: Graph GET 404: {"code":"ErrorInvalidUser"}');
  });

  it('truncates a very long failure rather than filling the row', () => {
    const long = `Graph GET 403: ${'x'.repeat(200)}`;
    const result = summarize(
      buildJob({
        lastRunAt: "2026-09-10T10:00:00.000Z",
        lastRunOk: false,
        lastSummary: { error: long },
      }),
    );
    expect(result.startsWith('Failed: Graph GET 403:')).toBe(true);
    expect(result.endsWith('…')).toBe(true);
    expect(result.length).toBeLessThan(110);
  });

  it('still says plain "Failed" when the worker reported no reason', () => {
    expect(
      summarize(
        buildJob({
          lastRunAt: "2026-09-10T10:00:00.000Z",
          lastRunOk: false,
          lastSummary: { error: '   ' },
        }),
      ),
    ).toBe("Failed");
  });
});

describe("JobsTable", () => {
  it("renders a row per job with its state and a Run now button", () => {
    const html = renderToStaticMarkup(
      <JobsTable
        jobs={[
          buildJob(),
          buildJob({
            key: "automation-scheduler",
            label: "Automation scheduler",
            enabled: true,
            intervalMs: 300_000,
          }),
        ]}
        runningKey={null}
        onRun={() => {}}
      />,
    );
    expect(html).toContain("Retention");
    expect(html).toContain("Automation scheduler");
    expect(html).toContain("Off");
    expect(html).toContain("On");
    expect(html).toContain("every 6 h");
    expect(html).toContain("Run now");
    expect(html).toContain("Not run since the app last restarted");
  });

  it("disables every button and marks the running row while a job runs", () => {
    const html = renderToStaticMarkup(
      <JobsTable jobs={[buildJob()]} runningKey="retention" onRun={() => {}} />,
    );
    expect(html).toContain("Running…");
    expect(html).toContain("disabled");
  });
});
