import { Injectable } from '@nestjs/common';
import { TicketPriority } from '@prisma/client';
import type { Prisma, SlaInstance } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

// Database client type that works for both PrismaService and TransactionClient
type DbClient = PrismaService | Prisma.TransactionClient;

@Injectable()
export class SlaEngineService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Sync SLA instance from ticket data.
   * @param ticketId - The ticket ID to sync
   * @param options - Optional settings for policy references and reset flags
   * @param tx - Optional transaction client; if provided, all queries use this client
   */
  async syncFromTicket(
    ticketId: string,
    options?: {
      policyConfigId?: string | null;
      resetResolution?: boolean;
      resetFirstResponse?: boolean;
    },
    tx?: Prisma.TransactionClient,
  ) {
    // Use provided transaction client or default to this.prisma
    const db: DbClient = tx ?? this.prisma;

    const ticket = await db.ticket.findUnique({
      where: { id: ticketId },
      select: {
        id: true,
        priority: true,
        firstResponseDueAt: true,
        dueAt: true,
        slaPausedAt: true,
        firstResponseAt: true,
        completedAt: true,
        assignedTeamId: true,
      },
    });

    if (!ticket) {
      return null;
    }

    const existing = await db.slaInstance.findUnique({
      where: { ticketId },
    });

    // Resolve policy-config linkage first (new runtime source of truth).
    let resolvedPolicyConfigId = options?.policyConfigId;
    if (resolvedPolicyConfigId === undefined && !existing?.policyConfigId) {
      resolvedPolicyConfigId = await this.resolveEffectivePolicyConfigId(
        ticket.priority,
        ticket.assignedTeamId,
        db,
      );
    }

    // Apply resets before computing nextDueAt so reopened tickets get re-scheduled
    const effective = {
      firstResponseBreachedAt: options?.resetFirstResponse
        ? null
        : (existing?.firstResponseBreachedAt ?? null),
      resolutionBreachedAt: options?.resetResolution
        ? null
        : (existing?.resolutionBreachedAt ?? null),
    };

    const nextDueAt = this.computeNextDueAt(
      ticket,
      effective as SlaInstance | null,
    );

    const updateData: Prisma.SlaInstanceUpdateInput = {
      priority: ticket.priority,
      firstResponseDueAt: ticket.firstResponseDueAt,
      resolutionDueAt: ticket.dueAt,
      pausedAt: ticket.slaPausedAt,
      nextDueAt,
    };

    if (resolvedPolicyConfigId !== undefined) {
      if (resolvedPolicyConfigId) {
        updateData.policyConfig = { connect: { id: resolvedPolicyConfigId } };
      } else if (existing?.policyConfigId) {
        updateData.policyConfig = { disconnect: true };
      }
    }

    if (options?.resetResolution) {
      updateData.resolutionBreachedAt = null;
      updateData.resolutionAtRiskNotifiedAt = null;
    }

    if (options?.resetFirstResponse) {
      updateData.firstResponseBreachedAt = null;
      updateData.firstResponseAtRiskNotifiedAt = null;
    }

    const createPolicyConfigId =
      resolvedPolicyConfigId ?? existing?.policyConfigId ?? null;

    return db.slaInstance.upsert({
      where: { ticketId },
      update: updateData,
      create: {
        ticketId,
        policyConfigId: createPolicyConfigId,
        priority: ticket.priority,
        firstResponseDueAt: ticket.firstResponseDueAt,
        resolutionDueAt: ticket.dueAt,
        pausedAt: ticket.slaPausedAt,
        nextDueAt,
      },
    });
  }

  /**
   * Resolve the effective SLA policy config ID for a ticket context.
   * Team-specific assignment wins; otherwise fall back to enabled global default.
   */
  private async resolveEffectivePolicyConfigId(
    priority: TicketPriority,
    teamId: string | null,
    db: DbClient,
  ): Promise<string | null> {
    if (teamId) {
      const assignedRows = await db.$queryRaw<
        Array<{ policyConfigId: string }>
      >`
        SELECT p."id" AS "policyConfigId"
        FROM "SlaPolicyAssignment" a
        INNER JOIN "SlaPolicyConfig" p ON p."id" = a."policyConfigId"
        INNER JOIN "SlaPolicyConfigTarget" t
          ON t."policyConfigId" = p."id"
         AND t."priority" = ${priority}::"TicketPriority"
        WHERE a."teamId" = ${teamId}
          AND p."enabled" = true
        ORDER BY a."updatedAt" DESC
        LIMIT 1
      `;
      if (assignedRows[0]?.policyConfigId) {
        return assignedRows[0].policyConfigId;
      }
    }

    const defaultRows = await db.$queryRaw<Array<{ policyConfigId: string }>>`
      SELECT p."id" AS "policyConfigId"
      FROM "SlaPolicyConfig" p
      INNER JOIN "SlaPolicyConfigTarget" t
        ON t."policyConfigId" = p."id"
       AND t."priority" = ${priority}::"TicketPriority"
      WHERE p."isDefault" = true
        AND p."enabled" = true
      ORDER BY p."updatedAt" DESC
      LIMIT 1
    `;
    return defaultRows[0]?.policyConfigId ?? null;
  }

  private computeNextDueAt(
    ticket: {
      firstResponseAt: Date | null;
      completedAt: Date | null;
      firstResponseDueAt: Date | null;
      dueAt: Date | null;
      slaPausedAt: Date | null;
    },
    instance: SlaInstance | null,
  ) {
    if (ticket.slaPausedAt) {
      return null;
    }

    const firstResponsePending =
      !ticket.firstResponseAt && !instance?.firstResponseBreachedAt;
    if (firstResponsePending && ticket.firstResponseDueAt) {
      return ticket.firstResponseDueAt;
    }

    const resolutionPending =
      !ticket.completedAt && !instance?.resolutionBreachedAt;
    if (resolutionPending && ticket.dueAt) {
      return ticket.dueAt;
    }

    return null;
  }
}
