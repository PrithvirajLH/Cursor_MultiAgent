/**
 * Agent 4: Ticket Generator
 *
 * Produces a fully structured ticket and saves it to the database.
 * Final step in the pipeline — synthesizes all previous agent outputs
 * into a concrete, actionable ticket.
 */

export const systemPrompt = `You are a ticket generation specialist for an enterprise service desk.

Your job is to take the analyzed intent and classification from previous pipeline steps and produce a clean, structured ticket that agents can act on immediately.

## Ticket Subject Rules

- Maximum 100 characters (will be truncated at 255 but aim for brevity).
- Start with an action verb or clear noun phrase.
- Include the affected system if known.
- No redundant words like "Request:" or "Issue:" prefixes.

Good: "Cannot access SAP — deadline tomorrow"
Good: "New laptop provisioning for John Smith"
Bad: "Request: User is having trouble with their computer and needs help"

## Ticket Description Rules

Structure the description for the receiving agent:
1. **What**: One-sentence summary of the issue or request.
2. **Who**: Requester name, department, location (if known).
3. **Context**: Relevant details extracted from the original message.
4. **Urgency**: Why this is time-sensitive (if applicable).
5. **Original message**: Include the raw text at the bottom for reference.

## Priority Mapping

Use the suggestedPriority from classification, but validate:
- P1: Only if there are strong urgency signals AND wide impact (production down, security breach, many users affected)
- P2: Urgency signals present but limited impact, or deadline within 24 hours
- P3: Standard requests with no urgency signals
- P4: Informational, no time pressure, "when you get a chance"

## Display ID Generation

Generate a display ID in the format: {TEAM_SLUG}-{NUMBER}
- Use the team slug (uppercase) as prefix
- The number will be auto-assigned, so use "NEXT" as placeholder: e.g., "IT-NEXT"
- The actual number will be set by the system after creation.

## Process

1. Synthesize all inputs into a ticket draft.
2. Call **create_ticket** to save the ticket to the database.
3. Call **create_sla_instance** to set up SLA tracking for the new ticket.
4. Return the complete ticket information.

## Output Format

After creating the ticket and SLA instance, return a JSON object:
{
  "subject": "string",
  "description": "string",
  "priority": "P1" | "P2" | "P3" | "P4",
  "channel": "PORTAL" | "EMAIL",
  "assignedTeamId": "string",
  "categoryId": "string | null",
  "displayId": "string",
  "tags": ["string"]
}`;

export const toolDefinitions = [
  {
    type: 'function' as const,
    function: {
      name: 'create_ticket',
      description:
        'Creates a new ticket in the database with the specified fields. Returns the created ticket with its auto-generated ID and number.',
      parameters: {
        type: 'object',
        properties: {
          draft: {
            type: 'object',
            description: 'The ticket draft to create',
            properties: {
              subject: {
                type: 'string',
                description: 'Ticket subject line (max 255 chars)',
              },
              description: {
                type: 'string',
                description: 'Structured ticket description',
              },
              priority: {
                type: 'string',
                enum: ['P1', 'P2', 'P3', 'P4'],
                description: 'Ticket priority',
              },
              channel: {
                type: 'string',
                enum: ['PORTAL', 'EMAIL'],
                description: 'Channel the request came through',
              },
              assignedTeamId: {
                type: 'string',
                description: 'ID of the team to assign the ticket to',
              },
              categoryId: {
                type: 'string',
                nullable: true,
                description: 'ID of the category, or null',
              },
              displayId: {
                type: 'string',
                description: 'Human-readable ticket ID (e.g., IT-0007)',
              },
              tags: {
                type: 'array',
                items: { type: 'string' },
                description: 'Tags extracted from the request',
              },
            },
            required: [
              'subject',
              'description',
              'priority',
              'channel',
              'assignedTeamId',
              'displayId',
              'tags',
            ],
          },
          requesterId: {
            type: 'string',
            description: 'ID of the user who submitted the request',
          },
        },
        required: ['draft', 'requesterId'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'create_sla_instance',
      description:
        'Creates an SLA tracking instance for a ticket based on the default SLA policy and the ticket priority.',
      parameters: {
        type: 'object',
        properties: {
          ticketId: {
            type: 'string',
            description: 'ID of the ticket to create SLA tracking for',
          },
          priority: {
            type: 'string',
            enum: ['P1', 'P2', 'P3', 'P4'],
            description: 'Priority level to determine SLA targets',
          },
        },
        required: ['ticketId', 'priority'],
      },
    },
  },
];
