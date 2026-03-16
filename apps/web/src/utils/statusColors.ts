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
  new: "bg-violet-500/10 text-violet-400",
  progress: "bg-amber-500/10 text-amber-400",
  resolved: "bg-emerald-500/10 text-emerald-400",
  closed: "bg-white/[0.06] text-slate-400",
  reopened: "bg-rose-500/10 text-rose-400",
  neutral: "bg-white/[0.06] text-slate-400",
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
  urgent: "bg-red-500/10 text-red-400",
  high: "bg-orange-500/10 text-orange-400",
  medium: "bg-blue-500/10 text-blue-400",
  low: "bg-white/[0.06] text-slate-400",
  neutral: "bg-white/[0.06] text-slate-400",
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
  met: "bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-500/20",
  onTrack: "bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-500/20",
  atRisk: "bg-amber-500/10 text-amber-400 ring-1 ring-amber-500/20",
  paused: "bg-amber-500/10 text-amber-400 ring-1 ring-amber-500/20",
  breached: "bg-rose-500/10 text-rose-400 ring-1 ring-rose-500/20",
  none: "bg-white/[0.06] text-slate-400 ring-1 ring-white/10",
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
  met: "border-emerald-500/20 bg-emerald-500/10 text-emerald-400",
  onTrack: "border-emerald-500/20 bg-emerald-500/10 text-emerald-400",
  atRisk: "border-amber-500/20 bg-amber-500/10 text-amber-400",
  paused: "border-amber-500/20 bg-amber-500/10 text-amber-400",
  breached: "border-rose-500/20 bg-rose-500/10 text-rose-400",
  none: "border-white/10 bg-white/[0.06] text-slate-400",
};

/** Returns Tailwind classes for SLA detail cards. */
export function slaDetailClass(tone: SlaTone): string {
  return SLA_DETAIL_CLASSES[tone];
}
