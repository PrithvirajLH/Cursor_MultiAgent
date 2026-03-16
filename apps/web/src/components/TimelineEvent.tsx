import type { TicketDetail, TicketEvent, TicketMessage } from "../api/client";
import { MessageBody } from "./MessageBody";
import { RelativeTime } from "./RelativeTime";
import { formatDate, formatStatus } from "../utils/format";
import {
  MessageSquare,
  UserPlus,
  ArrowRightLeft,
  FileUp,
  AlertTriangle,
  Clock,
  Ticket as TicketIcon,
  Flag,
} from "lucide-react";

type TimelineEventProps = {
  event: TicketEvent;
  message?: TicketMessage | null;
  ticket: TicketDetail;
};

function eventIcon(type: string) {
  switch (type) {
    case "TICKET_CREATED":
      return <TicketIcon className="h-4 w-4 text-muted-foreground" />;
    case "TICKET_STATUS_CHANGED":
      return <ArrowRightLeft className="h-4 w-4 text-blue-600" />;
    case "TICKET_ASSIGNED":
      return <UserPlus className="h-4 w-4 text-emerald-600" />;
    case "TICKET_TRANSFERRED":
      return <ArrowRightLeft className="h-4 w-4 text-violet-600" />;
    case "TICKET_PRIORITY_CHANGED":
    case "PRIORITY_BUMPED":
      return <Flag className="h-4 w-4 text-amber-600" />;
    case "MESSAGE_ADDED":
      return <MessageSquare className="h-4 w-4 text-muted-foreground" />;
    case "ATTACHMENT_ADDED":
      return <FileUp className="h-4 w-4 text-muted-foreground" />;
    case "SLA_BREACHED":
      return <AlertTriangle className="h-4 w-4 text-red-600" />;
    case "SLA_AT_RISK":
      return <Clock className="h-4 w-4 text-amber-600" />;
    default:
      return <TicketIcon className="h-4 w-4 text-muted-foreground" />;
  }
}

function eventLabel(
  event: TicketEvent,
  ticket: TicketDetail,
): { title: string; subtitle?: string } {
  const payload = event.payload ?? {};
  const actor =
    event.createdBy?.displayName ?? event.createdBy?.email ?? "System";

  switch (event.type) {
    case "TICKET_CREATED":
      return {
        title: "Ticket created",
        subtitle: `by ${actor} via ${String(payload.channel ?? "Portal").toLowerCase()}`,
      };
    case "TICKET_STATUS_CHANGED": {
      const from = String(payload.from ?? "").replace(/_/g, " ");
      const to = String(payload.to ?? "").replace(/_/g, " ");
      return {
        title: `Status changed: ${formatStatus(from)} → ${formatStatus(to)}`,
        subtitle: `by ${actor}`,
      };
    }
    case "TICKET_ASSIGNED": {
      const assigneeId = payload.assigneeId as string | undefined;
      const assigneeName =
        payload.assigneeName != null
          ? String(payload.assigneeName)
          : assigneeId && ticket.assignee?.id === assigneeId
            ? (ticket.assignee.displayName ?? ticket.assignee.email)
            : null;
      return {
        title: assigneeId
          ? assigneeName
            ? `Assigned to ${assigneeName}`
            : "Assigned"
          : "Unassigned",
        subtitle: `by ${actor}`,
      };
    }
    case "TICKET_TRANSFERRED":
      return {
        title: "Team transferred",
        subtitle: `by ${actor}`,
      };
    case "TICKET_PRIORITY_CHANGED":
    case "PRIORITY_BUMPED": {
      const from = payload.from as string | undefined;
      const to = payload.to as string | undefined;
      return {
        title: `Priority changed: ${from ?? "—"} → ${to ?? "—"}`,
        subtitle: `by ${actor}`,
      };
    }
    case "MESSAGE_ADDED":
      return {
        title:
          (payload.type as string) === "INTERNAL"
            ? "Internal note added"
            : "Message added",
        subtitle: `by ${actor}`,
      };
    case "ATTACHMENT_ADDED": {
      const fileName = (payload.fileName as string) ?? "file";
      return {
        title: `Attachment uploaded: ${fileName}`,
        subtitle: `by ${actor}`,
      };
    }
    case "SLA_BREACHED":
      return {
        title: "SLA breached",
        subtitle: payload.breachType ? String(payload.breachType) : undefined,
      };
    case "SLA_AT_RISK":
      return {
        title: "SLA at risk",
        subtitle: payload.breachType ? String(payload.breachType) : undefined,
      };
    default:
      return {
        title: event.type.replace(/_/g, " ").toLowerCase(),
        subtitle: `by ${event.createdBy?.displayName ?? event.createdBy?.email ?? "System"}`,
      };
  }
}

export function TimelineEvent({ event, message, ticket }: TimelineEventProps) {
  const icon = eventIcon(event.type);
  const { title, subtitle } = eventLabel(event, ticket);
  const messageBody = message?.body;

  return (
    <div className="flex gap-3 py-3 first:pt-0">
      <div className="flex-shrink-0 mt-0.5 h-8 w-8 rounded-full bg-muted flex items-center justify-center text-muted-foreground">
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs text-muted-foreground">
          <RelativeTime value={event.createdAt} />
          {subtitle && (
            <span
              className="text-muted-foreground ml-1"
              title={formatDate(event.createdAt)}
            >
              · {subtitle}
            </span>
          )}
        </p>
        <p className="text-sm font-medium text-foreground mt-0.5">{title}</p>
        {event.type === "MESSAGE_ADDED" &&
          messageBody != null &&
          messageBody !== "" && (
            <div className="mt-2 rounded-lg border border-border bg-muted/50 px-3 py-2 text-sm text-foreground">
              <MessageBody body={messageBody} />
            </div>
          )}
      </div>
    </div>
  );
}
