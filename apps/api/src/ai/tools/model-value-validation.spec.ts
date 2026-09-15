import { readFileSync } from 'fs';
import { join } from 'path';
import { TicketPriority } from '@prisma/client';
import type { AuthUser } from '../../auth/current-user.decorator';
import type { PrismaService } from '../../prisma/prisma.service';
import type { TicketsService } from '../../tickets/tickets.service';
import { TicketToolsService } from './ticket-tools.service';

const USER = { id: 'u1', email: 'a@b.c' } as AuthUser;

/**
 * Card 1.108 — a cast is not a check.
 *
 * `priority: input.draft.priority as 'SEV1' | ...` is a TypeScript cast. It is
 * erased at runtime and checks nothing, so the model could return any string
 * and it reached the database.
 *
 * ⚠️ AND THE DTO LAYER DOES NOT COVER THIS PATH, WHICH IS THE POINT.
 * `create-ticket.dto.ts` has `@MaxLength(200)` and a priority enum validator,
 * and neither runs here, because `create` is called IN-PROCESS rather than over
 * HTTP. The DTO guards the front door and this comes in through the side —
 * exactly the shape card 1.105 fixed one caller over.
 */
describe('values invented by the model are checked at runtime (card 1.108)', () => {
  const build = () => {
    const created: Record<string, unknown>[] = [];
    const events: Record<string, unknown>[] = [];
    const service = Object.create(TicketToolsService.prototype) as TicketToolsService;
    Object.assign(service, {
      ticketsService: {
        create: (payload: Record<string, unknown>) => {
          created.push(payload);
          return Promise.resolve({ id: 't1', number: 1, displayId: 'IT_1' });
        },
      } as unknown as TicketsService,
      prisma: {
        category: {
          findFirst: ({ where }: { where: { id: string } }) =>
            Promise.resolve(where.id === 'real-category' ? { id: 'real-category' } : null),
        },
        ticketEvent: {
          create: ({ data }: { data: Record<string, unknown> }) => {
            events.push(data);
            return Promise.resolve({});
          },
        },
      } as unknown as PrismaService,
      logger: { error: jest.fn(), warn: jest.fn(), log: jest.fn() },
    });
    return { service, created, events };
  };

  const draft = (over: Record<string, unknown>) => ({
    subject: 'a reasonable subject',
    description: 'body',
    priority: 'SEV2',
    channel: 'PORTAL',
    ...over,
  });

  const coercionEvent = (events: Record<string, unknown>[]) =>
    events.find((e) => e.type === 'AI_VALUE_COERCED') as
      | { payload: { coercions: { field: string; reason: string }[] } }
      | undefined;

  it('⚠️ priority "URGENT" still creates a ticket, at the documented default', async () => {
    // THE REGRESSION ASSERTION. The cast let this reach the database unchecked.
    // It falls back rather than throwing: an unroutable ticket beats a lost one.
    const { service, created, events } = build();
    await service.createTicket(
      { draft: draft({ priority: 'URGENT' }) as never, requesterId: USER.id },
      USER,
    );
    expect(created[0].priority).toBe(TicketPriority.SEV3);
    expect(coercionEvent(events)?.payload.coercions[0].field).toBe('priority');
  });

  it('⚠️ a 400-character model subject creates a ticket with a 200-character one', async () => {
    // Without this a long subject raises Prisma P2000 and discards the whole
    // request - card 1.105's failure by a different road.
    const { service, created, events } = build();
    await service.createTicket(
      { draft: draft({ subject: 'S'.repeat(400) }) as never, requesterId: USER.id },
      USER,
    );
    expect((created[0].subject as string).length).toBe(200);
    expect(coercionEvent(events)?.payload.coercions[0].field).toBe('subject');
  });

  it('⚠️ an invented categoryId is dropped, not fatal', async () => {
    const { service, created, events } = build();
    await service.createTicket(
      { draft: draft({ categoryId: 'category-the-model-made-up' }) as never, requesterId: USER.id },
      USER,
    );
    expect(created[0].categoryId).toBeUndefined();
    expect(coercionEvent(events)?.payload.coercions[0].field).toBe('categoryId');
  });

  it('a real, active category is kept', async () => {
    const { service, created } = build();
    await service.createTicket(
      { draft: draft({ categoryId: 'real-category' }) as never, requesterId: USER.id },
      USER,
    );
    expect(created[0].categoryId).toBe('real-category');
  });

  it('⚠️ a well-formed model response is completely unaffected', async () => {
    // THE NON-VACUITY HALF. Everything above could pass while the ordinary path
    // silently rewrote good values - and no coercion note should appear on a
    // ticket where nothing was corrected.
    const { service, created, events } = build();
    await service.createTicket({ draft: draft({}) as never, requesterId: USER.id }, USER);
    expect(created[0].priority).toBe('SEV2');
    expect(created[0].subject).toBe('a reasonable subject');
    expect(coercionEvent(events)).toBeUndefined();
  });

  it('⚠️ the truncator is REUSED, not rewritten', () => {
    // The card is explicit, and this is the sixteenth chance to write one rule
    // twice. The shared leaf exists so `ai/tools` can use it without importing
    // inbound-email.service.ts, which would close an import cycle (card 1.103).
    const tools = readFileSync(join(__dirname, 'ticket-tools.service.ts'), 'utf8');
    expect(tools).toContain('truncate-ticket-subject.util');
    expect(tools).not.toMatch(/slice\(0,\s*199\)/);
    const inbound = readFileSync(
      join(__dirname, '..', '..', 'tickets', 'inbound-email.service.ts'),
      'utf8',
    );
    expect(inbound).toContain('truncate-ticket-subject.util');
  });

  it('⚠️ the cast is gone from the create call', () => {
    const tools = readFileSync(join(__dirname, 'ticket-tools.service.ts'), 'utf8');
    expect(tools).not.toContain("priority: input.draft.priority as 'SEV1'");
  });
});
