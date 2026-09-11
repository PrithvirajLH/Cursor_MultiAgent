import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AvailabilityControl } from "./AvailabilityControl";
import { ProfilePopoverPanel } from "./TopBar";

const noop = () => {};

function render(
  props: Partial<Parameters<typeof AvailabilityControl>[0]> = {},
) {
  return renderToStaticMarkup(
    <AvailabilityControl
      state={{ isAvailable: true, awayUntil: null }}
      loading={false}
      busy={false}
      error={null}
      backOn=""
      onBackOnChange={noop}
      onGoAway={noop}
      onComeBack={noop}
      openTickets={null}
      onReassign={noop}
      reassigned={null}
      {...props}
    />,
  );
}

describe("availability control (card 2.2)", () => {
  it("offers to go away when here", () => {
    const html = render();
    expect(html).toContain("Available");
    expect(html).toContain("Set me away");
    expect(html).toContain('type="date"');
    expect(html).not.toContain("back</button>");
  });

  it("offers to come back when away", () => {
    const html = render({
      state: { isAvailable: false, awayUntil: "2099-01-01T00:00:00.000Z" },
    });
    expect(html).toMatch(/Away until/);
    expect(html).toMatch(/m back<\/button>/);
    expect(html).not.toContain("Set me away");
  });

  it("⚠️ says the person is available once their return date has passed", () => {
    // The stored flag still reads away. Assignment already treats them as back,
    // so a menu that said otherwise would be lying about live behaviour.
    const html = render({
      state: { isAvailable: false, awayUntil: "2020-01-01T00:00:00.000Z" },
    });
    expect(html).toContain("Available");
    expect(html).toContain("Set me away");
  });

  it("⚠️ offers to hand over open tickets, with the number, once away", () => {
    const html = render({
      state: { isAvailable: false, awayUntil: null },
      openTickets: { count: 3, truncated: false },
    });
    expect(html).toContain("You have 3 open tickets. Hand them to the queue");
  });

  it("⚠️ does NOT offer the hand-over while the person is still here", () => {
    // The non-vacuity half: an unconditional offer would pass the test above.
    const html = render({
      state: { isAvailable: true, awayUntil: null },
      openTickets: { count: 3, truncated: false },
    });
    expect(html).not.toContain("Hand them to the queue");
  });

  it("says so when there is nothing to hand over", () => {
    const html = render({
      state: { isAvailable: false, awayUntil: null },
      openTickets: { count: 0, truncated: false },
    });
    expect(html).toContain("Nothing open is assigned to you");
  });

  it("reports what was handed over afterwards", () => {
    const html = render({
      state: { isAvailable: false, awayUntil: null },
      openTickets: { count: 0, truncated: false },
      reassigned: 4,
    });
    expect(html).toContain("4 tickets are back in their teams");
  });

  it("⚠️ refuses a past return date in the browser, before the server does", () => {
    const html = render({ backOn: "2020-01-01" });
    expect(html).toContain("Pick a date in the future");
    expect(html).toContain("disabled");
  });

  it("accepts a usable future date without complaint", () => {
    const html = render({ backOn: "2099-01-01" });
    expect(html).not.toContain("Pick a date in the future");
  });

  it("says it is still loading rather than guessing a state", () => {
    const html = render({ state: null, loading: true });
    expect(html).toContain("Checking availability");
    expect(html).not.toContain("Set me away");
  });

  it("shows an error where the action was", () => {
    const html = render({ error: "Server error. Please try again later." });
    expect(html).toContain("Server error. Please try again later.");
  });
});

describe("the avatar menu carries the control (card 2.2)", () => {
  const panel = (availability?: React.ReactNode) =>
    renderToStaticMarkup(
      <ProfilePopoverPanel
        titleId="account-popover-title"
        avatarAlt="Ada Lovelace"
        avatarInitials="AL"
        displayName="Ada Lovelace"
        email="ada@example.com"
        profileRows={[{ label: "Email", value: "ada@example.com" }]}
        availability={availability}
        onSignOut={noop}
      />,
    );

  it("renders the availability slot when given one", () => {
    const html = panel(<p>availability goes here</p>);
    expect(html).toContain("availability goes here");
    expect(html).toContain("Sign out");
  });

  it("⚠️ renders nothing extra for a requester, who is in no rotation", () => {
    const html = panel(undefined);
    expect(html).not.toContain("availability goes here");
    expect(html).toContain("Sign out");
  });
});
