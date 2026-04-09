import { useNavigate } from "react-router-dom";
import { CheckCircle2, Plus, ArrowRight, Sparkles } from "lucide-react";

interface TicketCreatedProps {
  ticket: {
    id: string;
    number: number;
    displayId: string | null;
    subject: string;
    description?: string;
    priority: string;
    tags?: string[];
  };
  classification?: {
    department: string;
    departmentConfidence: number;
    category: string | null;
    intent: string;
    requestType: string;
    reasoning: string;
    urgency: string;
    routingMethod?: string;
  };
  onNewTicket: () => void;
}

const PRIORITY_STYLES: Record<string, string> = {
  P1: "bg-red-500/10 text-red-400 border-red-500/20",
  P2: "bg-orange-500/10 text-orange-400 border-orange-500/20",
  P3: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  P4: "bg-zinc-500/10 text-zinc-400 border-zinc-500/20",
};

export function TicketCreated({
  ticket,
  classification,
  onNewTicket,
}: TicketCreatedProps) {
  const navigate = useNavigate();

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Success header */}
      <div className="text-center space-y-2">
        <CheckCircle2 className="h-10 w-10 text-green-500 mx-auto" />
        <h2 className="text-lg font-semibold">Ticket Created</h2>
        <p className="text-sm text-muted-foreground">
          Your request has been submitted and routed to the right team.
        </p>
      </div>

      {/* Ticket detail card */}
      <div className="rounded-xl border border-border bg-card p-5 space-y-4">
        {/* Header row */}
        <div className="flex items-center justify-between">
          <span className="font-mono text-sm text-muted-foreground">
            {ticket.displayId ?? `#${ticket.number}`}
          </span>
          <span
            className={`px-2 py-0.5 text-xs font-medium rounded border ${PRIORITY_STYLES[ticket.priority] ?? ""}`}
          >
            {ticket.priority}
          </span>
        </div>

        {/* Subject */}
        <h3 className="font-semibold text-base">{ticket.subject}</h3>

        {/* Description */}
        {ticket.description ? (
          <p className="text-sm text-muted-foreground line-clamp-3 whitespace-pre-wrap">
            {ticket.description}
          </p>
        ) : null}

        <div className="border-t border-border" />

        {/* Classification details */}
        {classification ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Sparkles className="h-3.5 w-3.5 text-primary" />
              <span className="font-medium">AI Classification</span>
              <span className="px-1.5 py-0.5 rounded text-xs border border-border ml-auto">
                {(classification.departmentConfidence * 100).toFixed(0)}%
                confidence
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-xs text-muted-foreground">Department</p>
                <p className="font-medium">{classification.department}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Request Type</p>
                <p className="font-medium">{classification.requestType}</p>
              </div>
              {classification.category ? (
                <div>
                  <p className="text-xs text-muted-foreground">Category</p>
                  <p className="font-medium">{classification.category}</p>
                </div>
              ) : null}
              <div>
                <p className="text-xs text-muted-foreground">Urgency</p>
                <p
                  className={`font-medium ${classification.urgency !== "None indicated" ? "text-orange-400" : ""}`}
                >
                  {classification.urgency}
                </p>
              </div>
            </div>

            {classification.reasoning ? (
              <p className="text-xs text-muted-foreground italic">
                {classification.reasoning}
              </p>
            ) : null}

            {/* Tags */}
            {ticket.tags && ticket.tags.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {ticket.tags.map((tag) => (
                  <span
                    key={tag}
                    className="px-2 py-0.5 text-xs rounded-full bg-muted text-muted-foreground"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            ) : null}

            {classification.routingMethod ? (
              <div className="text-xs text-muted-foreground">
                Routed via {classification.routingMethod.replace(/_/g, " ")}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* Actions */}
      <div className="flex gap-2">
        <button
          onClick={onNewTicket}
          className="flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg border border-border text-sm font-medium hover:bg-accent transition-colors"
        >
          <Plus className="h-4 w-4" />
          Submit Another Request
        </button>
        <button
          onClick={() => navigate(`/tickets/${ticket.id}`)}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
        >
          View Ticket
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
