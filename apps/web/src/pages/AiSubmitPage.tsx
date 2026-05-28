import { useState, useCallback } from "react";
import { Link } from "react-router-dom";
import {
  Sparkles,
  AlertCircle,
  MessageSquare,
  BookOpen,
  ChevronRight,
} from "lucide-react";
import { ChatInput } from "../components/chat/ChatInput";
import { ExamplePrompts } from "../components/chat/ExamplePrompts";
import { ProcessingSteps } from "../components/chat/ProcessingSteps";
import { TicketCreated } from "../components/chat/TicketCreated";
import {
  classifyTicket,
  type AiClassifyResult,
  type AiClassifyResultCreated,
  type AiSuggestedArticle,
} from "../api/client";
import { useTicketDataInvalidation } from "../contexts/TicketDataInvalidationContext";

function SuggestedArticles({
  articles,
  heading,
}: {
  articles: AiSuggestedArticle[];
  heading: string;
}) {
  if (!articles.length) return null;
  return (
    <div className="rounded-xl border border-blue-200 bg-blue-50/60 p-4 dark:border-blue-500/30 dark:bg-blue-500/10">
      <div className="mb-2 flex items-center gap-2">
        <BookOpen className="h-4 w-4 text-primary" />
        <p className="text-sm font-semibold text-foreground">{heading}</p>
      </div>
      <div className="space-y-1.5">
        {articles.map((a) => (
          <Link
            key={a.id}
            to={`/help/${a.slug}`}
            className="flex items-center justify-between gap-3 rounded-lg bg-card px-3 py-2 text-sm hover:bg-muted"
          >
            <div className="min-w-0">
              <span className="font-medium text-foreground">{a.title}</span>
              {a.summary && (
                <p className="line-clamp-1 text-xs text-muted-foreground">
                  {a.summary}
                </p>
              )}
            </div>
            <ChevronRight className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
          </Link>
        ))}
      </div>
    </div>
  );
}

type Phase = "input" | "processing" | "created" | "clarification" | "error";

interface ProcessingStep {
  name: string;
  status: "pending" | "running" | "done" | "error";
  detail?: string;
}

const PIPELINE_STEPS: string[] = [
  "Extracting Intent",
  "Classifying Department",
  "Checking Confidence",
  "Creating Ticket",
];

export function AiSubmitPage() {
  const [phase, setPhase] = useState<Phase>("input");
  const [defaultText, setDefaultText] = useState("");
  const [processingSteps, setProcessingSteps] = useState<ProcessingStep[]>([]);
  const [result, setResult] = useState<AiClassifyResult | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [clarificationQuestion, setClarificationQuestion] = useState("");
  const [originalText, setOriginalText] = useState("");
  const { notifyTicketAggregatesChanged, notifyTicketReportsChanged } =
    useTicketDataInvalidation();

  const simulateStepProgress = useCallback(() => {
    // Initialize all steps as pending
    const steps = PIPELINE_STEPS.map((name) => ({
      name,
      status: "pending" as const,
    }));
    setProcessingSteps(steps);

    // Animate steps one by one, but keep last step as "running"
    let currentStep = 0;
    const interval = setInterval(() => {
      if (currentStep >= PIPELINE_STEPS.length) {
        clearInterval(interval);
        return;
      }
      setProcessingSteps((prev) =>
        prev.map((s, i) => {
          if (i < currentStep) return { ...s, status: "done" };
          if (i === currentStep) return { ...s, status: "running" };
          return s;
        }),
      );
      currentStep++;
    }, 2000);

    return () => clearInterval(interval);
  }, []);

  const handleSubmit = useCallback(
    async (text: string) => {
      setOriginalText(text);
      setPhase("processing");
      const cleanup = simulateStepProgress();

      try {
        const response = await classifyTicket({ text });
        cleanup();
        setResult(response);

        // Transition immediately — don't linger on completed steps
        if (response.status === "created") {
          setPhase("created");
          // Refresh sidebar saved-view counts and reports so the new
          // ticket shows up in "SEV1 today" / "Awaiting reply" / etc.
          notifyTicketAggregatesChanged();
          notifyTicketReportsChanged();
        } else if (response.status === "needs_clarification") {
          setClarificationQuestion(response.question);
          setPhase("clarification");
        } else {
          setErrorMessage(response.error);
          setPhase("error");
        }
      } catch (err) {
        cleanup();
        setProcessingSteps((prev) =>
          prev.map((s, i) =>
            i === prev.findIndex((p) => p.status === "running")
              ? { ...s, status: "error" }
              : s,
          ),
        );
        setErrorMessage(
          err instanceof Error ? err.message : "Pipeline failed",
        );
        setPhase("error");
      }
    },
    [
      simulateStepProgress,
      notifyTicketAggregatesChanged,
      notifyTicketReportsChanged,
    ],
  );

  const handleClarificationSubmit = useCallback(
    (text: string) => {
      // Re-submit with the clarification appended to original text
      const combined = `${originalText}\n\nAdditional context: ${text}`;
      handleSubmit(combined);
    },
    [originalText, handleSubmit],
  );

  const handleNewTicket = useCallback(() => {
    setPhase("input");
    setResult(null);
    setDefaultText("");
    setErrorMessage("");
    setClarificationQuestion("");
    setOriginalText("");
    setProcessingSteps([]);
  }, []);

  const handleExampleSelect = useCallback((text: string) => {
    setDefaultText(text);
  }, []);

  const createdResult = result as AiClassifyResultCreated | undefined;
  const suggestions: AiSuggestedArticle[] =
    result && result.status !== "error"
      ? (result.suggestedArticles ?? [])
      : [];

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-4 py-8 space-y-6">
          {/* Header */}
          <div className="text-center space-y-2">
            <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
              <Sparkles className="h-6 w-6 text-primary" />
            </div>
            <h1 className="text-xl font-semibold">How can we help?</h1>
            <p className="text-sm text-muted-foreground">
              Describe your issue or request in plain language. Our AI will
              classify and route it to the right team.
            </p>
          </div>

          {/* Input Phase */}
          {phase === "input" && (
            <div className="space-y-4">
              <ChatInput
                onSubmit={handleSubmit}
                isLoading={false}
                defaultValue={defaultText}
              />
              <ExamplePrompts onSelect={handleExampleSelect} />
            </div>
          )}

          {/* Processing Phase */}
          {phase === "processing" && (
            <div className="rounded-xl border border-border bg-card">
              <ProcessingSteps steps={processingSteps} />
            </div>
          )}

          {/* Created Phase */}
          {phase === "created" && createdResult?.status === "created" && (
            <>
            {suggestions.length > 0 && (
              <SuggestedArticles
                articles={suggestions}
                heading="Related help articles"
              />
            )}
            <TicketCreated
              ticket={{
                id: createdResult.ticket.id,
                number: createdResult.ticket.number,
                displayId: createdResult.ticket.displayId,
                subject: createdResult.ticket.subject,
                description: createdResult.ticket.description,
                priority: createdResult.ticket.priority,
              }}
              classification={
                createdResult.aiAnalysis
                  ? {
                      department: createdResult.aiAnalysis.department,
                      departmentConfidence:
                        createdResult.aiAnalysis.departmentConfidence,
                      category: createdResult.aiAnalysis.category,
                      intent: createdResult.aiAnalysis.intent,
                      requestType: createdResult.aiAnalysis.requestType,
                      reasoning: createdResult.aiAnalysis.reasoning,
                      urgency: createdResult.aiAnalysis.urgency,
                      routingMethod: "ai_classification",
                    }
                  : createdResult.aiMetadata
                    ? {
                        department: "Classified by AI",
                        departmentConfidence:
                          createdResult.aiMetadata.classificationConfidence,
                        category: null,
                        intent: createdResult.ticket.subject,
                        requestType: "SERVICE_REQUEST",
                        reasoning: createdResult.aiMetadata.reasoning,
                        urgency: "See ticket details",
                        routingMethod: "ai_classification",
                      }
                    : undefined
              }
              onNewTicket={handleNewTicket}
            />
            </>
          )}

          {/* Clarification Phase */}
          {phase === "clarification" && (
            <div className="space-y-4">
              <div className="rounded-xl border border-border bg-card p-4 space-y-3">
                <div className="flex items-start gap-3">
                  <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <MessageSquare className="h-4 w-4 text-primary" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">
                      Need a bit more information
                    </p>
                    <p className="text-sm text-muted-foreground mt-1">
                      {clarificationQuestion}
                    </p>
                  </div>
                </div>
              </div>
              {suggestions.length > 0 && (
                <SuggestedArticles
                  articles={suggestions}
                  heading="These articles might already answer your question"
                />
              )}
              <ChatInput
                onSubmit={handleClarificationSubmit}
                isLoading={false}
                placeholder="Provide more details..."
              />
            </div>
          )}

          {/* Error Phase */}
          {phase === "error" && (
            <div className="space-y-4">
              <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4">
                <div className="flex items-start gap-3">
                  <AlertCircle className="h-5 w-5 text-destructive flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-destructive">
                      Something went wrong
                    </p>
                    <p className="text-sm text-muted-foreground mt-1">
                      {errorMessage}
                    </p>
                  </div>
                </div>
              </div>
              <button
                onClick={handleNewTicket}
                className="w-full px-4 py-2 rounded-lg border border-border text-sm font-medium hover:bg-accent transition-colors"
              >
                Try Again
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
