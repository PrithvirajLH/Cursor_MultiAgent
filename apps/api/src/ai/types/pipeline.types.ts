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
  error: string;
  step: 'intent_extraction' | 'department_classification' | 'confidence_check' | 'ticket_generation';
}

export type PipelineResult = PipelineSuccess | PipelineClarification | PipelineError;

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
