import { randomUUID } from 'crypto';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AiRoutingMethod } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { FoundryClientService } from './foundry-client.service';
import { ToolRegistryService } from './tools/tool-registry.service';
import type { ToolCallContext } from './tools/tool-call-context';
import { TicketToolsService } from './tools/ticket-tools.service';
import { KbService } from '../kb/kb.service';
import { ConfidenceGateService } from './confidence-gate.service';
import {
  AiObservabilityService,
  type PipelineStepRecord,
} from '../common/ai-observability.service';
import { AccessControlService } from '../common/access-control.service';
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
    private readonly kb: KbService,
    private readonly confidenceGate: ConfidenceGateService,
    private readonly observability: AiObservabilityService,
    private readonly accessControl: AccessControlService,
  ) {}

  /** Best-effort KB article suggestions from the classifier's intent + classification. */
  private async getSuggestedArticles(
    intent: IntentResult,
    classification: ClassificationResult,
    user: AuthUser,
  ) {
    try {
      const e = intent.entities;
      const parts = [
        intent.intent,
        intent.affectedSystem ?? '',
        ...(e?.systems ?? []),
        ...(e?.devices ?? []),
        ...(e?.other ?? []),
        classification.department?.name ?? '',
        classification.category?.name ?? '',
      ].filter(Boolean);
      return await this.kb.suggest(parts.join(' '), user, 3);
    } catch {
      return [];
    }
  }

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

  private async extractIntent(
    text: string,
    toolContext: ToolCallContext,
    userId?: string,
  ): Promise<IntentResult> {
    const userMessage = userId
      ? `User ID: ${userId}\n\nRequest:\n${text}`
      : `Request:\n${text}`;

    const result = await this.foundryClient.runAgent('intentExtractor', userMessage, toolContext);
    this.logger.debug(`[Agent 1] Intent Extractor — ${result.latencyMs}ms, tools: [${result.toolCallsMade.join(', ')}]`);

    return this.foundryClient.parseAgentResponse(result.content, (data) =>
      this.validateIntentResult(data),
    );
  }

  private async classifyDepartment(
    intent: IntentResult,
    toolContext: ToolCallContext,
  ): Promise<ClassificationResult> {
    const userMessage = `Classify the following analyzed request:\n\n${JSON.stringify(intent, null, 2)}`;

    const result = await this.foundryClient.runAgent('departmentClassifier', userMessage, toolContext);
    this.logger.debug(`[Agent 2] Dept Classifier — ${result.latencyMs}ms, tools: [${result.toolCallsMade.join(', ')}]`);

    return this.foundryClient.parseAgentResponse(result.content, (data) =>
      this.validateClassificationResult(data),
    );
  }

  /**
   * Ask the model to phrase one clarifying question for a classification the
   * gate has already rejected. Phrasing is a language task and stays with the
   * LLM; the pass/fail decision does not (see ConfidenceGateService).
   *
   * Best effort: if the model is unavailable we still return a usable question
   * rather than failing the whole intake, because the ticket is going to human
   * triage either way.
   */
  private async generateClarifyingQuestion(
    intent: IntentResult,
    classification: ClassificationResult,
    toolContext: ToolCallContext,
  ): Promise<string> {
    const fallback =
      'Could you tell me a bit more about your request, so it reaches the right team?';
    const userMessage = `Write ONE short clarifying question for this request. Ask about the department boundary, offer 2-3 concrete options, and never ask something the user already answered.\n\nIntent:\n${JSON.stringify(intent, null, 2)}\n\nClassification:\n${JSON.stringify(classification, null, 2)}`;
    try {
      const result = await this.foundryClient.runAgent('confidenceGate', userMessage, toolContext);
      this.logger.debug(`[Agent 3] Clarifying question — ${result.latencyMs}ms`);
      const parsed = this.foundryClient.parseAgentResponse(result.content, (data) =>
        this.validateConfidenceResult(data),
      );
      return parsed.clarifyingQuestion?.trim() || result.content.trim() || fallback;
    } catch (error) {
      this.logger.warn(
        `Clarifying question generation failed, using fallback: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      return fallback;
    }
  }

  /**
   * True when the receiving department handles PHI or other regulated data, in
   * which case free-text model input/output must not be persisted to the
   * observability tables (AGENTS.md §12). Fails safe: if the team cannot be
   * resolved we redact.
   */
  private async isSensitiveDepartment(teamId: string): Promise<boolean> {
    try {
      const team = await this.prisma.team.findUnique({
        where: { id: teamId },
        select: { isSensitive: true },
      });
      return team?.isSensitive ?? true;
    } catch {
      return true;
    }
  }

  // ─── Main Pipeline ───────────────────────────────────────────────────

  async classifyAndCreateTicket(
    input: PipelineInput,
    user: AuthUser,
  ): Promise<PipelineResult> {
    const startTime = Date.now();
    this.logger.log(`AI Pipeline Start — Input: "${input.text.substring(0, 80)}${input.text.length > 80 ? '...' : ''}"`);

    // ⚠️ CARD 1.85: who this run may act as, decided here and passed down.
    const toolContext: ToolCallContext = {
      user,
      subjectId: input.userId ?? user.id,
    };

    // Track each agent's raw response for storage
    const pipelineSteps: Record<string, unknown>[] = [];
    // Ties every row this run writes across AiInferenceLog and RoutingDecisionLog.
    const correlationId = randomUUID();
    let gateThresholdUsed = 0;

    // Step 1: Extract intent
    let intent: IntentResult;
    let step1Raw: { content: string; toolCallsMade: string[]; latencyMs: number } | null = null;
    try {
      const userMessage = input.userId
        ? `User ID: ${input.userId}\n\nRequest:\n${input.text}`
        : `Request:\n${input.text}`;
      const result = await this.foundryClient.runAgent('intentExtractor', userMessage, toolContext);
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
      const result = await this.foundryClient.runAgent('departmentClassifier', step2Input, toolContext);
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

    // Step 3: Confidence gate — deterministic, in code.
    //
    // This step used to be an LLM call that was asked, in prose, to compute a
    // weighted average and compare it to a hardcoded threshold. Model
    // self-assessment is uncalibrated and the thresholds could not be tuned
    // without redeploying a Foundry agent. Scoring and the pass/fail decision
    // now live in ConfidenceGateService, where they are unit tested and driven
    // by configuration (env defaults + a per-department override column).
    //
    // Behaviour change: the gate no longer accepts an `adjustedClassification`.
    // A second model silently rewriting the classifier's output was not
    // auditable, and the routing decision log needs one authoritative
    // classification to score accuracy against.
    let confidence: ConfidenceResult;
    const step3Started = Date.now();
    try {
      const decision = await this.confidenceGate.evaluate(classification);
      gateThresholdUsed = decision.thresholdUsed;
      // The LLM is still the right tool for phrasing the question, so it is
      // called only when the gate has already decided to ask one.
      const clarifyingQuestion = decision.passed
        ? null
        : await this.generateClarifyingQuestion(intent, classification, toolContext);
      confidence = {
        passed: decision.passed,
        overallConfidence: decision.overallConfidence,
        clarifyingQuestion,
        adjustedClassification: null,
      };
      pipelineSteps.push({
        step: 3, agent: 'confidenceGate', status: 'success',
        latencyMs: Date.now() - step3Started, toolsCalled: [],
        input: JSON.stringify({ classification }),
        rawOutput: JSON.stringify(decision),
        parsed: confidence,
      });
      this.logger.debug(`→ Confidence: ${(decision.overallConfidence * 100).toFixed(0)}% vs threshold ${(decision.thresholdUsed * 100).toFixed(0)}% — ${decision.passed ? 'PASSED' : `NEEDS CLARIFICATION (${decision.reason})`}`);
    } catch (error) {
      pipelineSteps.push({
        step: 3, agent: 'confidenceGate', status: 'error',
        latencyMs: Date.now() - step3Started,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      this.logger.error('Confidence check failed', error);
      return {
        status: 'error',
        error: `Confidence check failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        step: 'confidence_check',
      };
    }

    const finalClassification = classification;

    // KB deflection: suggest relevant articles based on the classifier's output.
    const suggestedArticles = await this.getSuggestedArticles(
      intent,
      finalClassification,
      user,
    );

    // If confidence is too low, ask for clarification
    if (!confidence.passed) {
      const elapsed = Date.now() - startTime;
      this.logger.log(`Pipeline returning clarification question (${elapsed}ms total)`);
      // A triage route is a routing decision too — accuracy scoring needs the
      // rejections, not just the accepted routes.
      const redactTriageLogs = await this.isSensitiveDepartment(
        finalClassification.department.id,
      );
      this.observability.recordSteps(
        correlationId,
        null,
        pipelineSteps as unknown as PipelineStepRecord[],
        redactTriageLogs,
      );
      this.observability.recordRouting({
        correlationId,
        ticketId: null,
        predictedTeamId: finalClassification.department.id,
        confidence: confidence.overallConfidence,
        thresholdUsed: gateThresholdUsed,
        method: AiRoutingMethod.AI,
        alternatives: finalClassification.alternativeDepartments,
        accepted: false,
      });
      return {
        status: 'needs_clarification',
        question: confidence.clarifyingQuestion ?? 'Could you provide more details about your request?',
        partialClassification: finalClassification,
        suggestedArticles,
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
{"subject":"...","description":"...","priority":"SEV1|SEV2|SEV3|SEV4","channel":"PORTAL|EMAIL","assignedTeamId":"...","categoryId":"...|null","displayId":"...","tags":["..."]}`;

      const result = await this.foundryClient.runAgent('ticketGenerator', step4Input, toolContext);
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
            assignedTeamId: await this.resolveTeamId({
              id: ticketDraft?.assignedTeamId ?? undefined,
              name: finalClassification.department.name,
            }),
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

      // Durable, queryable observability alongside the TicketEvent trace. The
      // TicketEvent payload stays for backwards compatibility with
      // getAiAnalysis; these tables are what accuracy scoring reads. Both calls
      // are fire-and-forget and never block or fail the intake.
      const redactLogs = await this.isSensitiveDepartment(
        finalClassification.department.id,
      );
      this.observability.recordSteps(
        correlationId,
        ticketResult.data.id,
        pipelineSteps as unknown as PipelineStepRecord[],
        redactLogs,
      );
      this.observability.recordRouting({
        correlationId,
        ticketId: ticketResult.data.id,
        predictedTeamId: finalClassification.department.id,
        confidence: confidence.overallConfidence,
        thresholdUsed: gateThresholdUsed,
        method: AiRoutingMethod.AI,
        alternatives: finalClassification.alternativeDepartments,
        accepted: true,
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
        suggestedArticles,
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
    const toolContext: ToolCallContext = {
      user,
      subjectId: input.userId ?? user.id,
    };

    // Step 1: Intent Extraction
    const step1Input = input.userId
      ? `User ID: ${input.userId}\n\nRequest:\n${input.text}`
      : `Request:\n${input.text}`;

    let intent: IntentResult;
    try {
      const result = await this.foundryClient.runAgent('intentExtractor', step1Input, toolContext);
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
      const result = await this.foundryClient.runAgent('departmentClassifier', step2Input, toolContext);
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

    // Step 3: Confidence Gate — deterministic, mirrors classifyAndCreateTicket
    // so the debug view shows what production actually does.
    const step3Input = JSON.stringify({ classification }, null, 2);
    const step3Started = Date.now();
    let confidence: ConfidenceResult;
    try {
      const decision = await this.confidenceGate.evaluate(classification);
      const clarifyingQuestion = decision.passed
        ? null
        : await this.generateClarifyingQuestion(intent, classification, toolContext);
      confidence = {
        passed: decision.passed,
        overallConfidence: decision.overallConfidence,
        clarifyingQuestion,
        adjustedClassification: null,
      };
      steps.push({
        step: 3, name: 'Confidence Gate (deterministic)',
        agentName: 'confidence-gate-service',
        input: step3Input, rawOutput: JSON.stringify(decision, null, 2), parsed: confidence,
        toolsCalled: [], latencyMs: Date.now() - step3Started, status: 'success',
      });
    } catch (error) {
      steps.push({
        step: 3, name: 'Confidence Gate (deterministic)',
        agentName: 'confidence-gate-service',
        input: step3Input, rawOutput: '', parsed: null, toolsCalled: [],
        latencyMs: Date.now() - step3Started,
        status: 'error', error: error instanceof Error ? error.message : 'Unknown error',
      });
      return { steps, finalStatus: 'error', totalLatencyMs: Date.now() - startTime, errorMessage: `Step 3 failed: ${steps[2].error}` };
    }

    const finalClassification = classification;

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
{"subject":"...","description":"...","priority":"SEV1|SEV2|SEV3|SEV4","channel":"PORTAL|EMAIL","assignedTeamId":"...","categoryId":"...|null","displayId":"...","tags":["..."]}`;

    let ticketDraft: TicketDraft;
    try {
      const result = await this.foundryClient.runAgent('ticketGenerator', step4Input, toolContext);
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

  /**
   * What the classifier decided about a ticket (card 1.79).
   *
   * ⚠️ THIS READ WAS UNGUARDED: the controller took no `@CurrentUser` and
   * this took no user, so anybody signed in could ask about any ticket. It
   * leaked nothing only because the pipeline has never run - card 1.63 measured
   * zero rows against 461 tickets - which is luck, not a guard, and the fix is
   * not deferred on those grounds.
   *
   * ⚠️ 404, NOT 403, for a ticket this person cannot see, mirroring
   * `listEvents`: a 403 would confirm the ticket exists.
   *
   * ⚠️ `rawText` IS STRIPPED. It is the requester's verbatim message, kept on
   * the stored event for accuracy scoring, and an analysis panel has no reason
   * to hand it back - it is the field here most likely to carry something
   * somebody typed in a hurry, a credential included.
   *
   * @param ticketId The ticket to describe.
   * @param user The caller, whose visibility decides the answer.
   * @returns The classification payload without `rawText`, or null.
   */
  async getAiAnalysis(
    ticketId: string,
    user: AuthUser,
  ): Promise<Record<string, unknown> | null> {
    const visible = await this.prisma.ticket.findFirst({
      where: {
        id: ticketId,
        ...this.accessControl.buildTicketAccessFilter(user),
      },
      select: { id: true },
    });
    if (!visible) {
      throw new NotFoundException('Ticket not found');
    }

    const event = await this.prisma.ticketEvent.findFirst({
      where: { ticketId, type: 'AI_CLASSIFICATION' },
      select: { payload: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });

    if (!event || !event.payload) return null;
    const payload = event.payload as Record<string, unknown>;
    const { rawText, ...rest } = payload;
    void rawText;
    return rest;
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
