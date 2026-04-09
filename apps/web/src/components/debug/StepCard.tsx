import { useState } from "react";
import {
  Check,
  AlertCircle,
  ChevronDown,
  ChevronRight,
  Wrench,
} from "lucide-react";
import type { AiPipelineStep } from "../../api/client";

const STEP_COLORS: Record<number, string> = {
  1: "border-blue-500/30",
  2: "border-purple-500/30",
  3: "border-orange-500/30",
  4: "border-green-500/30",
  5: "border-cyan-500/30",
};

export function StepCard({ step }: { step: AiPipelineStep }) {
  const [showInput, setShowInput] = useState(false);
  const [showOutput, setShowOutput] = useState(false);

  const borderColor = STEP_COLORS[step.step] ?? "border-border";

  return (
    <div className={`rounded-xl border ${borderColor} bg-card overflow-hidden`}>
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border/50">
        <div className="flex items-center justify-center h-6 w-6 rounded-full bg-muted text-xs font-bold">
          {step.step}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">{step.name}</span>
            <span className="text-xs text-muted-foreground">
              {step.agentName}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs">
          {step.toolsCalled.length > 0 && (
            <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
              <Wrench className="h-3 w-3" />
              {step.toolsCalled.length} tools
            </span>
          )}
          <span className="text-muted-foreground">{step.latencyMs}ms</span>
          {step.status === "success" ? (
            <Check className="h-4 w-4 text-green-500" />
          ) : (
            <AlertCircle className="h-4 w-4 text-destructive" />
          )}
        </div>
      </div>

      {/* Tool call badges */}
      {step.toolsCalled.length > 0 ? (
        <div className="px-4 py-2 border-b border-border/50 flex flex-wrap gap-1.5">
          {step.toolsCalled.map((tool, i) => (
            <span
              key={i}
              className="px-2 py-0.5 text-xs rounded-full bg-primary/10 text-primary font-mono"
            >
              {tool}()
            </span>
          ))}
        </div>
      ) : null}

      {/* Error message */}
      {step.error && (
        <div className="px-4 py-2 bg-destructive/5 text-sm text-destructive">
          {step.error}
        </div>
      )}

      {/* Summary (parsed result) */}
      {step.parsed ? (
        <div className="px-4 py-3 text-sm">
          <StepSummary step={step.step} parsed={step.parsed} />
        </div>
      ) : null}

      {/* Collapsible sections */}
      <div className="border-t border-border/50">
        <button
          onClick={() => setShowInput(!showInput)}
          className="flex items-center gap-2 w-full px-4 py-2 text-xs text-muted-foreground hover:bg-accent transition-colors"
        >
          {showInput ? (
            <ChevronDown className="h-3 w-3" />
          ) : (
            <ChevronRight className="h-3 w-3" />
          )}
          Input to Agent
        </button>
        {showInput && (
          <pre className="px-4 pb-3 text-xs text-muted-foreground overflow-x-auto whitespace-pre-wrap max-h-48 overflow-y-auto">
            {step.input}
          </pre>
        )}
      </div>

      <div className="border-t border-border/50">
        <button
          onClick={() => setShowOutput(!showOutput)}
          className="flex items-center gap-2 w-full px-4 py-2 text-xs text-muted-foreground hover:bg-accent transition-colors"
        >
          {showOutput ? (
            <ChevronDown className="h-3 w-3" />
          ) : (
            <ChevronRight className="h-3 w-3" />
          )}
          Agent Response
        </button>
        {showOutput && (
          <pre className="px-4 pb-3 text-xs text-muted-foreground overflow-x-auto whitespace-pre-wrap max-h-48 overflow-y-auto">
            {typeof step.parsed === "object"
              ? JSON.stringify(step.parsed, null, 2)
              : step.rawOutput}
          </pre>
        )}
      </div>
    </div>
  );
}

function StepSummary({ step, parsed }: { step: number; parsed: unknown }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = parsed as Record<string, any>;

  if (step === 1) {
    // Intent extraction
    return (
      <div className="space-y-1">
        <div>
          <span className="text-muted-foreground">Intent:</span>{" "}
          {String(data.intent ?? "")}
        </div>
        <div>
          <span className="text-muted-foreground">Type:</span>{" "}
          {String(data.requestType ?? "")}
        </div>
        {Array.isArray(data.urgencySignals) &&
          data.urgencySignals.length > 0 && (
            <div>
              <span className="text-muted-foreground">Urgency:</span>{" "}
              <span className="text-orange-400">
                {data.urgencySignals.join(", ")}
              </span>
            </div>
          )}
        {data.affectedSystem && (
          <div>
            <span className="text-muted-foreground">Affected System:</span>{" "}
            {String(data.affectedSystem)}
          </div>
        )}
      </div>
    );
  }

  if (step === 2) {
    // Department classification
    const dept = data.department as Record<string, unknown> | undefined;
    return (
      <div className="space-y-1">
        <div>
          <span className="text-muted-foreground">Department:</span>{" "}
          {String(dept?.name ?? "Unknown")} (
          {((Number(dept?.confidence ?? 0) * 100).toFixed(0))}%)
        </div>
        {data.suggestedPriority && (
          <div>
            <span className="text-muted-foreground">Priority:</span>{" "}
            {String(data.suggestedPriority)}
          </div>
        )}
        {Array.isArray(data.tags) && data.tags.length > 0 && (
          <div>
            <span className="text-muted-foreground">Tags:</span>{" "}
            {data.tags.join(", ")}
          </div>
        )}
        {data.reasoning && (
          <div className="text-muted-foreground italic text-xs">
            {String(data.reasoning)}
          </div>
        )}
      </div>
    );
  }

  if (step === 3) {
    // Confidence gate
    return (
      <div className="space-y-1">
        <div>
          <span className="text-muted-foreground">Overall Confidence:</span>{" "}
          {((Number(data.overallConfidence ?? 0)) * 100).toFixed(0)}%
        </div>
        <div>
          <span className="text-muted-foreground">Decision:</span>{" "}
          <span
            className={data.passed ? "text-green-400" : "text-orange-400"}
          >
            {data.passed ? "PASSED" : "NEEDS CLARIFICATION"}
          </span>
        </div>
        {data.clarifyingQuestion && (
          <div className="text-orange-400 italic">
            &ldquo;{String(data.clarifyingQuestion)}&rdquo;
          </div>
        )}
      </div>
    );
  }

  if (step === 4) {
    // Ticket generation
    return (
      <div className="space-y-1">
        <div>
          <span className="text-muted-foreground">Subject:</span>{" "}
          {String(data.subject ?? "")}
        </div>
        <div>
          <span className="text-muted-foreground">Priority:</span>{" "}
          {String(data.priority ?? "")}
        </div>
        {data.displayId && (
          <div>
            <span className="text-muted-foreground">Display ID:</span>{" "}
            {String(data.displayId)}
          </div>
        )}
      </div>
    );
  }

  if (step === 5) {
    // Save to database
    return (
      <div className="space-y-1">
        <div>
          <span className="text-muted-foreground">Ticket ID:</span>{" "}
          {String(data.ticketId ?? data.id ?? "")}
        </div>
        <div>
          <span className="text-muted-foreground">Number:</span>{" "}
          {String(data.ticketNumber ?? data.number ?? "")}
        </div>
        <div>
          <span className="text-muted-foreground">Display ID:</span>{" "}
          {String(data.displayId ?? "")}
        </div>
      </div>
    );
  }

  return (
    <pre className="text-xs text-muted-foreground">
      {JSON.stringify(data, null, 2)}
    </pre>
  );
}
