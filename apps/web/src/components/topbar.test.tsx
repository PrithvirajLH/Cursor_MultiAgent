import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PROFILE_POPOVER_TITLE, ProfilePopoverPanel, TopBar } from "./TopBar";

describe("profile popover accessibility", () => {
  it("renders the account popover as a dialog instead of a menu", () => {
    const html = renderToStaticMarkup(
      <ProfilePopoverPanel
        titleId="account-popover-title"
        avatarAlt="Ada Lovelace"
        avatarInitials="AL"
        displayName="Ada Lovelace"
        email="ada@example.com"
        profileRows={[
          { label: "Display Name", value: "Ada Lovelace" },
          { label: "Email", value: "ada@example.com" },
        ]}
        onSignOut={() => {}}
      />,
    );

    expect(html).toContain('role="dialog"');
    expect(html).not.toContain('role="menu"');
    expect(html).not.toContain('role="menuitem"');
    expect(html).toContain(PROFILE_POPOVER_TITLE);
    expect(html).toContain("Sign out");
  });
});

describe("top bar navigation affordances", () => {
  it("renders the mobile navigation trigger inside the shared top bar", () => {
    const html = renderToStaticMarkup(
      <TopBar
        title="Dashboard"
        subtitle="Overview"
        currentEmail="ada@example.com"
        onOpenNavigation={() => {}}
      />,
    );

    expect(html).toContain('aria-label="Open navigation"');
    expect(html).toContain("lg:hidden");
  });
});
