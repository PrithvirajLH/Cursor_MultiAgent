import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AiErrorPanel, errorReferenceFrom } from "./AiSubmitPage";
import type { AiClassifyResult } from "../api/client";

const GENERIC =
  "The AI could not process this request. Please try again, or contact the service desk with the reference below.";

/** What a real Azure SDK failure says, and every part of it is sensitive. */
const AZURE_DETAIL =
  "404 Resource not found: https://example-foundry.openai.azure.com/openai/deployments/gpt-5-4-mini-prod/chat/completions (quota tier S0)";

/**
 * Card 1.107 at the last step — what the caller actually sees.
 *
 * ⚠️ THE MESSAGE PROMISED A REFERENCE AND THE PAGE SHOWED NONE. The API sends
 * `correlationId`, the generic sentence ends "contact the service desk with the
 * reference below", and `client.ts` hand-writes its own copy of the response
 * type — which did not have the field. So the id never reached the UI and the
 * sentence pointed at nothing. Found by a browser pass, not by a test.
 *
 * ⚠️ A promise of a reference that is not there is worse than no promise: it
 * sends somebody to the service desk to quote something they cannot find.
 */
describe("the AI submit page when the pipeline fails (card 1.107)", () => {
  it("⚠️ shows the reference the message tells people to quote", () => {
    // THE REGRESSION ASSERTION.
    const html = renderToStaticMarkup(
      <AiErrorPanel message={GENERIC} reference="22190c9c-00f2-49c2-bb70-fa74f26855bf" />,
    );
    expect(html).toContain("Reference:");
    expect(html).toContain("22190c9c-00f2-49c2-bb70-fa74f26855bf");
  });

  it("⚠️ the page actually passes the id the API sent", () => {
    // THE WIRING, AND THIS IS THE ASSERTION THAT WAS MISSING. Rendering the
    // panel with a reference prop proves the panel renders it and proves
    // nothing about whether the page ever supplies one - deleting the wiring
    // left the panel tests green, which is how this gap was found.
    const failed: AiClassifyResult = {
      status: "error",
      error: GENERIC,
      step: "intent_extraction",
      correlationId: "647d2980-cb86-4cbe-8e04-63b88bd2d179",
    };
    expect(errorReferenceFrom(failed)).toBe(
      "647d2980-cb86-4cbe-8e04-63b88bd2d179",
    );
  });

  it("an error with no correlation id yields null, not undefined", () => {
    const failed: AiClassifyResult = {
      status: "error",
      error: GENERIC,
      step: "intent_extraction",
    };
    expect(errorReferenceFrom(failed)).toBeNull();
  });

  it("⚠️ a disabled result carries no reference", () => {
    // NON-VACUITY: switched off is not a failure and has no request id worth
    // quoting to anybody.
    const off: AiClassifyResult = {
      status: "disabled",
      reason: "The AI pipeline is switched off.",
    };
    expect(errorReferenceFrom(off)).toBeNull();
  });

  it("⚠️ shows no empty Reference label when there is no id", () => {
    // A transport failure never reached the API, so there is no request id to
    // quote. The label must not appear above nothing - the same defect in
    // miniature.
    const html = renderToStaticMarkup(
      <AiErrorPanel message="Pipeline failed" reference={null} />,
    );
    expect(html).not.toContain("Reference:");
  });

  it("⚠️ renders only what it is given, never infrastructure detail", () => {
    // The panel cannot leak on its own - it has no access to the raw error -
    // but this pins the contract: whatever the API decides to send is all that
    // is rendered, and the API sends the generic sentence.
    const html = renderToStaticMarkup(
      <AiErrorPanel message={GENERIC} reference="abc-123" />,
    );
    expect(html).not.toContain("openai.azure.com");
    expect(html).not.toContain("gpt-5-4-mini-prod");
    expect(html).not.toContain(AZURE_DETAIL);
  });
});
