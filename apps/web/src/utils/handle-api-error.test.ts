import { describe, expect, it } from "vitest";
import { ApiError } from "../api/client";
import { handleApiError } from "./handleApiError";

/** How the API really answers: the body arrives as the error's message. */
function refusal(status: number, message: string | string[]): ApiError {
  return new ApiError(JSON.stringify({ statusCode: status, message }), status);
}

/**
 * Card 1.132 — a refusal the server wrote for a person must reach that person.
 *
 * ⚠️ THE CARD ASSUMED THIS HELPER ALREADY QUOTED EVERY 4xx. It did not: 403
 * returned a fixed sentence and discarded the body, so wiring `handleApiError`
 * into the add-member path would have swapped one generic message for another
 * and the owner would still not have learned why.
 */
describe("handleApiError quotes a deliberate refusal (card 1.132)", () => {
  const OWNER_REFUSAL =
    "Owners already have access to every team and cannot be added as a member. " +
    "To give someone a team, set their role to team admin, lead or agent first.";

  it("⚠️ a 403 carrying a sentence shows that sentence", () => {
    // THE ASSERTION THIS CARD EXISTS FOR. This is the exact body
    // `teams.service.ts:430` sends and `teams.spec.ts:282` asserts on.
    expect(handleApiError(refusal(403, OWNER_REFUSAL))).toBe(OWNER_REFUSAL);
  });

  it("a 403 from the roles guard still shows our own wording", () => {
    // NON-VACUITY. Nest's bare `ForbiddenException()` bodies say "Forbidden"
    // and the guard's say "Forbidden resource" - neither tells anyone
    // anything, so quoting them would be a regression, not a fix.
    for (const nestDefault of ["Forbidden", "Forbidden resource"]) {
      expect(handleApiError(refusal(403, nestDefault))).toBe(
        "You do not have permission to perform this action.",
      );
    }
  });

  it("a 403 with no body at all still shows our own wording", () => {
    expect(handleApiError(new ApiError("", 403))).toBe(
      "You do not have permission to perform this action.",
    );
  });

  it("⚠️ a 404 is still concealed, and that asymmetry is deliberate", () => {
    // THE SAFETY LINE. This codebase hides a record's EXISTENCE with 404, never
    // with 403 - `listMessages` says so outright. Quoting a 404 body would undo
    // that concealment, so 404 keeps its fixed sentence.
    expect(handleApiError(refusal(404, "Ticket not found"))).toBe(
      "The requested resource was not found.",
    );
  });

  it("⚠️ a 500 is never quoted", () => {
    // Card 1.107's line, held: a deliberate refusal is quoted, an internal
    // failure is not. An Azure stack trace is not for a requester to read.
    expect(
      handleApiError(
        refusal(500, "connect ECONNREFUSED 10.0.0.4:5432 at PrismaClient"),
      ),
    ).toBe("Server error. Please try again later.");
  });

  it("a 400 still shows the server's sentence, as it always did", () => {
    // The deactivated-user refusal is a 400 (`deactivation.spec.ts:133`), so
    // this is the path that already worked and must keep working.
    expect(
      handleApiError(
        refusal(400, "This account is deactivated; adding them to a team"),
      ),
    ).toContain("deactivated");
  });

  it("joins the list class-validator sends", () => {
    expect(
      handleApiError(refusal(400, ["userId must be a UUID", "role is invalid"])),
    ).toBe("userId must be a UUID. role is invalid");
  });

  it("a body that is not JSON falls back to the raw text", () => {
    expect(handleApiError(new ApiError("upstream timeout", 400))).toBe(
      "upstream timeout",
    );
  });

  it("an empty non-ApiError message never renders as a blank screen", () => {
    expect(handleApiError(new ApiError("", 400))).toBe(
      "An unexpected error occurred.",
    );
  });
});
