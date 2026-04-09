import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { ToolResult } from '../types/pipeline.types';

interface UserProfile {
  id: string;
  email: string;
  displayName: string;
  department: string | null;
  location: string | null;
  role: string;
  primaryTeamId: string | null;
}

interface UserTicketSummary {
  id: string;
  number: number;
  subject: string;
  status: string;
  priority: string;
  assignedTeamName: string | null;
  categoryName: string | null;
  createdAt: string;
}

@Injectable()
export class UserToolsService {
  constructor(private readonly prisma: PrismaService) {}

  async getUserProfile(userId: string): Promise<ToolResult<UserProfile>> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          email: true,
          displayName: true,
          department: true,
          location: true,
          role: true,
          primaryTeamId: true,
        },
      });

      if (!user) {
        return { success: false, error: `User not found: ${userId}` };
      }

      return { success: true, data: user };
    } catch (error) {
      return {
        success: false,
        error: `Failed to fetch user profile: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  async getUserHistory(userId: string): Promise<ToolResult<UserTicketSummary[]>> {
    try {
      const tickets = await this.prisma.ticket.findMany({
        where: { requesterId: userId },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: {
          id: true,
          number: true,
          subject: true,
          status: true,
          priority: true,
          createdAt: true,
          assignedTeam: { select: { name: true } },
          category: { select: { name: true } },
        },
      });

      const data: UserTicketSummary[] = tickets.map((t) => ({
        id: t.id,
        number: t.number,
        subject: t.subject,
        status: t.status,
        priority: t.priority,
        assignedTeamName: t.assignedTeam?.name ?? null,
        categoryName: t.category?.name ?? null,
        createdAt: t.createdAt.toISOString(),
      }));

      return { success: true, data };
    } catch (error) {
      return {
        success: false,
        error: `Failed to fetch user history: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }
}
