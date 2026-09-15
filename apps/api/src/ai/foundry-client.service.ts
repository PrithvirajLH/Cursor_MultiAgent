import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AzureOpenAI } from 'openai';
import { ToolRegistryService } from './tools/tool-registry.service';
import type { ToolCallContext } from './tools/tool-call-context';
import {
  systemPrompt as intentExtractorPrompt,
  toolDefinitions as intentExtractorTools,
} from './prompts/intent-extractor';
import {
  systemPrompt as departmentClassifierPrompt,
  toolDefinitions as departmentClassifierTools,
} from './prompts/department-classifier';
import { systemPrompt as confidenceGatePrompt } from './prompts/confidence-gate';
import { systemPrompt as ticketGeneratorPrompt } from './prompts/ticket-generator';
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

  /**
   * Read-only grounding tools offered to each step.
   *
   * Without these the model cannot look anything up, so it invents department
   * and category ids and reports them at high confidence — the exact failure
   * ADR-002 ("the AI reasons; tools act") exists to prevent.
   *
   * Deliberately empty for two steps:
   * - confidenceGate now only phrases a question and needs no data;
   * - ticketGenerator must NOT be handed create_ticket. Persistence is
   *   orchestrated by the pipeline, not delegated to the model — otherwise a
   *   dry run could write real tickets.
   */
  private readonly agentPromptMap: Record<AgentStep, string> = {
    intentExtractor: intentExtractorPrompt,
    departmentClassifier: departmentClassifierPrompt,
    confidenceGate: confidenceGatePrompt,
    ticketGenerator: ticketGeneratorPrompt,
  };

  private readonly agentToolMap: Record<AgentStep, readonly unknown[]> = {
    intentExtractor: intentExtractorTools,
    departmentClassifier: departmentClassifierTools,
    confidenceGate: [],
    ticketGenerator: [],
  };

  /**
   * The prompt files declare tools in Chat Completions shape
   * ({ type, function: { name, ... } }); the Responses API expects the fields
   * flattened onto the tool itself.
   */
  private toResponsesTools(definitions: readonly unknown[]) {
    return definitions.map((definition) => {
      const tool = definition as {
        type?: string;
        function?: {
          name?: string;
          description?: string;
          parameters?: unknown;
        };
      };
      return {
        type: 'function',
        name: tool.function?.name,
        description: tool.function?.description,
        parameters: tool.function?.parameters,
      };
    });
  }

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
  async runAgent(
    step: AgentStep,
    userMessage: string,
    context: ToolCallContext,
  ): Promise<AgentRunResult> {
    const openai = this.getClient();
    const model = this.config.get<string>('AZURE_AI_FOUNDRY_MODEL') ?? 'gpt-4o';
    const startTime = Date.now();
    const toolCallsMade: string[] = [];

    const tools = this.toResponsesTools(this.agentToolMap[step]);

    // Two ways to reach the model, and they are mutually exclusive: Azure
    // rejects a request carrying both `agent_reference` and `tools` with
    // "400 Not allowed when agent is specified".
    //
    //  - agent mode (default): the prompt AND the tools live in the Azure
    //    Foundry agent definition. Nothing here can influence them, so if the
    //    agent has no tools registered the model cannot look anything up and
    //    will invent department ids at high confidence.
    //  - inline mode (AI_INLINE_PROMPTS=true): the prompt and tools are sent
    //    from this repo, so both are version controlled and the grounding
    //    tools are guaranteed to be offered. The *_AGENT_ID vars go unused.
    // Defaults to inline. The prompts and tool definitions in this repo are the
    // source of truth: they are reviewable, versioned, and — critically — they
    // are what the accuracy benchmark scores, so the measured number describes
    // what actually ships.
    //
    // Set AI_INLINE_PROMPTS=false to fall back to the Azure-hosted agents. That
    // path only works if the grounding tools are registered on each agent in
    // Foundry; without them the model cannot look anything up and will invent
    // department ids at high confidence.
    const inline =
      (this.config.get<string>('AI_INLINE_PROMPTS') ?? 'true').toLowerCase() !==
      'false';

    // Resolved only in agent mode: the *_AGENT_ID vars are unused inline, and
    // getAgentName throws when they are absent.
    const agentName = inline ? '' : this.getAgentName(step);

    const body = inline
      ? {
          model,
          instructions: this.agentPromptMap[step],
          input: [{ role: 'user', content: userMessage }],
          ...(tools.length > 0 ? { tools } : {}),
        }
      : {
          model,
          input: [{ role: 'user', content: userMessage }],
          agent_reference: {
            name: agentName,
            type: 'agent_reference',
          },
        };

    // Initial call
    let response = (await openai.post('/responses', {
      body,
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
        // ⚠️ Card 1.85: the identity travels with the call. `toolArgs` is
        // whatever the model decided to send and is never an identity.
        const result = await this.toolRegistry.executeTool(
          toolName,
          toolArgs,
          context,
        );
        toolResults.push({
          type: 'function_call_output',
          call_id: call.call_id,
          output: result,
        });
      }

      // Continue conversation with tool results.
      //
      // This MUST mirror the mode of the initial call. Sending agent_reference
      // here while the first call was inline hands the conversation back to the
      // Azure agent, whose own prompt then answers instead of the one that
      // asked for the tools — the model ends up ignoring the tool results it
      // just requested.
      response = (await openai.post('/responses', {
        body: inline
          ? {
              model,
              instructions: this.agentPromptMap[step],
              input: toolResults,
              previous_response_id: response.id,
              ...(tools.length > 0 ? { tools } : {}),
            }
          : {
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
