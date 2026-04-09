import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AzureOpenAI } from 'openai';
import { ToolRegistryService } from './tools/tool-registry.service';
import type { AgentStep, AgentRunResult } from './types/pipeline.types';

// ─── Response Types ─────────────────────────────────────────────────────────

interface ResponseOutput {
  type: string;
  name?: string;
  arguments?: string;
  call_id?: string;
  content?: Array<{ type: string; text?: string }>;
}

interface FoundryResponse {
  id: string;
  status: string;
  output: ResponseOutput[];
  output_text?: string;
}

@Injectable()
export class FoundryClientService {
  private readonly logger = new Logger(FoundryClientService.name);
  private client: AzureOpenAI | null = null;

  private readonly agentEnvMap: Record<AgentStep, string> = {
    intentExtractor: 'INTENT_EXTRACTOR_AGENT_ID',
    departmentClassifier: 'DEPARTMENT_CLASSIFIER_AGENT_ID',
    confidenceGate: 'CONFIDENCE_GATE_AGENT_ID',
    ticketGenerator: 'TICKET_GENERATOR_AGENT_ID',
  };

  constructor(
    private readonly config: ConfigService,
    private readonly toolRegistry: ToolRegistryService,
  ) {}

  private getClient(): AzureOpenAI {
    if (this.client) return this.client;

    const endpoint = this.config.getOrThrow<string>('AZURE_AI_FOUNDRY_ENDPOINT');
    const apiKey = this.config.getOrThrow<string>('AZURE_AI_FOUNDRY_API_KEY');
    const apiVersion = this.config.get<string>('AZURE_AI_FOUNDRY_API_VERSION') ?? '2025-05-15-preview';

    this.client = new AzureOpenAI({ endpoint, apiKey, apiVersion });
    return this.client;
  }

  private getAgentName(step: AgentStep): string {
    const envKey = this.agentEnvMap[step];
    const name = this.config.get<string>(envKey);
    if (!name) throw new Error(`Missing ${envKey} environment variable`);
    return name;
  }

  private extractText(response: FoundryResponse): string {
    if (response.output_text) return response.output_text;

    for (const item of response.output ?? []) {
      if (item.type === 'message' && item.content) {
        for (const c of item.content) {
          if (c.type === 'output_text' && c.text) return c.text;
        }
      }
    }

    return '';
  }

  /**
   * Runs a Foundry agent using the Responses API with agent_reference.
   * Handles the tool call loop — if the agent requests tools, they are
   * executed locally via ToolRegistryService and results are sent back.
   */
  async runAgent(step: AgentStep, userMessage: string): Promise<AgentRunResult> {
    const openai = this.getClient();
    const agentName = this.getAgentName(step);
    const model = this.config.get<string>('AZURE_AI_FOUNDRY_MODEL') ?? 'gpt-4o';
    const startTime = Date.now();
    const toolCallsMade: string[] = [];

    // Initial call
    let response = (await openai.post('/responses', {
      body: {
        model,
        input: [{ role: 'user', content: userMessage }],
        agent_reference: {
          name: agentName,
          type: 'agent_reference',
        },
      },
    })) as FoundryResponse;

    // Handle tool call loop (max 5 rounds)
    let maxRounds = 5;
    while (maxRounds-- > 0) {
      const functionCalls = (response.output ?? []).filter(
        (item) => item.type === 'function_call',
      );

      if (functionCalls.length === 0) break;

      // Execute tools locally
      const toolResults = [];
      for (const call of functionCalls) {
        const toolName = call.name ?? 'unknown';
        const toolArgs = JSON.parse(call.arguments ?? '{}');
        toolCallsMade.push(toolName);
        const result = await this.toolRegistry.executeTool(toolName, toolArgs);
        toolResults.push({
          type: 'function_call_output',
          call_id: call.call_id,
          output: result,
        });
      }

      // Continue conversation with tool results
      response = (await openai.post('/responses', {
        body: {
          model,
          input: toolResults,
          previous_response_id: response.id,
          agent_reference: {
            name: agentName,
            type: 'agent_reference',
          },
        },
      })) as FoundryResponse;
    }

    return {
      content: this.extractText(response),
      toolCallsMade,
      latencyMs: Date.now() - startTime,
    };
  }

  /**
   * Parses the agent's text response as JSON with markdown code block stripping.
   */
  parseAgentResponse<T>(content: string, validate: (data: unknown) => T): T {
    let cleaned = content.trim();

    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    }

    const parsed = JSON.parse(cleaned);
    return validate(parsed);
  }
}
