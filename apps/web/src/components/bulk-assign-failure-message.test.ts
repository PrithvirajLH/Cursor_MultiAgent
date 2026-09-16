import { describe, expect, it } from "vitest";
import { bulkAssignFailureMessage } from "./BulkActionsToolbar";

const DEACTIVATED =
  "Deactivated Agent (audit) is deactivated. Reactivate the account before assigning work to them.";
const EMPLOYEE =
  "Eli Employee is an employee and cannot be assigned tickets. Assign it to an agent, lead or team admin.";

/**
 * Card 1.110 at the last step — a refusal that says why.
 *
 * ⚠️ THE API WROTE A REASON AND THE UI SHOWED "Unable to assign ticket."
 * Found in a browser pass: assigning a deactivated agent was correctly refused,
 * and the screen said nothing about why. The single-ticket path discarded the
 * error entirely (`catch {}` did not even bind it) and the bulk path ignored
 * `result.errors`, which carries `{ ticketId, message }` per failure.
 *
 * ⚠️ THIS IS THE THIRD TIME THIS SHAPE HAS APPEARED — cards 1.106 and 1.107 on
 * the AI page, this on the ticket page. The API does the careful thing and the
 * web throws the detail away one step from the screen.
 */
describe("what a failed bulk assign tells you (card 1.110)", () => {
  it("⚠️ quotes the reason when every failure agrees", () => {
    // THE REGRESSION ASSERTION.
    expect(
      bulkAssignFailureMessage({
        failed: 3,
        errors: [
          { ticketId: "a", message: DEACTIVATED },
          { ticketId: "b", message: DEACTIVATED },
          { ticketId: "c", message: DEACTIVATED },
        ],
      }),
    ).toBe(DEACTIVATED);
  });

  it("quotes it for a single failure too", () => {
    expect(
      bulkAssignFailureMessage({
        failed: 1,
        errors: [{ ticketId: "a", message: EMPLOYEE }],
      }),
    ).toBe(EMPLOYEE);
  });

  it("⚠️ keeps the count when the failures disagree", () => {
    // One arbitrary reason out of several would misrepresent the batch: the
    // person needs to know two different things went wrong, not one of them.
    expect(
      bulkAssignFailureMessage({
        failed: 2,
        errors: [
          { ticketId: "a", message: DEACTIVATED },
          { ticketId: "b", message: EMPLOYEE },
        ],
      }),
    ).toBe("Unable to assign (2 failed).");
  });

  it("⚠️ falls back cleanly when there are no reasons at all", () => {
    // NON-VACUITY: an older API, or a transport failure, carries no `errors`,
    // and the toolbar must still say something rather than "undefined".
    expect(bulkAssignFailureMessage({ failed: 1 })).toBe(
      "Unable to assign ticket.",
    );
    expect(bulkAssignFailureMessage({ failed: 4, errors: [] })).toBe(
      "Unable to assign (4 failed).",
    );
  });
});
