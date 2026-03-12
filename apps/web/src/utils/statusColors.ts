/**
 * Centralized status & priority color mapping (7.4 fix).
 *
 * Provides a single source of truth for all badge/tag colors used across the app.
 * Every component that needs status or priority colors should import from here.
 */

/* ——— Status tones ——— */

export type StatusTone =
  | "new"
  | "progress"
  | "resolved"
  | "closed"
  | "reopened"
  | "neutral";

const STATUS_TONE_MAP: Record<string, StatusTone> = {
  NEW: "new",
  TRIAGED: "progress",
  ASSIGNED: "progress",
  IN_PROGRESS: "progress",
  WAITING_ON_REQUESTER: "progress",
  WAITING_ON_VENDOR: "progress",
  RESOLVED: "resolved",
  CLOSED: "closed",
  REOPENED: "reopened",
};

export function getStatusTone(status?: string | null): StatusTone {
  if (!status) return "neutral";
  return STATUS_TONE_MAP[status] ?? "neutral";
}

/** Badge classes (bg + text + border) keyed by tone. */
const STATUS_BADGE_CLASSES: Record<StatusTone, string> = {
  new: "bg-indigo-50 text-indigo-700",
  progress: "bg-amber-50 text-amber-700",
  resolved: "bg-emerald-50 text-emerald-700",
  closed: "bg-slate-100 text-slate-700",
  reopened: "bg-rose-50 text-rose-700",
  neutral: "bg-slate-100 text-slate-700",
};

/** Returns Tailwind badge classes for a given ticket status. */
export function statusBadgeClass(status?: string | null): string {
  return STATUS_BADGE_CLASSES[getStatusTone(status)];
}

/* ——— Priority tones ——— */

export type PriorityTone = "urgent" | "high" | "medium" | "low" | "neutral";

export function getPriorityTone(priority?: string | null): PriorityTone {
  const value = (priority ?? "").toUpperCase();
  switch (value) {
    case "P1":
    case "URGENT":
      return "urgent";
    case "P2":
    case "HIGH":
      return "high";
    case "P3":
    case "MEDIUM":
      return "medium";
    case "P4":
    case "LOW":
      return "low";
    default:
      return "neutral";
  }
}

const PRIORITY_BADGE_CLASSES: Record<PriorityTone, string> = {
  urgent: "bg-red-50 text-red-700",
  high: "bg-orange-50 text-orange-700",
  medium: "bg-blue-50 text-blue-700",
  low: "bg-slate-100 text-slate-600",
  neutral: "bg-slate-100 text-slate-600",
};

/** Returns Tailwind badge classes for a given ticket priority. */
export function priorityBadgeClass(priority?: string | null): string {
  return PRIORITY_BADGE_CLASSES[getPriorityTone(priority)];
}

/* ——— SLA tones ——— */

export type SlaTone =
  | "met"
  | "onTrack"
  | "atRisk"
  | "paused"
  | "breached"
  | "none";

const SLA_BADGE_CLASSES: Record<SlaTone, string> = {
  met: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200",
  onTrack: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200",
  atRisk: "bg-amber-50 text-amber-700 ring-1 ring-amber-200",
  paused: "bg-amber-50 text-amber-700 ring-1 ring-amber-200",
  breached: "bg-rose-50 text-rose-700 ring-1 ring-rose-200",
  none: "bg-slate-100 text-slate-700 ring-1 ring-slate-200",
};

/** Returns Tailwind badge classes for a given SLA label. */
export function slaBadgeClass(label?: string): string {
  if (label === "Met") return SLA_BADGE_CLASSES.met;
  if (label === "On Track" || label === "Open")
    return SLA_BADGE_CLASSES.onTrack;
  if (label === "At Risk" || label === "Paused")
    return SLA_BADGE_CLASSES.atRisk;
  if (label === "Breached") return SLA_BADGE_CLASSES.breached;
  return SLA_BADGE_CLASSES.none;
}

/* ——— SLA detail tones (used in cards/inline badges) ——— */

const SLA_DETAIL_CLASSES: Record<SlaTone, string> = {
  met: "border-emerald-200 bg-emerald-50 text-emerald-700",
  onTrack: "border-emerald-200 bg-emerald-50 text-emerald-700",
  atRisk: "border-amber-200 bg-amber-50 text-amber-700",
  paused: "border-amber-200 bg-amber-50 text-amber-700",
  breached: "border-rose-200 bg-rose-50 text-rose-700",
  none: "border-slate-200 bg-slate-100 text-slate-600",
};

/** Returns Tailwind classes for SLA detail cards. */
export function slaDetailClass(tone: SlaTone): string {
  return SLA_DETAIL_CLASSES[tone];
}
