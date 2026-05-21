import { Injectable, Logger } from '@nestjs/common';
import { UserToolsService } from './user-tools.service';
import { ClassificationToolsService } from './classification-tools.service';
import { TicketToolsService } from './ticket-tools.service';
import type { AuthUser } from '../../auth/current-user.decorator';
import type { TicketDraft, AiAnalysis } from '../types/pipeline.types';

type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>;

@Injectable()
export class ToolRegistryService {
  private readonly logger = new Logger(ToolRegistryService.name);
  private handlers: Map<string, ToolHandler> = new Map();
  private currentUser: AuthUser | null = null;

  constructor(
    private readonly userTools: UserToolsService,
    private readonly classificationTools: ClassificationToolsService,
    private readonly ticketTools: TicketToolsService,
  ) {
    this.registerHandlers();
  }

  /**
   * Sets the current user context for tool calls that need AuthUser.
   * Must be called before running a pipeline that creates tickets.
   */
  setCurrentUser(user: AuthUser): void {
    this.currentUser = user;
  }

  private registerHandlers(): void {
    this.handlers.set('get_user_profile', async (args) => {
      return this.userTools.getUserProfile(args.userId as string);
    });

    this.handlers.set('get_user_history', async (args) => {
      return this.userTools.getUserHistory(args.userId as string);
    });

    this.handlers.set('get_departments', async () => {
      return this.classificationTools.getDepartments();
    });

    this.handlers.set('get_categories', async () => {
      return this.classificationTools.getCategories();
    });

    this.handlers.set('get_routing_rules', async () => {
      return this.classificationTools.getRoutingRules();
    });

    this.handlers.set('create_ticket', async (args) => {
      if (!this.currentUser) {
        return { success: false, error: 'No user context set for ticket creation' };
      }
      return this.ticketTools.createTicket(
        {
          draft: args.draft as TicketDraft,
          requesterId: this.currentUser.id,
          rawText: args.rawText as string | undefined,
          aiAnalysis: args.aiAnalysis as AiAnalysis | undefined,
        },
        this.currentUser,
      );
    });

    this.handlers.set('create_sla_instance', async (args) => {
      return this.ticketTools.createSlaInstance(
        args.ticketId as string,
        args.priority as 'SEV1' | 'SEV2' | 'SEV3' | 'SEV4',
      );
    });
  }

  /**
   * Executes a tool by name with the given arguments.
   * Returns a JSON string for the AI agent to consume.
   */
  async executeTool(toolName: string, args: Record<string, unknown>): Promise<string> {
    const handler = this.handlers.get(toolName);

    if (!handler) {
      return JSON.stringify({
        success: false,
        error: `Unknown tool: ${toolName}`,
      });
    }

    try {
      this.logger.debug(`Executing tool: ${toolName}`);
      const result = await handler(args);
      return JSON.stringify(result);
    } catch (error) {
      this.logger.error(`Tool execution failed: ${toolName}`, error);
      return JSON.stringify({
        success: false,
        error: `Tool execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      });
    }
  }

  getAvailableTools(): string[] {
    return Array.from(this.handlers.keys());
  }
}
