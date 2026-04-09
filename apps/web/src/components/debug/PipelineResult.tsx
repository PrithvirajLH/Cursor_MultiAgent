import { CheckCircle2, HelpCircle, XCircle, Clock } from "lucide-react";
import type { AiDebugResult } from "../../api/client";

export function PipelineResult({ result }: { result: AiDebugResult }) {
  const statusConfig = {
    created: {
      icon: CheckCircle2,
      label: "TICKET CREATED",
      color: "text-green-500",
      bg: "bg-green-500/5 border-green-500/20",
    },
    needs_clarification: {
      icon: HelpCircle,
      label: "NEEDS CLARIFICATION",
      color: "text-orange-500",
      bg: "bg-orange-500/5 border-orange-500/20",
    },
    error: {
      icon: XCircle,
      label: "PIPELINE ERROR",
      color: "text-destructive",
      bg: "bg-destructive/5 border-destructive/20",
    },
  };

  const config = statusConfig[result.finalStatus];
  const Icon = config.icon;

  return (
    <div className={`rounded-xl border ${config.bg} p-4 space-y-3`}>
      <div className="flex items-center gap-3">
        <Icon className={`h-5 w-5 ${config.color}`} />
        <span className={`text-sm font-bold ${config.color}`}>
          {config.label}
        </span>
        <span className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
          <Clock className="h-3 w-3" />
          {result.totalLatencyMs}ms total
        </span>
      </div>

      {result.finalStatus === "created" && result.ticket && (
        <div className="text-sm space-y-1">
          <div>
            <span className="text-muted-foreground">Subject:</span>{" "}
            {String(result.ticket.subject ?? "")}
          </div>
          <div>
            <span className="text-muted-foreground">Priority:</span>{" "}
            {String(result.ticket.priority ?? "")}
          </div>
          <div>
            <span className="text-muted-foreground">Display ID:</span>{" "}
            {String(result.ticket.displayId ?? "")}
          </div>
        </div>
      )}

      {result.finalStatus === "needs_clarification" &&
        result.clarifyingQuestion && (
          <p className="text-sm text-orange-400 italic">
            &ldquo;{result.clarifyingQuestion}&rdquo;
          </p>
        )}

      {result.finalStatus === "error" && result.errorMessage && (
        <p className="text-sm text-destructive">{result.errorMessage}</p>
      )}
    </div>
  );
}
