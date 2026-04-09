import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { ToolResult } from '../types/pipeline.types';

interface DepartmentInfo {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  assignmentStrategy: string;
}

interface CategoryNode {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  parentId: string | null;
  children: CategoryNode[];
}

interface RoutingRuleInfo {
  id: string;
  name: string;
  keywords: string[];
  teamId: string;
  teamName: string;
  priority: number;
  assigneeId: string | null;
}

@Injectable()
export class ClassificationToolsService {
  constructor(private readonly prisma: PrismaService) {}

  async getDepartments(): Promise<ToolResult<DepartmentInfo[]>> {
    try {
      const teams = await this.prisma.team.findMany({
        where: { isActive: true },
        select: {
          id: true,
          name: true,
          slug: true,
          description: true,
          assignmentStrategy: true,
        },
        orderBy: { name: 'asc' },
      });

      return { success: true, data: teams };
    } catch (error) {
      return {
        success: false,
        error: `Failed to fetch departments: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  async getCategories(): Promise<ToolResult<CategoryNode[]>> {
    try {
      const categories = await this.prisma.category.findMany({
        where: { isActive: true },
        select: {
          id: true,
          name: true,
          slug: true,
          description: true,
          parentId: true,
        },
        orderBy: { name: 'asc' },
      });

      // Build tree
      const categoryMap = new Map<string, CategoryNode>();
      const roots: CategoryNode[] = [];

      for (const cat of categories) {
        categoryMap.set(cat.id, { ...cat, children: [] });
      }

      for (const node of categoryMap.values()) {
        if (node.parentId && categoryMap.has(node.parentId)) {
          categoryMap.get(node.parentId)!.children.push(node);
        } else {
          roots.push(node);
        }
      }

      return { success: true, data: roots };
    } catch (error) {
      return {
        success: false,
        error: `Failed to fetch categories: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  async getRoutingRules(): Promise<ToolResult<RoutingRuleInfo[]>> {
    try {
      const rules = await this.prisma.routingRule.findMany({
        where: { isActive: true },
        select: {
          id: true,
          name: true,
          keywords: true,
          teamId: true,
          priority: true,
          assigneeId: true,
          team: { select: { name: true } },
        },
        orderBy: { priority: 'asc' },
      });

      const data: RoutingRuleInfo[] = rules.map((r) => ({
        id: r.id,
        name: r.name,
        keywords: r.keywords,
        teamId: r.teamId,
        teamName: r.team.name,
        priority: r.priority,
        assigneeId: r.assigneeId,
      }));

      return { success: true, data };
    } catch (error) {
      return {
        success: false,
        error: `Failed to fetch routing rules: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }
}
