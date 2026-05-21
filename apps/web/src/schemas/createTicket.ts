import { z } from "zod";

export const CREATE_TICKET_SUBJECT_MAX = 200;
export const CREATE_TICKET_DESCRIPTION_MAX = 5000;

export const createTicketSchema = z.object({
  subject: z
    .string()
    .min(1, "Subject is required")
    .max(
      CREATE_TICKET_SUBJECT_MAX,
      `Subject must be ${CREATE_TICKET_SUBJECT_MAX} characters or fewer`,
    ),
  description: z
    .string()
    .min(1, "Description is required")
    .max(
      CREATE_TICKET_DESCRIPTION_MAX,
      `Description must be ${CREATE_TICKET_DESCRIPTION_MAX} characters or fewer`,
    ),
  priority: z.enum(["SEV1", "SEV2", "SEV3", "SEV4"]),
  channel: z.enum(["PORTAL", "EMAIL"]),
  assignedTeamId: z.string().min(1, "Department is required"),
  categoryId: z.string(),
});

export type CreateTicketFormData = z.infer<typeof createTicketSchema>;
