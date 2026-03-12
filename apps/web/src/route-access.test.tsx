import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";
import {
  AccessDeniedRedirect,
  UNAUTHORIZED_ROUTE_MESSAGE,
  guardRoute,
} from "./route-access";

describe("route access helpers", () => {
  it("returns the original element when access is allowed", () => {
    const allowed = <div data-testid="allowed-route" />;

    expect(guardRoute(true, allowed)).toBe(allowed);
  });

  it("wraps denied routes in an access-denied redirect", () => {
    const denied = guardRoute(
      false,
      <div />,
      "/sla-settings",
    ) as ReactElement<{ to?: string }>;

    expect(denied.type).toBe(AccessDeniedRedirect);
    expect(denied.props.to).toBe("/sla-settings");
  });

  it("uses a user-facing unauthorized access message", () => {
    expect(UNAUTHORIZED_ROUTE_MESSAGE).toBe(
      "You do not have permission to access this page.",
    );
  });
});
