// ─── Pipeline Input ──────────────────────────────────────────────────────────

export interface PipelineInput {
  text: string;
  userId?: string;
  channel?: 'PORTAL' | 'EMAIL';
}

// ─── Agent 1: Intent Extractor Output ────────────────────────────────────────

export interface IntentResult {
  intent: string;
  requestType: 'INCIDENT' | 'SERVICE_REQUEST' | 'QUESTION';
  entities: {
    people: string[];
    systems: string[];
    dates: string[];
    amounts: string[];
    devices: string[];
    other: string[];
  };
  urgencySignals: string[];
  affectedSystem: string | null;
  rawText: string;
}

// ─── Agent 2: Department Classifier Output ───────────────────────────────────

export interface DepartmentMatch {
  id: string;
  name: string;
  confidence: number;
}

export interface ClassificationResult {
  department: DepartmentMatch;
  category: DepartmentMatch | null;
  subcategory: DepartmentMatch | null;
  suggestedPriority: 'SEV1' | 'SEV2' | 'SEV3' | 'SEV4';
  tags: string[];
  isMultiDepartment: boolean;
  alternativeDepartments: DepartmentMatch[];
  reasoning: string;
}

/**
 * What classifying an unrouted inbound email decided (card 1.63).
 *
 * ⚠️ DELIBERATELY NOT A `ClassificationResult`. The caller is the mailbox
 * worker, which needs one question answered - *"which team, if any"* - and has
 * no business knowing about intents, categories or alternative departments. A
 * narrow return type is also what keeps the AI out of the ingest path's
 * decisions: everything below the gate collapses to `routed: false`, and the
 * worker does exactly what it did before this card.
 */
export type InboundDepartmentRoute =
  | {
      routed: true;
      teamId: string;
      teamName: string;
      confidence: number;
      thresholdUsed: number;
    }
  | {
      routed: false;
      /** Why, for the log and for the ticket event. Never a guess. */
      reason:
        | 'pipeline_disabled'
        | 'below_threshold'
        | 'multi_department'
        | 'unknown_department'
        | 'error';
      confidence?: number;
      thresholdUsed?: number;
    };

// ─── Agent 3: Confidence Gate Output ─────────────────────────────────────────

export interface ConfidenceResult {
  passed: boolean;
  overallConfidence: number;
  clarifyingQuestion: string | null;
  adjustedClassification: ClassificationResult | null;
}

// ─── Agent 4: Ticket Draft ──────────────────────────────────────────────────

export interface TicketDraft {
  subject: string;
  description: string;
  priority: 'SEV1' | 'SEV2' | 'SEV3' | 'SEV4';
  channel: 'PORTAL' | 'EMAIL';
  assignedTeamId: string | null;
  categoryId: string | null;
  displayId: string;
  tags: string[];
}

// ─── AI Metadata ────────────────────────────────────────────────────────────

export interface AiMetadata {
  intentConfidence: number;
  classificationConfidence: number;
  overallConfidence: number;
  reasoning: string;
  pipelineLatencyMs: number;
  modelUsed: string;
}

// ─── AI Analysis (stored in TicketEvent payload) ────────────────────────────

export interface AiAnalysis {
  what: string;
  who: string;
  context: string;
  urgency: string;
  intent: string;
  requestType: string;
  department: string;
  departmentConfidence: number;
  category: string | null;
  reasoning: string;
  routingMethod?: string;
  matchedRule?: string | null;
}

// ─── Pipeline Results ───────────────────────────────────────────────────────

export interface SuggestedArticle {
  id: string;
  title: string;
  slug: string;
  summary: string | null;
}

export interface PipelineSuccess {
  status: 'created';
  suggestedArticles?: SuggestedArticle[];
  ticket: {
    id: string;
    number: number;
    displayId: string | null;
    subject: string;
    description: string;
    status: string;
    priority: string;
    channel: string;
    requesterId: string;
    assignedTeamId: string | null;
    categoryId: string | null;
  };
  aiMetadata: AiMetadata;
  aiAnalysis: AiAnalysis;
}

export interface PipelineClarification {
  status: 'needs_clarification';
  question: string;
  partialClassification: ClassificationResult;
  suggestedArticles?: SuggestedArticle[];
}

export interface PipelineError {
  status: 'error';
  /**
   * ⚠️ CARD 1.107: GENERIC, AND DELIBERATELY SO. This used to interpolate
   * `error.message` straight from the Azure SDK - endpoint hostnames,
   * deployment and model names, region, request ids, quota and billing states,
   * sometimes a fragment of the failing request - and `POST /api/ai/classify`
   * has no role guard, so any EMPLOYEE could read it.
   */
  error: string;
  step: 'intent_extraction' | 'department_classification' | 'confidence_check' | 'ticket_generation';
  /**
   * The request id from `correlationIdMiddleware`, so somebody reporting "the
   * AI failed" can be matched to the full error in the log. Not a second id -
   * the same one the HTTP log line carries.
   */
  correlationId?: string;
}

/**
 * The pipeline is switched off (card 1.106).
 *
 * ⚠️ ITS OWN STATUS, NOT AN ERROR, AND THAT DISTINCTION IS THE POINT. A
 * disabled pipeline is working exactly as configured; an errored one is not.
 * Collapsing them would mean an operator who switched the AI off could not tell
 * their own change from a Foundry outage, and every caller would render a
 * failure for a deliberate act.
 */
export interface PipelineDisabled {
  status: 'disabled';
  /** Why, in words a UI can show without interpretation. */
  reason: string;
}

export type PipelineResult =
  | PipelineSuccess
  | PipelineClarification
  | PipelineError
  | PipelineDisabled;

// ─── Debug Pipeline Types ───────────────────────────────────────────────────

export interface StepResult {
  step: number;
  name: string;
  agentName: string;
  input: string;
  rawOutput: string;
  parsed: unknown;
  toolsCalled: string[];
  latencyMs: number;
  status: 'success' | 'error';
  error?: string;
}

export interface DebugPipelineResult {
  steps: StepResult[];
  finalStatus: 'created' | 'needs_clarification' | 'error';
  totalLatencyMs: number;
  ticket?: Record<string, unknown>;
  clarifyingQuestion?: string;
  errorMessage?: string;
}

// ─── Foundry Client Types ───────────────────────────────────────────────────

export type AgentStep =
  | 'intentExtractor'
  | 'departmentClassifier'
  | 'confidenceGate'
  | 'ticketGenerator';

export interface AgentRunResult {
  content: string;
  toolCallsMade: string[];
  latencyMs: number;
}

// ─── Tool Types ─────────────────────────────────────────────────────────────

export type ToolSuccess<T> = { success: true; data: T };
export type ToolFailure = { success: false; error: string };
export type ToolResult<T> = ToolSuccess<T> | ToolFailure;

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}
