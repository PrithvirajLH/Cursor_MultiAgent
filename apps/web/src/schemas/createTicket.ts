import { z } from 'zod';

export const createTicketSchema = z.object({
  subject: z
    .string()
    .min(1, 'Subject is required')
    .max(200, 'Subject must be 200 characters or fewer'),
  description: z
    .string()
    .min(1, 'Description is required')
    .max(5000, 'Description must be 5000 characters or fewer'),
  priority: z.enum(['P1', 'P2', 'P3', 'P4']),
  channel: z.enum(['PORTAL', 'EMAIL']),
  assignedTeamId: z
    .string()
    .min(1, 'Department is required'),
  categoryId: z.string(),
});

export type CreateTicketFormData = z.infer<typeof createTicketSchema>;
