import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { FoundryClientService } from './foundry-client.service';
import { ToolRegistryService } from './tools/tool-registry.service';
import { TicketToolsService } from './tools/ticket-tools.service';
import type { AuthUser } from '../auth/current-user.decorator';
import type {
  PipelineInput,
  PipelineResult,
  IntentResult,
  ClassificationResult,
  ConfidenceResult,
  TicketDraft,
  StepResult,
  DebugPipelineResult,
  AiAnalysis,
} from './types/pipeline.types';

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  constructor(
    private readonly foundryClient: FoundryClientService,
    private readonly toolRegistry: ToolRegistryService,
    private readonly ticketTools: TicketToolsService,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  // ─── Validation Helpers ──────────────────────────────────────────────

  private validateIntentResult(data: unknown): IntentResult {
    const d = data as IntentResult;
    if (!d.intent || !d.requestType || !d.entities) {
      throw new Error('Invalid IntentResult: missing required fields');
    }
    return d;
  }

  private validateClassificationResult(data: unknown): ClassificationResult {
    const d = data as ClassificationResult;
    if (!d.department || typeof d.department.confidence !== 'number') {
      throw new Error('Invalid ClassificationResult: missing department or confidence');
    }
    return d;
  }

  private validateConfidenceResult(data: unknown): ConfidenceResult {
    const d = data as ConfidenceResult;
    if (typeof d.passed !== 'boolean' || typeof d.overallConfidence !== 'number') {
      throw new Error('Invalid ConfidenceResult: missing passed or overallConfidence');
    }
    return d;
  }

  private validateTicketDraft(data: unknown): TicketDraft {
    const d = data as TicketDraft;
    if (!d.subject || !d.description || !d.priority) {
      throw new Error('Invalid TicketDraft: missing required fields');
    }
    return d;
  }

  // ─── Pipeline Steps ──────────────────────────────────────────────────

  private async extractIntent(text: string, userId?: string): Promise<IntentResult> {
    const userMessage = userId
      ? `User ID: ${userId}\n\nRequest:\n${text}`
      : `Request:\n${text}`;

    const result = await this.foundryClient.runAgent('intentExtractor', userMessage);
    this.logger.debug(`[Agent 1] Intent Extractor — ${result.latencyMs}ms, tools: [${result.toolCallsMade.join(', ')}]`);

    return this.foundryClient.parseAgentResponse(result.content, (data) =>
      this.validateIntentResult(data),
    );
  }

  private async classifyDepartment(intent: IntentResult): Promise<ClassificationResult> {
    const userMessage = `Classify the following analyzed request:\n\n${JSON.stringify(intent, null, 2)}`;

    const result = await this.foundryClient.runAgent('departmentClassifier', userMessage);
    this.logger.debug(`[Agent 2] Dept Classifier — ${result.latencyMs}ms, tools: [${result.toolCallsMade.join(', ')}]`);

    return this.foundryClient.parseAgentResponse(result.content, (data) =>
      this.validateClassificationResult(data),
    );
  }

  private async checkConfidence(
    intent: IntentResult,
    classification: ClassificationResult,
  ): Promise<ConfidenceResult> {
    const userMessage = `Evaluate the confidence of this classification:\n\nIntent:\n${JSON.stringify(intent, null, 2)}\n\nClassification:\n${JSON.stringify(classification, null, 2)}`;

    const result = await this.foundryClient.runAgent('confidenceGate', userMessage);
    this.logger.debug(`[Agent 3] Confidence Gate — ${result.latencyMs}ms`);

    return this.foundryClient.parseAgentResponse(result.content, (data) =>
      this.validateConfidenceResult(data),
    );
  }

  // ─── Main Pipeline ───────────────────────────────────────────────────

  async classifyAndCreateTicket(
    input: PipelineInput,
    user: AuthUser,
  ): Promise<PipelineResult> {
    const startTime = Date.now();
    this.logger.log(`AI Pipeline Start — Input: "${input.text.substring(0, 80)}${input.text.length > 80 ? '...' : ''}"`);

    // Set user context for tool calls
    this.toolRegistry.setCurrentUser(user);

    // Track each agent's raw response for storage
    const pipelineSteps: Record<string, unknown>[] = [];

    // Step 1: Extract intent
    let intent: IntentResult;
    let step1Raw: { content: string; toolCallsMade: string[]; latencyMs: number } | null = null;
    try {
      const userMessage = input.userId
        ? `User ID: ${input.userId}\n\nRequest:\n${input.text}`
        : `Request:\n${input.text}`;
      const result = await this.foundryClient.runAgent('intentExtractor', userMessage);
      step1Raw = result;
      intent = this.foundryClient.parseAgentResponse(result.content, (data) => this.validateIntentResult(data));
      pipelineSteps.push({
        step: 1, agent: 'intentExtractor', status: 'success',
        latencyMs: result.latencyMs, toolsCalled: result.toolCallsMade,
        input: userMessage, rawOutput: result.content, parsed: intent,
      });
      this.logger.debug(`→ Intent: ${intent.intent}`);
    } catch (error) {
      pipelineSteps.push({
        step: 1, agent: 'intentExtractor', status: 'error',
        latencyMs: step1Raw?.latencyMs ?? Date.now() - startTime,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      this.logger.error('Intent extraction failed', error);
      return {
        status: 'error',
        error: `Intent extraction failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        step: 'intent_extraction',
      };
    }

    // Step 2: Classify department
    let classification: ClassificationResult;
    let step2Raw: { content: string; toolCallsMade: string[]; latencyMs: number } | null = null;
    try {
      const step2Input = `Classify the following analyzed request:\n\n${JSON.stringify(intent, null, 2)}`;
      const result = await this.foundryClient.runAgent('departmentClassifier', step2Input);
      step2Raw = result;
      classification = this.foundryClient.parseAgentResponse(result.content, (data) => this.validateClassificationResult(data));
      pipelineSteps.push({
        step: 2, agent: 'departmentClassifier', status: 'success',
        latencyMs: result.latencyMs, toolsCalled: result.toolCallsMade,
        input: step2Input, rawOutput: result.content, parsed: classification,
      });
      this.logger.debug(`→ Department: ${classification.department.name} (${(classification.department.confidence * 100).toFixed(0)}%)`);
    } catch (error) {
      pipelineSteps.push({
        step: 2, agent: 'departmentClassifier', status: 'error',
        latencyMs: step2Raw?.latencyMs ?? Date.now() - startTime,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      this.logger.error('Classification failed', error);
      return {
        status: 'error',
        error: `Department classification failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        step: 'department_classification',
      };
    }

    // Step 3: Confidence check
    let confidence: ConfidenceResult;
    let step3Raw: { content: string; toolCallsMade: string[]; latencyMs: number } | null = null;
    try {
      const step3Input = `Evaluate the confidence of this classification:\n\nIntent:\n${JSON.stringify(intent, null, 2)}\n\nClassification:\n${JSON.stringify(classification, null, 2)}`;
      const result = await this.foundryClient.runAgent('confidenceGate', step3Input);
      step3Raw = result;
      confidence = this.foundryClient.parseAgentResponse(result.content, (data) => this.validateConfidenceResult(data));
      pipelineSteps.push({
        step: 3, agent: 'confidenceGate', status: 'success',
        latencyMs: result.latencyMs, toolsCalled: result.toolCallsMade,
        input: step3Input, rawOutput: result.content, parsed: confidence,
      });
      this.logger.debug(`→ Confidence: ${(confidence.overallConfidence * 100).toFixed(0)}% — ${confidence.passed ? 'PASSED' : 'NEEDS CLARIFICATION'}`);
    } catch (error) {
      pipelineSteps.push({
        step: 3, agent: 'confidenceGate', status: 'error',
        latencyMs: step3Raw?.latencyMs ?? Date.now() - startTime,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      this.logger.error('Confidence check failed', error);
      return {
        status: 'error',
        error: `Confidence check failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        step: 'confidence_check',
      };
    }

    const finalClassification = confidence.adjustedClassification ?? classification;

    // If confidence is too low, ask for clarification
    if (!confidence.passed) {
      const elapsed = Date.now() - startTime;
      this.logger.log(`Pipeline returning clarification question (${elapsed}ms total)`);
      return {
        status: 'needs_clarification',
        question: confidence.clarifyingQuestion ?? 'Could you provide more details about your request?',
        partialClassification: finalClassification,
      };
    }

    // Step 4: Generate ticket draft via Agent 4
    let ticketDraft: TicketDraft | null = null;
    try {
      const step4Input = `Based on the pipeline data below, generate a JSON ticket draft. Do NOT attempt to call any tools or functions. ONLY return a valid JSON object.

Intent:
${JSON.stringify(intent, null, 2)}

Classification:
${JSON.stringify(finalClassification, null, 2)}

Confidence:
${JSON.stringify(confidence, null, 2)}

Channel: ${input.channel ?? 'PORTAL'}
Requester ID: ${input.userId ?? user.id}

IMPORTANT: Return ONLY the JSON object. Format:
{"subject":"...","description":"...","priority":"P1|P2|P3|P4","channel":"PORTAL|EMAIL","assignedTeamId":"...","categoryId":"...|null","displayId":"...","tags":["..."]}`;

      const result = await this.foundryClient.runAgent('ticketGenerator', step4Input);
      ticketDraft = this.foundryClient.parseAgentResponse(result.content, (d) => this.validateTicketDraft(d));
      pipelineSteps.push({
        step: 4, agent: 'ticketGenerator', status: 'success',
        latencyMs: result.latencyMs, toolsCalled: result.toolCallsMade,
        input: step4Input, rawOutput: result.content, parsed: ticketDraft,
      });
      this.logger.debug(`→ Subject: ${ticketDraft.subject}`);
    } catch (error) {
      this.logger.warn('Ticket generation agent failed, falling back to intent-based subject', error);
      // Fallback: use intent as subject if Agent 4 fails
    }

    // Step 5: Create ticket via existing TicketsService
    try {
      const subject = ticketDraft?.subject ?? intent.intent.substring(0, 100);
      const aiAnalysis: AiAnalysis = {
        what: intent.intent,
        who: user.displayName ?? user.email,
        context: finalClassification.reasoning,
        urgency: intent.urgencySignals.length > 0 ? intent.urgencySignals.join(', ') : 'None indicated',
        intent: intent.intent,
        requestType: intent.requestType,
        department: finalClassification.department.name,
        departmentConfidence: finalClassification.department.confidence,
        category: finalClassification.category?.name ?? null,
        reasoning: finalClassification.reasoning,
      };

      const ticketResult = await this.ticketTools.createTicket(
        {
          draft: {
            subject,
            description: ticketDraft?.description ?? this.buildDescription(intent, user),
            priority: ticketDraft?.priority ?? finalClassification.suggestedPriority,
            channel: input.channel ?? 'PORTAL',
            assignedTeamId:
              ticketDraft?.assignedTeamId ??
              (await this.resolveTeamId(finalClassification.department)),
            categoryId: ticketDraft?.categoryId ?? finalClassification.category?.id ?? null,
            displayId: 'AUTO',
            tags: ticketDraft?.tags ?? finalClassification.tags,
          },
          requesterId: user.id,
          rawText: input.text,
          aiAnalysis,
        },
        user,
      );

      if (!ticketResult.success) {
        return {
          status: 'error',
          error: ticketResult.error,
          step: 'ticket_generation',
        };
      }

      const pipelineLatencyMs = Date.now() - startTime;
      this.logger.log(`Ticket created: #${ticketResult.data.number} (${pipelineLatencyMs}ms total)`);

      // Store the full pipeline trace as a TicketEvent
      await this.prisma.ticketEvent.create({
        data: {
          ticketId: ticketResult.data.id,
          type: 'AI_PIPELINE_TRACE',
          payload: JSON.parse(JSON.stringify({
            userId: user.id,
            userEmail: user.email,
            ticketId: ticketResult.data.id,
            ticketNumber: ticketResult.data.number,
            inputText: input.text,
            channel: input.channel ?? 'PORTAL',
            totalLatencyMs: pipelineLatencyMs,
            steps: pipelineSteps,
            finalClassification,
            aiAnalysis,
          })),
          createdById: user.id,
        },
      });

      // Fetch the full ticket for the response
      const ticket = await this.prisma.ticket.findUnique({
        where: { id: ticketResult.data.id },
        select: {
          id: true,
          number: true,
          displayId: true,
          subject: true,
          description: true,
          status: true,
          priority: true,
          channel: true,
          requesterId: true,
          assignedTeamId: true,
          categoryId: true,
        },
      });

      if (!ticket) {
        return {
          status: 'error',
          error: 'Ticket was not found after creation',
          step: 'ticket_generation',
        };
      }

      return {
        status: 'created',
        ticket,
        aiMetadata: {
          intentConfidence: finalClassification.department.confidence,
          classificationConfidence: finalClassification.department.confidence,
          overallConfidence: confidence.overallConfidence,
          reasoning: finalClassification.reasoning,
          pipelineLatencyMs,
          modelUsed: this.config.get<string>('AZURE_AI_FOUNDRY_MODEL') ?? 'gpt-4o',
        },
        aiAnalysis,
      };
    } catch (error) {
      this.logger.error('Ticket generation failed', error);
      return {
        status: 'error',
        error: `Ticket generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        step: 'ticket_generation',
      };
    }
  }

  // ─── Debug Pipeline ──────────────────────────────────────────────────

  async debugPipeline(input: PipelineInput, user: AuthUser): Promise<DebugPipelineResult> {
    const steps: StepResult[] = [];
    const startTime = Date.now();
    this.toolRegistry.setCurrentUser(user);

    // Step 1: Intent Extraction
    const step1Input = input.userId
      ? `User ID: ${input.userId}\n\nRequest:\n${input.text}`
      : `Request:\n${input.text}`;

    let intent: IntentResult;
    try {
      const result = await this.foundryClient.runAgent('intentExtractor', step1Input);
      intent = this.foundryClient.parseAgentResponse(result.content, (d) => this.validateIntentResult(d));
      steps.push({
        step: 1, name: 'Intent Extraction',
        agentName: this.config.get<string>('INTENT_EXTRACTOR_AGENT_ID') ?? 'intent-extractor',
        input: step1Input, rawOutput: result.content, parsed: intent,
        toolsCalled: result.toolCallsMade, latencyMs: result.latencyMs, status: 'success',
      });
    } catch (error) {
      steps.push({
        step: 1, name: 'Intent Extraction',
        agentName: this.config.get<string>('INTENT_EXTRACTOR_AGENT_ID') ?? 'intent-extractor',
        input: step1Input, rawOutput: '', parsed: null, toolsCalled: [],
        latencyMs: Date.now() - startTime, status: 'error',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return { steps, finalStatus: 'error', totalLatencyMs: Date.now() - startTime, errorMessage: `Step 1 failed: ${steps[0].error}` };
    }

    // Step 2: Department Classification
    const step2Input = `Classify the following analyzed request:\n\n${JSON.stringify(intent, null, 2)}`;
    let classification: ClassificationResult;
    try {
      const result = await this.foundryClient.runAgent('departmentClassifier', step2Input);
      classification = this.foundryClient.parseAgentResponse(result.content, (d) => this.validateClassificationResult(d));
      steps.push({
        step: 2, name: 'Department Classification',
        agentName: this.config.get<string>('DEPARTMENT_CLASSIFIER_AGENT_ID') ?? 'department-classifier',
        input: step2Input, rawOutput: result.content, parsed: classification,
        toolsCalled: result.toolCallsMade, latencyMs: result.latencyMs, status: 'success',
      });
    } catch (error) {
      steps.push({
        step: 2, name: 'Department Classification',
        agentName: this.config.get<string>('DEPARTMENT_CLASSIFIER_AGENT_ID') ?? 'department-classifier',
        input: step2Input, rawOutput: '', parsed: null, toolsCalled: [],
        latencyMs: Date.now() - startTime - steps.reduce((s, r) => s + r.latencyMs, 0),
        status: 'error', error: error instanceof Error ? error.message : 'Unknown error',
      });
      return { steps, finalStatus: 'error', totalLatencyMs: Date.now() - startTime, errorMessage: `Step 2 failed: ${steps[1].error}` };
    }

    // Step 3: Confidence Gate
    const step3Input = `Evaluate the confidence of this classification:\n\nIntent:\n${JSON.stringify(intent, null, 2)}\n\nClassification:\n${JSON.stringify(classification, null, 2)}`;
    let confidence: ConfidenceResult;
    try {
      const result = await this.foundryClient.runAgent('confidenceGate', step3Input);
      confidence = this.foundryClient.parseAgentResponse(result.content, (d) => this.validateConfidenceResult(d));
      steps.push({
        step: 3, name: 'Confidence Gate',
        agentName: this.config.get<string>('CONFIDENCE_GATE_AGENT_ID') ?? 'confidence-gate',
        input: step3Input, rawOutput: result.content, parsed: confidence,
        toolsCalled: result.toolCallsMade, latencyMs: result.latencyMs, status: 'success',
      });
    } catch (error) {
      steps.push({
        step: 3, name: 'Confidence Gate',
        agentName: this.config.get<string>('CONFIDENCE_GATE_AGENT_ID') ?? 'confidence-gate',
        input: step3Input, rawOutput: '', parsed: null, toolsCalled: [],
        latencyMs: Date.now() - startTime - steps.reduce((s, r) => s + r.latencyMs, 0),
        status: 'error', error: error instanceof Error ? error.message : 'Unknown error',
      });
      return { steps, finalStatus: 'error', totalLatencyMs: Date.now() - startTime, errorMessage: `Step 3 failed: ${steps[2].error}` };
    }

    const finalClassification = confidence.adjustedClassification ?? classification;

    if (!confidence.passed) {
      return {
        steps, finalStatus: 'needs_clarification',
        totalLatencyMs: Date.now() - startTime,
        clarifyingQuestion: confidence.clarifyingQuestion ?? 'Could you provide more details?',
      };
    }

    // Step 4: Ticket Generation (JSON draft only in debug)
    const step4Input = `Based on the pipeline data below, generate a JSON ticket draft. Do NOT attempt to call any tools or functions. ONLY return a valid JSON object.

Intent:
${JSON.stringify(intent, null, 2)}

Classification:
${JSON.stringify(finalClassification, null, 2)}

Confidence:
${JSON.stringify(confidence, null, 2)}

Channel: ${input.channel ?? 'PORTAL'}
Requester ID: ${input.userId ?? user.id}

IMPORTANT: Return ONLY the JSON object. Format:
{"subject":"...","description":"...","priority":"P1|P2|P3|P4","channel":"PORTAL|EMAIL","assignedTeamId":"...","categoryId":"...|null","displayId":"...","tags":["..."]}`;

    let ticketDraft: TicketDraft;
    try {
      const result = await this.foundryClient.runAgent('ticketGenerator', step4Input);
      ticketDraft = this.foundryClient.parseAgentResponse(result.content, (d) => this.validateTicketDraft(d));
      steps.push({
        step: 4, name: 'Ticket Generation',
        agentName: this.config.get<string>('TICKET_GENERATOR_AGENT_ID') ?? 'ticket-generator',
        input: step4Input, rawOutput: result.content, parsed: ticketDraft,
        toolsCalled: result.toolCallsMade, latencyMs: result.latencyMs, status: 'success',
      });
    } catch (error) {
      steps.push({
        step: 4, name: 'Ticket Generation',
        agentName: this.config.get<string>('TICKET_GENERATOR_AGENT_ID') ?? 'ticket-generator',
        input: step4Input, rawOutput: '', parsed: null, toolsCalled: [],
        latencyMs: Date.now() - startTime - steps.reduce((s, r) => s + r.latencyMs, 0),
        status: 'error', error: error instanceof Error ? error.message : 'Unknown error',
      });
      return { steps, finalStatus: 'error', totalLatencyMs: Date.now() - startTime, errorMessage: `Step 4 failed: ${steps[3].error}` };
    }

    // Debug mode: return the draft without creating a ticket
    return {
      steps, finalStatus: 'created', totalLatencyMs: Date.now() - startTime,
      ticket: {
        id: 'debug-dry-run',
        number: 0,
        displayId: 'DEBUG',
        subject: ticketDraft.subject,
        description: ticketDraft.description,
        priority: ticketDraft.priority,
        channel: ticketDraft.channel,
        assignedTeamId: ticketDraft.assignedTeamId,
        categoryId: ticketDraft.categoryId,
        tags: ticketDraft.tags,
      },
    };
  }

  // ─── Get AI Analysis for a Ticket ────────────────────────────────────

  async getAiAnalysis(ticketId: string): Promise<Record<string, unknown> | null> {
    const event = await this.prisma.ticketEvent.findFirst({
      where: { ticketId, type: 'AI_CLASSIFICATION' },
      select: { payload: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });

    if (!event || !event.payload) return null;
    return event.payload as Record<string, unknown>;
  }

  // ─── Helpers ─────────────────────────────────────────────────────────

  private buildDescription(intent: IntentResult, user: AuthUser): string {
    const parts = [
      `**What:** ${intent.intent}`,
      `**Who:** ${user.displayName ?? user.email}`,
    ];

    if (intent.urgencySignals.length > 0) {
      parts.push(`**Urgency:** ${intent.urgencySignals.join(', ')}`);
    }

    if (intent.affectedSystem) {
      parts.push(`**Affected System:** ${intent.affectedSystem}`);
    }

    parts.push('', '---', '', `**Original message:**`, intent.rawText);

    return parts.join('\n');
  }

  /**
   * Resolve the AI classifier's department to a real Team id in this
   * database. The agent reports both `name` and `id`; we trust `id`
   * only if it actually exists, otherwise fall back to a case-
   * insensitive name match. Returns null when nothing matches so the
   * ticket gets created un-routed instead of failing the FK.
   *
   * Fixes the cross-environment problem where the classifier was
   * configured against one DB (e.g. Supabase) and gets pointed at
   * another (Azure Postgres) with different team UUIDs.
   */
  private async resolveTeamId(department: {
    id?: string;
    name?: string;
  }): Promise<string | null> {
    if (department.id) {
      const byId = await this.prisma.team.findUnique({
        where: { id: department.id },
        select: { id: true },
      });
      if (byId) return byId.id;
    }
    if (department.name) {
      const byName = await this.prisma.team.findFirst({
        where: {
          isActive: true,
          name: { equals: department.name, mode: 'insensitive' },
        },
        select: { id: true },
      });
      if (byName) return byName.id;
    }
    this.logger.warn(
      `Could not resolve AI department to a Team (id=${department.id ?? 'n/a'} name=${department.name ?? 'n/a'}). Creating ticket un-routed.`,
    );
    return null;
  }
}
