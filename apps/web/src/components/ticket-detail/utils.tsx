import type { ReactNode } from "react";
import type { TicketDetail, TicketEvent } from "../../api/client";
import { formatStatus } from "../../utils/format";
import {
  statusBadgeClass as _statusBadgeClass,
  priorityBadgeClass as _priorityBadgeClass,
  slaBadgeClass as _slaBadgeClass,
  slaDetailClass,
} from "../../utils/statusColors";
import type { SlaTone } from "../../utils/statusColors";

/* ——— SLA helpers ——— */

const SLA_RISK_WINDOW_MS = 4 * 60 * 60 * 1000;
const SLA_FIRST_RESPONSE_RISK_MS = 2 * 60 * 60 * 1000;

export type SlaInfo = {
  label: string;
  tone: string;
  detail: ReactNode;
};

export function getFirstResponseSla(
  ticket: TicketDetail,
  RelativeTime: React.ComponentType<{ value: string }>,
): SlaInfo {
  if (ticket.firstResponseAt) {
    const tone: SlaTone = "met";
    return {
      label: "Met",
      tone: slaDetailClass(tone),
      detail: (
        <>
          <RelativeTime value={ticket.firstResponseAt} /> responded
        </>
      ),
    };
  }
  if (!ticket.firstResponseDueAt) {
    return {
      label: "Not set",
      tone: slaDetailClass("none"),
      detail: "No SLA configured",
    };
  }
  const dueMs = new Date(ticket.firstResponseDueAt).getTime() - Date.now();
  if (dueMs < 0) {
    return {
      label: "Breached",
      tone: slaDetailClass("breached"),
      detail: (
        <>
          Due <RelativeTime value={ticket.firstResponseDueAt} />
        </>
      ),
    };
  }
  if (dueMs <= SLA_FIRST_RESPONSE_RISK_MS) {
    return {
      label: "At Risk",
      tone: slaDetailClass("atRisk"),
      detail: (
        <>
          Due <RelativeTime value={ticket.firstResponseDueAt} />
        </>
      ),
    };
  }
  return {
    label: "Open",
    tone: slaDetailClass("onTrack"),
    detail: (
      <>
        Due <RelativeTime value={ticket.firstResponseDueAt} />
      </>
    ),
  };
}

export function getResolutionSla(
  ticket: TicketDetail,
  RelativeTime: React.ComponentType<{ value: string }>,
): SlaInfo {
  if (ticket.completedAt) {
    return {
      label: "Met",
      tone: slaDetailClass("met"),
      detail: (
        <>
          Completed <RelativeTime value={ticket.completedAt} />
        </>
      ),
    };
  }
  if (!ticket.dueAt) {
    return {
      label: "Not set",
      tone: slaDetailClass("none"),
      detail: "No SLA configured",
    };
  }
  const isPaused =
    ticket.status === "WAITING_ON_REQUESTER" ||
    ticket.status === "WAITING_ON_VENDOR";
  if (isPaused) {
    return {
      label: "Paused",
      tone: slaDetailClass("paused"),
      detail: ticket.slaPausedAt ? (
        <>
          Paused <RelativeTime value={ticket.slaPausedAt} />
        </>
      ) : (
        "Paused"
      ),
    };
  }
  const dueMs = new Date(ticket.dueAt).getTime() - Date.now();
  if (dueMs < 0) {
    return {
      label: "Breached",
      tone: slaDetailClass("breached"),
      detail: (
        <>
          Due <RelativeTime value={ticket.dueAt} />
        </>
      ),
    };
  }
  if (dueMs <= SLA_RISK_WINDOW_MS) {
    return {
      label: "At Risk",
      tone: slaDetailClass("atRisk"),
      detail: (
        <>
          Due <RelativeTime value={ticket.dueAt} />
        </>
      ),
    };
  }
  return {
    label: "On Track",
    tone: slaDetailClass("onTrack"),
    detail: (
      <>
        Due <RelativeTime value={ticket.dueAt} />
      </>
    ),
  };
}

// Re-export from centralized utility (7.4 fix)
export const slaBadgeClass = _slaBadgeClass;

/* ——— Formatting helpers ——— */

export function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

/** Returns display label for priority; consistently SEV1, SEV2, SEV3, SEV4 across the app. */
export function formatPriority(priority?: string | null) {
  const value = (priority ?? "").toUpperCase();
  switch (value) {
    case "SEV1":
    case "URGENT":
      return "SEV1";
    case "SEV2":
    case "HIGH":
      return "SEV2";
    case "SEV3":
    case "MEDIUM":
      return "SEV3";
    case "SEV4":
    case "LOW":
      return "SEV4";
    default:
      return priority ?? "Unknown";
  }
}

// Re-export from centralized utility (7.4 fix)
export const priorityBadgeClass = _priorityBadgeClass;
export const statusBadgeClass = _statusBadgeClass;

export function formatChannel(channel?: string | null) {
  if (!channel) return "Unknown";
  return channel
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function getEventKind(event: TicketEvent) {
  if (event.type === "MESSAGE_ADDED") {
    const payload = (event.payload ?? {}) as { type?: string };
    return payload.type === "INTERNAL" ? "internal" : "message";
  }
  return "default";
}

export function formatEventText(event: TicketEvent) {
  const actor =
    event.createdBy?.displayName ?? event.createdBy?.email ?? "System";
  const payload = (event.payload ?? {}) as {
    type?: string;
    from?: string;
    to?: string;
    assigneeName?: string | null;
    assigneeEmail?: string | null;
    toTeamName?: string | null;
    changes?: Array<{ field?: string }>;
    sourceRef?: string | null;
    department?: string | null;
  };

  switch (event.type) {
    case "TICKET_CREATED_VIA_INTAKE": {
      // sourceRef is the calling system's own reference - a Power Automate flow
      // passes its Forms response id. It is recorded only on this event and
      // shown nowhere else, so this line is the only place an agent can trace a
      // ticket back to the record that produced it.
      const origin = [
        payload.sourceRef ? `from ${payload.sourceRef}` : null,
        payload.department ? `routed to ${payload.department}` : null,
      ].filter((part): part is string => part !== null);
      return origin.length > 0
        ? `Ticket created by ${actor} via an integration (${origin.join(", ")})`
        : `Ticket created by ${actor} via an integration`;
    }
    case "TICKET_CREATED":
      return `Ticket created by ${actor}`;
    case "TICKET_EDITED": {
      const fields = (payload.changes ?? [])
        .map((change) => change.field)
        .filter((field): field is string => Boolean(field));
      return fields.length
        ? `Ticket edited by ${actor}: ${fields.join(", ")}`
        : `Ticket edited by ${actor}`;
    }
    case "TICKET_ASSIGNED":
      return `Assigned to ${payload.assigneeName ?? payload.assigneeEmail ?? "team member"}`;
    case "TICKET_STATUS_CHANGED":
      return `Status changed from ${formatStatus(payload.from ?? "UNKNOWN")} to ${formatStatus(payload.to ?? "UNKNOWN")}`;
    case "TICKET_TRANSFERRED":
      return `Transferred to ${payload.toTeamName ?? "another department"}`;
    case "TICKET_PRIORITY_CHANGED":
      return `Priority changed from ${formatPriority(payload.from)} to ${formatPriority(payload.to)}`;
    case "MESSAGE_ADDED":
      return payload.type === "INTERNAL"
        ? `${actor} added internal note`
        : `${actor} replied`;
    default:
      return formatStatus(event.type.replace(/_/g, " "));
  }
}


/**
 * Intake writes TWO events in the same instant: the shared `TICKET_CREATED` that
 * every channel writes, and `TICKET_CREATED_VIA_INTAKE` carrying the calling
 * system's own reference.
 *
 * On the audit log both belong — it is a compliance trail, and hiding a recorded
 * event from it would be wrong. On a ticket's own timeline they read as
 * duplicates, so the intake row stands in for both: it already names the actor
 * (the event is written with the requester as its author) and adds where the
 * ticket came from.
 *
 * Returns the array unchanged when there is no intake event — which is every
 * ticket from every other channel.
 */
export function collapseIntakeCreationEvents(
  events: TicketEvent[],
): TicketEvent[] {
  const hasIntakeEvent = events.some(
    (event) => event.type === "TICKET_CREATED_VIA_INTAKE",
  );
  if (!hasIntakeEvent) {
    return events;
  }
  return events.filter((event) => event.type !== "TICKET_CREATED");
}