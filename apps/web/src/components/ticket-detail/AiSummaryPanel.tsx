import { useState, useEffect } from "react";
import {
  Sparkles,
  ChevronDown,
  ChevronRight,
  Brain,
  Building2,
  Tag,
  User,
  AlertTriangle,
  FolderOpen,
  Route,
} from "lucide-react";
import { fetchAiAnalysis } from "../../api/client";

interface AiSummaryPanelProps {
  ticketId: string;
}

interface AiAnalysisData {
  aiAnalysis?: {
    what?: string;
    who?: string;
    context?: string;
    urgency?: string;
    intent?: string;
    requestType?: string;
    department?: string;
    departmentConfidence?: number;
    category?: string | null;
    reasoning?: string;
    routingMethod?: string;
    matchedRule?: string | null;
  };
  tags?: string[];
  source?: string;
  rawText?: string;
}

export function AiSummaryPanel({ ticketId }: AiSummaryPanelProps) {
  const [data, setData] = useState<AiAnalysisData | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchAiAnalysis(ticketId)
      .then((res) => {
        if (res.data) {
          setData(res.data as AiAnalysisData);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [ticketId]);

  if (loading || !data?.aiAnalysis) return null;

  const analysis = data.aiAnalysis;
  const confidence = analysis.departmentConfidence ?? 0;
  const pct = Math.round(confidence * 100);

  const hasUrgency =
    !!analysis.urgency && analysis.urgency !== "None indicated";

  return (
    <div className="rounded-xl border border-border shadow-card bg-card">
      {/* ── Gradient header ── */}
      <button
        onClick={() => setExpanded(!expanded)}
        className={`w-full flex items-center gap-3 px-4 py-3.5 text-left transition-colors ${expanded ? "rounded-t-xl" : "rounded-xl"}`}
        style={{
          background:
            "linear-gradient(135deg, hsl(var(--primary) / 0.08) 0%, hsl(270 60% 60% / 0.06) 100%)",
        }}
      >
        <div
          className="h-8 w-8 rounded-lg flex items-center justify-center flex-shrink-0 shadow-sm"
          style={{
            background:
              "linear-gradient(135deg, hsl(var(--primary)) 0%, hsl(270 60% 58%) 100%)",
          }}
        >
          <Sparkles className="h-4 w-4 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <span className="text-[13px] font-semibold text-foreground">
            AI Classification
          </span>
        </div>
        <ConfidenceRing pct={pct} />
        {expanded ? (
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
        )}
      </button>

      {/* ── Collapsed preview ── */}
      {!expanded && analysis.what && (
        <div className="px-4 py-2.5 bg-card">
          <p className="text-xs text-muted-foreground line-clamp-2">
            {analysis.what}
          </p>
        </div>
      )}

      {/* ── Expanded body ── */}
      {expanded && (
        <div className="bg-card">
          {/* Summary quote */}
          {analysis.what && (
            <div className="px-4 py-3.5 border-b border-border/50">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                Summary
              </p>
              <div className="flex gap-2.5">
                <div className="w-[3px] flex-shrink-0 rounded-full bg-gradient-to-b from-primary to-violet-500" />
                <p className="text-[13px] leading-relaxed text-foreground/85">
                  {analysis.what}
                </p>
              </div>
            </div>
          )}

          {/* Classification chips */}
          <div className="px-4 py-3.5 space-y-2 border-b border-border/50">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Classification
            </p>
            <div className="flex flex-wrap gap-2">
              {analysis.department && (
                <Chip
                  icon={Building2}
                  label={analysis.department}
                  colorClass="bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-500/10 dark:text-indigo-400 dark:border-indigo-500/20"
                />
              )}
              {analysis.requestType && (
                <Chip
                  icon={Tag}
                  label={formatRequestType(analysis.requestType)}
                  colorClass="bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-500/10 dark:text-violet-400 dark:border-violet-500/20"
                />
              )}
              {analysis.category && (
                <Chip
                  icon={FolderOpen}
                  label={analysis.category}
                  colorClass="bg-cyan-50 text-cyan-700 border-cyan-200 dark:bg-cyan-500/10 dark:text-cyan-400 dark:border-cyan-500/20"
                />
              )}
              {hasUrgency && (
                <Chip
                  icon={AlertTriangle}
                  label={analysis.urgency!}
                  colorClass="bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/20"
                />
              )}
            </div>

            {/* Requester + routing row */}
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              {analysis.who && (
                <span className="flex items-center gap-1">
                  <User className="h-3 w-3" />
                  {analysis.who}
                </span>
              )}
              {analysis.routingMethod && (
                <span className="flex items-center gap-1">
                  <Route className="h-3 w-3" />
                  {analysis.routingMethod.replace(/_/g, " ")}
                </span>
              )}
            </div>
          </div>

          {/* AI Reasoning */}
          {analysis.reasoning && (
            <div className="px-4 py-3.5 border-b border-border/50">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                AI Reasoning
              </p>
              <div className="rounded-lg bg-purple-50 border border-purple-100 dark:bg-purple-500/5 dark:border-purple-500/10 p-3">
                <div className="flex items-start gap-2.5">
                  <Brain className="h-3.5 w-3.5 text-purple-500 dark:text-purple-400 flex-shrink-0 mt-0.5" />
                  <p className="text-xs leading-relaxed text-purple-900/70 dark:text-purple-300/80 italic">
                    {analysis.reasoning}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Tags */}
          {data.tags && data.tags.length > 0 && (
            <div className="px-4 py-3.5">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                Tags
              </p>
              <div className="flex flex-wrap gap-1.5">
                {data.tags.map((tag) => (
                  <span
                    key={tag}
                    className="px-2.5 py-1 text-[11px] font-semibold rounded-lg border bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-500/10 dark:text-sky-400 dark:border-sky-500/20"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Confidence ring (mini donut) ── */
function ConfidenceRing({ pct }: { pct: number }) {
  const size = 32;
  const stroke = 3;
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ - (pct / 100) * circ;

  const color =
    pct >= 90
      ? "stroke-emerald-500"
      : pct >= 70
        ? "stroke-blue-500"
        : "stroke-amber-500";

  return (
    <div className="relative flex items-center justify-center flex-shrink-0">
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          className="stroke-border"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          className={color}
          strokeWidth={stroke}
          strokeDasharray={circ}
          strokeDashoffset={offset}
          strokeLinecap="round"
        />
      </svg>
      <span className="absolute text-[9px] font-bold text-foreground">
        {pct}
      </span>
    </div>
  );
}

/* ── Colored chip with icon ── */
function Chip({
  icon: Icon,
  label,
  colorClass,
}: {
  icon: typeof Building2;
  label: string;
  colorClass: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold border ${colorClass}`}
    >
      <Icon className="h-3 w-3 flex-shrink-0" />
      {label}
    </span>
  );
}

function formatRequestType(type: string): string {
  return type
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/^\w/, (c) => c.toUpperCase());
}
