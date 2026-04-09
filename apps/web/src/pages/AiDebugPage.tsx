import { useState } from "react";
import { Bug } from "lucide-react";
import { PipelineInputForm } from "../components/debug/PipelineInputForm";
import { StepCard } from "../components/debug/StepCard";
import { PipelineResult } from "../components/debug/PipelineResult";
import { debugPipeline, type AiDebugResult } from "../api/client";

export function AiDebugPage() {
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<AiDebugResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(text: string, userId?: string) {
    setIsLoading(true);
    setResult(null);
    setError(null);

    try {
      const response = await debugPipeline({ text, userId, createTicket: true });
      setResult(response);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Pipeline debug failed");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
          {/* Header */}
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-orange-500/10 flex items-center justify-center">
              <Bug className="h-5 w-5 text-orange-500" />
            </div>
            <div>
              <h1 className="text-lg font-semibold">Pipeline Debug</h1>
              <p className="text-sm text-muted-foreground">
                Test the AI classification pipeline step-by-step
              </p>
            </div>
          </div>

          {/* Input Form */}
          <div className="rounded-xl border border-border bg-card p-4">
            <PipelineInputForm onSubmit={handleSubmit} isLoading={isLoading} />
          </div>

          {/* Error */}
          {error && (
            <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
              {error}
            </div>
          )}

          {/* Results */}
          {result && (
            <div className="space-y-4">
              {/* Pipeline Result summary */}
              <PipelineResult result={result} />

              {/* Step cards */}
              <div className="space-y-3">
                <h2 className="text-sm font-medium text-muted-foreground">
                  Step-by-Step Output
                </h2>
                {result.steps.map((step) => (
                  <StepCard key={step.step} step={step} />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
