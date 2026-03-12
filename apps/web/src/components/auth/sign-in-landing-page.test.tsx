import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SignInLandingPage } from "./SignInLandingPage";

describe("sign-in landing page auth errors", () => {
  it("renders a prominent alert with recovery guidance", () => {
    const html = renderToStaticMarkup(
      <SignInLandingPage
        onSignIn={() => {}}
        error="Microsoft authentication is temporarily unavailable."
      />,
    );

    expect(html).toContain('role="alert"');
    expect(html).toContain("Sign-in failed");
    expect(html).toContain("Microsoft authentication is temporarily unavailable.");
    expect(html).toContain(
      "Try signing in again. If the problem continues, contact your administrator.",
    );
  });
});
