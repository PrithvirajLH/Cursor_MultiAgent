import { ForbiddenException, Injectable } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import { AuthUser } from '../auth/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';

export type AuditEventType =
  | 'TICKET_CREATED'
  | 'TICKET_ASSIGNED'
  | 'TICKET_TRANSFERRED'
  | 'TICKET_STATUS_CHANGED'
  | 'TICKET_PRIORITY_CHANGED'
  | 'MESSAGE_ADDED'
  | 'ATTACHMENT_ADDED'
  | string;

export type AuditLogEntry = {
  id: string;
  ticketId: string;
  ticketNumber: number;
  ticketDisplayId: string | null;
  type: string;
  payload: Record<string, unknown> | null;
  createdAt: Date;
  createdById: string | null;
  createdBy: { id: string; displayName: string; email: string } | null;
};

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    params: {
      dateFrom?: string;
      dateTo?: string;
      userId?: string;
      type?: string;
      search?: string;
      page?: number;
      pageSize?: number;
    },
    user: AuthUser,
  ): Promise<{ data: AuditLogEntry[]; meta: { page: number; pageSize: number; total: number; totalPages: number } }> {
    this.ensureCanAccess(user);
    const page = Math.max(1, params.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, params.pageSize ?? 20));
    const where = this.buildWhere(params, user);

    const [data, total] = await Promise.all([
      this.prisma.ticketEvent.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          ticket: { select: { id: true, number: true, displayId: true } },
          createdBy: { select: { id: true, displayName: true, email: true } },
        },
      }),
      this.prisma.ticketEvent.count({ where }),
    ]);

    const entries: AuditLogEntry[] = data.map((e) => ({
      id: e.id,
      ticketId: e.ticketId,
      ticketNumber: e.ticket.number,
      ticketDisplayId: e.ticket.displayId,
      type: e.type,
      payload: e.payload as Record<string, unknown> | null,
      createdAt: e.createdAt,
      createdById: e.createdById,
      createdBy: e.createdBy,
    }));

    return {
      data: entries,
      meta: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  }

  async exportCsv(
    params: {
      dateFrom?: string;
      dateTo?: string;
      userId?: string;
      type?: string;
      search?: string;
    },
    user: AuthUser,
  ): Promise<string> {
    this.ensureCanAccess(user);
    const where = this.buildWhere(params, user);
    const data = await this.prisma.ticketEvent.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 10000,
      include: {
        ticket: { select: { number: true, displayId: true } },
        createdBy: { select: { displayName: true, email: true } },
      },
    });

    const header = 'Date,User,Ticket,Action,Details';
    const rows = data.map((e) => {
      const date = e.createdAt.toISOString();
      const user = e.createdBy ? `"${(e.createdBy.displayName || e.createdBy.email).replace(/"/g, '""')}"` : 'System';
      const ticket = e.ticket.displayId ?? `#${e.ticket.number}`;
      const action = this.eventTypeLabel(e.type);
      const details = this.formatPayloadForCsv(e.type, e.payload as Record<string, unknown> | null);
      return `${date},${user},${ticket},${action},${details}`;
    });
    return [header, ...rows].join('\n');
  }

  private buildWhere(
    params: { dateFrom?: string; dateTo?: string; userId?: string; type?: string; search?: string },
    user: AuthUser,
  ): Prisma.TicketEventWhereInput {
    const conditions: Prisma.TicketEventWhereInput[] = [];

    if (params.dateFrom) {
      conditions.push({ createdAt: { gte: new Date(params.dateFrom) } });
    }
    if (params.dateTo) {
      const to = new Date(params.dateTo);
      to.setUTCHours(23, 59, 59, 999);
      conditions.push({ createdAt: { lte: to } });
    }
    if (params.userId) {
      conditions.push({ createdById: params.userId });
    }
    if (params.type) {
      conditions.push({ type: params.type });
    }
    if (params.search?.trim()) {
      const q = params.search.trim();
      const num = parseInt(q, 10);
      if (!Number.isNaN(num)) {
        // Numeric query: match ticket number only (and displayId e.g. IT-1234)
        conditions.push({
          OR: [
            { ticket: { number: num } },
            { ticket: { displayId: { contains: q, mode: 'insensitive' } } },
          ],
        });
      } else {
        // Text query: match displayId, user name, or user email
        conditions.push({
          OR: [
            { ticket: { displayId: { contains: q, mode: 'insensitive' } } },
            { createdBy: { displayName: { contains: q, mode: 'insensitive' } } },
            { createdBy: { email: { contains: q, mode: 'insensitive' } } },
          ],
        });
      }
    }

    if (user.role === UserRole.TEAM_ADMIN && user.primaryTeamId) {
      conditions.push({ ticket: { assignedTeamId: user.primaryTeamId } });
    }

    return conditions.length > 0 ? { AND: conditions } : {};
  }

  private ensureCanAccess(user: AuthUser) {
    if (user.role === UserRole.OWNER) return;
    if (user.role === UserRole.TEAM_ADMIN && user.primaryTeamId) return;
    throw new ForbiddenException('Audit log is restricted to owners and team administrators');
  }

  private eventTypeLabel(type: string): string {
    const labels: Record<string, string> = {
      TICKET_CREATED: 'Created ticket',
      TICKET_ASSIGNED: 'Assigned ticket',
      TICKET_TRANSFERRED: 'Transferred ticket',
      TICKET_STATUS_CHANGED: 'Changed status',
      TICKET_PRIORITY_CHANGED: 'Changed priority',
      MESSAGE_ADDED: 'Added message',
      ATTACHMENT_ADDED: 'Added attachment',
    };
    return labels[type] ?? type;
  }

  private formatPayloadForCsv(type: string, payload: Record<string, unknown> | null): string {
    if (!payload) return '""';
    const parts: string[] = [];
    if (type === 'TICKET_STATUS_CHANGED' && payload.from != null && payload.to != null) {
      parts.push(`from ${payload.from} to ${payload.to}`);
    }
    if (type === 'TICKET_PRIORITY_CHANGED' && payload.from != null && payload.to != null) {
      parts.push(`from ${payload.from} to ${payload.to}`);
    }
    if (type === 'TICKET_TRANSFERRED' && payload.toTeamId) {
      parts.push(`to team ${payload.toTeamId}`);
    }
    const str = parts.length ? parts.join('; ') : JSON.stringify(payload);
    return `"${String(str).replace(/"/g, '""')}"`;
  }
}
