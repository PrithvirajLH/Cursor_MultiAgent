import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
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
      const ticket = await this.ticketsService.create(
        {
          subject: input.draft.subject,
          description: input.draft.description,
          priority: input.draft.priority as 'P1' | 'P2' | 'P3' | 'P4',
          channel: input.draft.channel === 'EMAIL' ? 'EMAIL' : 'PORTAL',
          assignedTeamId: input.draft.assignedTeamId ?? undefined,
          categoryId: input.draft.categoryId ?? undefined,
        },
        user,
        { skipRequiredCustomFields: true },
      );

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
  async createSlaInstance(
    ticketId: string,
    _priority: 'P1' | 'P2' | 'P3' | 'P4',
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
