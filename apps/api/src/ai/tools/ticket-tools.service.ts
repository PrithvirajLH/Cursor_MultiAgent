import { truncateTicketSubject } from '../../common/truncate-ticket-subject.util';
import { Injectable, Logger } from '@nestjs/common';
import { Prisma, TicketPriority } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { TicketsService } from '../../tickets/tickets.service';
import type { ToolResult, TicketDraft, AiAnalysis } from '../types/pipeline.types';
import type { AuthUser } from '../../auth/current-user.decorator';

interface CreateTicketInput {
  draft: TicketDraft;
  requesterId: string;
  rawText?: string;
  aiAnalysis?: AiAnalysis;
}

@Injectable()
export class TicketToolsService {
  private readonly logger = new Logger(TicketToolsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ticketsService: TicketsService,
  ) {}

  /**
   * Creates a ticket by delegating to the existing TicketsService.create(),
   * which handles display ID generation, SLA, events, notifications, automation, etc.
   * After creation, logs an AI_CLASSIFICATION event with the analysis data.
   */
  async createTicket(
    input: CreateTicketInput,
    user: AuthUser,
  ): Promise<ToolResult<{ id: string; number: number; displayId: string | null }>> {
    try {
      // Use the user's original message verbatim as the ticket description.
      // The AI's structured "What/Who/Context" rewrite is still persisted in
      // the AI_CLASSIFICATION event below and surfaced in the AI panel.
      const descriptionText =
        input.rawText?.trim() || input.draft.description;

      // ⚠️ CARD 1.108: EVERY VALUE BELOW CAME FROM A LANGUAGE MODEL.
      //
      // `priority` was `input.draft.priority as 'SEV1' | ...`, which is a
      // TypeScript cast - erased at runtime, checking nothing. The model can
      // return any string and it reached the database. `subject` had no length
      // check against a VarChar(200) column, so a long one raised P2000 and
      // discarded the whole request - the exact failure card 1.105 exists to
      // prevent, arriving by a different road. `categoryId` was never checked
      // to exist.
      //
      // ⚠️ AND THE DTO LAYER DOES NOT COVER THIS PATH, WHICH IS THE POINT.
      // `create-ticket.dto.ts` has @MaxLength(200) and a priority enum
      // validator, and neither runs here, because `create` is called in-process
      // rather than over HTTP. The DTO guards the front door; this comes in
      // through the side.
      const coercions: { field: string; from: string; to: string; reason: string }[] = [];
      const priority = this.coercePriority(input.draft.priority, coercions);
      const subject = this.coerceSubject(input.draft.subject, coercions);
      const categoryId = await this.coerceCategoryId(
        input.draft.categoryId ?? undefined,
        coercions,
      );

      const ticket = await this.ticketsService.create(
        {
          subject,
          description: descriptionText,
          priority,
          channel: input.draft.channel === 'EMAIL' ? 'EMAIL' : 'PORTAL',
          assignedTeamId: input.draft.assignedTeamId ?? undefined,
          categoryId,
          tags: input.draft.tags ?? undefined,
        },
        user,
        { skipRequiredCustomFields: true, tagSource: 'AI' },
      );

      // ⚠️ RECORD WHAT WAS CORRECTED. A silently fixed value is invisible, and
      // without this nobody can ever tell how often the model is wrong - which
      // is the number that decides whether the confidence threshold is right.
      // Same pattern as card 1.105's dropped-attachment event.
      await this.recordModelCoercions(ticket.id, user.id, coercions);

      // Log AI classification event with analysis data
      if (input.aiAnalysis) {
        await this.prisma.ticketEvent.create({
          data: {
            ticketId: ticket.id,
            type: 'AI_CLASSIFICATION',
            payload: JSON.parse(JSON.stringify({
              source: 'ai_pipeline',
              tags: input.draft.tags,
              rawText: input.rawText ?? null,
              aiAnalysis: input.aiAnalysis,
            })) as Prisma.InputJsonValue,
            createdById: user.id,
          },
        });
      }

      return {
        success: true,
        data: {
          id: ticket.id,
          number: ticket.number,
          displayId: ticket.displayId,
        },
      };
    } catch (error) {
      this.logger.error('Failed to create ticket via AI pipeline', error);
      return {
        success: false,
        error: `Failed to create ticket: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  /**
   * Creates an SLA instance for a ticket. In our system, SLA is already
   * created by TicketsService.create(), so this is a no-op that returns
   * the existing SLA instance if one exists. Exposed for MCP server compatibility.
   */
  /**
   * The model's priority, checked at runtime rather than cast (card 1.108).
   *
   * ⚠️ FALLS BACK, DOES NOT THROW. An unroutable ticket is better than a lost
   * one - card 1.105's principle, same reasoning. SEV3 is the documented
   * default and matches what inbound email uses when a sender states nothing.
   */
  private coercePriority(
    value: unknown,
    coercions: { field: string; from: string; to: string; reason: string }[],
  ): TicketPriority {
    const candidate = typeof value === 'string' ? value.trim().toUpperCase() : '';
    if ((Object.values(TicketPriority) as string[]).includes(candidate)) {
      return candidate as TicketPriority;
    }
    coercions.push({
      field: 'priority',
      from: String(value ?? ''),
      to: TicketPriority.SEV3,
      reason: 'not one of SEV1-SEV4',
    });
    return TicketPriority.SEV3;
  }

  /** The model's subject, fitted to the column rather than allowed to break it. */
  private coerceSubject(
    value: string,
    coercions: { field: string; from: string; to: string; reason: string }[],
  ): string {
    const fitted = truncateTicketSubject(value ?? '');
    if (fitted !== (value ?? '').trim()) {
      coercions.push({
        field: 'subject',
        from: `${(value ?? '').length} characters`,
        to: `${fitted.length} characters`,
        reason: 'longer than the 200-character column',
      });
    }
    return fitted;
  }

  /**
   * The model's category, verified to exist and be active (card 1.108).
   *
   * Follows `resolveTeamId`'s precedent, which already requires `isActive`.
   * An invented id is dropped rather than failing the ticket.
   */
  private async coerceCategoryId(
    value: string | undefined,
    coercions: { field: string; from: string; to: string; reason: string }[],
  ): Promise<string | undefined> {
    if (!value) {
      return undefined;
    }
    const found = await this.prisma.category.findFirst({
      where: { id: value, isActive: true },
      select: { id: true },
    });
    if (found) {
      return found.id;
    }
    coercions.push({
      field: 'categoryId',
      from: value,
      to: '(none)',
      reason: 'no active category with that id',
    });
    return undefined;
  }

  /** Say on the ticket that the model's answer needed correcting. */
  private async recordModelCoercions(
    ticketId: string,
    actorId: string,
    coercions: { field: string; from: string; to: string; reason: string }[],
  ): Promise<void> {
    if (coercions.length === 0) {
      return;
    }
    try {
      await this.prisma.ticketEvent.create({
        data: {
          ticketId,
          type: 'AI_VALUE_COERCED',
          payload: { count: coercions.length, coercions },
          createdById: actorId,
        },
      });
    } catch {
      // Never fail ticket creation over a note about it.
    }
  }

  async createSlaInstance(
    ticketId: string,
    _priority: 'SEV1' | 'SEV2' | 'SEV3' | 'SEV4',
  ): Promise<ToolResult<{ id: string }>> {
    try {
      const sla = await this.prisma.slaInstance.findFirst({
        where: { ticketId },
        select: { id: true },
      });

      if (sla) {
        return { success: true, data: { id: sla.id } };
      }

      // SLA should already exist from TicketsService.create() — return success
      return { success: true, data: { id: 'sla-created-by-ticket-service' } };
    } catch (error) {
      return {
        success: false,
        error: `Failed to find SLA instance: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }
}
