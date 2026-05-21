/**
 * Centralized status & priority color mapping (7.4 fix).
 *
 * Provides a single source of truth for all badge/tag colors used across the app.
 * Every component that needs status or priority colors should import from here.
 *
 * Uses light-first colors with dark: overrides for full theme support.
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

/** Badge classes (bg + text) keyed by tone — light-first, dark: overrides. */
const STATUS_BADGE_CLASSES: Record<StatusTone, string> = {
  new: "bg-violet-100 text-violet-700 dark:bg-violet-500/10 dark:text-violet-400",
  progress: "bg-amber-100 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400",
  resolved: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400",
  closed: "bg-slate-100 text-slate-600 dark:bg-white/[0.06] dark:text-slate-400",
  reopened: "bg-rose-100 text-rose-700 dark:bg-rose-500/10 dark:text-rose-400",
  neutral: "bg-slate-100 text-slate-600 dark:bg-white/[0.06] dark:text-slate-400",
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
    case "SEV1":
    case "URGENT":
      return "urgent";
    case "SEV2":
    case "HIGH":
      return "high";
    case "SEV3":
    case "MEDIUM":
      return "medium";
    case "SEV4":
    case "LOW":
      return "low";
    default:
      return "neutral";
  }
}

const PRIORITY_BADGE_CLASSES: Record<PriorityTone, string> = {
  urgent: "bg-red-100 text-red-700 dark:bg-red-500/10 dark:text-red-400",
  high: "bg-orange-100 text-orange-700 dark:bg-orange-500/10 dark:text-orange-400",
  medium: "bg-blue-100 text-blue-700 dark:bg-blue-500/10 dark:text-blue-400",
  low: "bg-slate-100 text-slate-600 dark:bg-white/[0.06] dark:text-slate-400",
  neutral: "bg-slate-100 text-slate-600 dark:bg-white/[0.06] dark:text-slate-400",
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
  met: "bg-emerald-100 text-emerald-700 ring-1 ring-emerald-300 dark:bg-emerald-500/10 dark:text-emerald-400 dark:ring-emerald-500/20",
  onTrack: "bg-emerald-100 text-emerald-700 ring-1 ring-emerald-300 dark:bg-emerald-500/10 dark:text-emerald-400 dark:ring-emerald-500/20",
  atRisk: "bg-amber-100 text-amber-700 ring-1 ring-amber-300 dark:bg-amber-500/10 dark:text-amber-400 dark:ring-amber-500/20",
  paused: "bg-amber-100 text-amber-700 ring-1 ring-amber-300 dark:bg-amber-500/10 dark:text-amber-400 dark:ring-amber-500/20",
  breached: "bg-rose-100 text-rose-700 ring-1 ring-rose-300 dark:bg-rose-500/10 dark:text-rose-400 dark:ring-rose-500/20",
  none: "bg-slate-100 text-slate-600 ring-1 ring-slate-200 dark:bg-white/[0.06] dark:text-slate-400 dark:ring-white/10",
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
  met: "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-400",
  onTrack: "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-400",
  atRisk: "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-400",
  paused: "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-400",
  breached: "border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-400",
  none: "border-slate-200 bg-slate-50 text-slate-600 dark:border-white/10 dark:bg-white/[0.06] dark:text-slate-400",
};

/** Returns Tailwind classes for SLA detail cards. */
export function slaDetailClass(tone: SlaTone): string {
  return SLA_DETAIL_CLASSES[tone];
}
