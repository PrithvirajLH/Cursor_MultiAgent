import { describe, expect, it } from "vitest";
import {
  CREATE_TICKET_DESCRIPTION_MAX,
  CREATE_TICKET_SUBJECT_MAX,
  createTicketSchema,
} from "./createTicket";

describe("createTicketSchema", () => {
  it("accepts a payload at max limits", () => {
    const result = createTicketSchema.safeParse({
      subject: "S".repeat(CREATE_TICKET_SUBJECT_MAX),
      description: "D".repeat(CREATE_TICKET_DESCRIPTION_MAX),
      priority: "P3",
      channel: "PORTAL",
      assignedTeamId: "team-id",
      categoryId: "",
    });

    expect(result.success).toBe(true);
  });

  it("rejects payloads above max limits", () => {
    const result = createTicketSchema.safeParse({
      subject: "S".repeat(CREATE_TICKET_SUBJECT_MAX + 1),
      description: "D".repeat(CREATE_TICKET_DESCRIPTION_MAX + 1),
      priority: "P3",
      channel: "PORTAL",
      assignedTeamId: "team-id",
      categoryId: "",
    });

    expect(result.success).toBe(false);
  });
});
