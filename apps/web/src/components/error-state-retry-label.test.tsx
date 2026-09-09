import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ErrorState } from "./ErrorState";

/**
 * Card 1.54 — an expired session must not be offered a Retry button.
 */
describe("ErrorState retry label", () => {
  it("⚠️ can say something other than Retry, for a failure retrying cannot fix", () => {
    // THE ASSERTION THAT FAILS IF THE BUG COMES BACK. The owner's screen said
    // "Unable to load tickets" with a Retry button, against a session that had
    // ended. Clicking it 401s again, every time - which is what "this happens
    // frequently" looked like from the outside.
    const html = renderToStaticMarkup(
      <ErrorState
        title="Your session expired"
        description="You have been signed out."
        onRetry={() => {}}
        retryLabel="Sign in again"
      />,
    );
    expect(html).toContain("Sign in again");
    expect(html).not.toContain(">Retry<");
    expect(html).toContain("Your session expired");
  });

  it("still says Retry by default, so every other caller is unchanged", () => {
    const html = renderToStaticMarkup(
      <ErrorState title="Unable to load tickets" onRetry={() => {}} />,
    );
    expect(html).toContain(">Retry<");
  });
});
