import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { AI_DISABLED_TITLE, AiDisabledPanel } from "./AiSubmitPage";

const render = (reason: string) =>
  renderToStaticMarkup(
    <MemoryRouter>
      <AiDisabledPanel reason={reason} />
    </MemoryRouter>,
  );

/**
 * Card 1.106, the half a browser pass was meant to find.
 *
 * ⚠️ THE API GAINED A `disabled` STATUS AND THE WEB DID NOT KNOW IT EXISTED.
 * `AiSubmitPage` routed anything that was not `created` or
 * `needs_clarification` into one `else` that read `response.error`, and the
 * disabled state has no `error` field — it has `reason`. So switching the AI
 * off rendered "Something went wrong" above an EMPTY message: the exact
 * confusion between "somebody turned this off" and "this is broken" that card
 * 1.106 exists to remove.
 *
 * ⚠️ AND TYPESCRIPT COULD NOT HAVE CAUGHT IT. `client.ts` hand-writes these
 * interfaces rather than sharing the API's, so the union simply did not contain
 * the new state. Adding it turned the missing branch into a compile error — and
 * immediately found a SECOND site, where `status !== "error"` was standing in
 * for "has suggested articles".
 */
describe("the AI submit page when the pipeline is switched off (card 1.106)", () => {
  it("⚠️ says it is switched off, not that something went wrong", () => {
    // THE REGRESSION ASSERTION.
    const html = render("The AI pipeline is switched off.");
    expect(html).toContain(AI_DISABLED_TITLE);
    expect(html).not.toContain("Something went wrong");
  });

  it("shows the reason the API gave", () => {
    const html = render("The AI pipeline is switched off.");
    expect(html).toContain("The AI pipeline is switched off.");
  });

  it("⚠️ offers the ordinary ticket form as the way out", () => {
    // NOT a "Try Again" button: retrying cannot help while the switch is off,
    // and it would send people round a loop.
    const html = render("off");
    expect(html).toContain('href="/tickets/new"');
    expect(html).not.toContain("Try Again");
  });

  it("⚠️ never renders an empty message", () => {
    // The actual symptom of the bug: the title appeared above nothing at all,
    // because `response.error` was undefined on this shape.
    const html = render("");
    expect(html).toContain("You can still raise a ticket the normal way");
  });
});
