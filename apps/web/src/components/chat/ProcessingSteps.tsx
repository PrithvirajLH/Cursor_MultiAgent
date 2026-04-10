import { Check, Loader2, AlertCircle } from "lucide-react";

interface ProcessingStep {
  name: string;
  status: "pending" | "running" | "done" | "error";
  detail?: string;
}

interface ProcessingStepsProps {
  steps: ProcessingStep[];
}

export function ProcessingSteps({ steps }: ProcessingStepsProps) {
  return (
    <div className="space-y-3 py-4">
      <p className="text-sm text-muted-foreground text-center mb-4">
        Analyzing your request...
      </p>
      {steps.map((step, i) => (
        <div key={i} className="flex items-center gap-3 px-4">
          <div className="flex-shrink-0">
            {step.status === "done" && (
              <div className="h-6 w-6 rounded-full bg-green-500/10 flex items-center justify-center">
                <Check className="h-3.5 w-3.5 text-green-500" />
              </div>
            )}
            {step.status === "running" && (
              <div className="h-6 w-6 rounded-full bg-primary/10 flex items-center justify-center">
                <Loader2 className="h-3.5 w-3.5 text-primary animate-spin" />
              </div>
            )}
            {step.status === "error" && (
              <div className="h-6 w-6 rounded-full bg-destructive/10 flex items-center justify-center">
                <AlertCircle className="h-3.5 w-3.5 text-destructive" />
              </div>
            )}
            {step.status === "pending" && (
              <div className="h-6 w-6 rounded-full bg-muted flex items-center justify-center">
                <div className="h-2 w-2 rounded-full bg-muted-foreground/40" />
              </div>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p
              className={`text-sm font-medium ${
                step.status === "running"
                  ? "text-primary"
                  : step.status === "done"
                    ? "text-foreground"
                    : step.status === "error"
                      ? "text-destructive"
                      : "text-muted-foreground"
              }`}
            >
              {step.name}
            </p>
            {step.detail && (
              <p className="text-xs text-muted-foreground truncate">{step.detail}</p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
