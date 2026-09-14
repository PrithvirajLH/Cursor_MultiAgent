import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, ChevronDown, Info, X, Siren } from "lucide-react";
import { Link } from "react-router-dom";
import {
  getActiveAnnouncements,
  type ActiveAnnouncement,
  type AnnouncementSeverity,
} from "../api/client";
import { isAbortError } from "../api/is-abort-error";
import {
  COLLAPSED_STORAGE_KEY,
  DISMISSED_STORAGE_KEY,
  canDismissPermanently,
  readIds,
  rememberId,
  visibleAnnouncements,
} from "../utils/announcement-dismissal";

/** How often the banner re-asks. An ended outage should clear itself. */
const POLL_MS = 60_000;

const TREATMENT: Record<
  AnnouncementSeverity,
  { wrapper: string; icon: typeof Info; label: string }
> = {
  // Impossible to miss: filled, high contrast, full width.
  OUTAGE: {
    wrapper:
      "border-destructive bg-destructive text-destructive-foreground shadow-sm",
    icon: Siren,
    label: "Outage",
  },
  WARNING: {
    wrapper:
      "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200",
    icon: AlertTriangle,
    label: "Notice",
  },
  // Quiet on purpose: an INFO notice that shouts teaches people to ignore the
  // ones that matter.
  INFO: {
    wrapper:
      "border-border bg-card text-foreground dark:bg-card dark:text-foreground",
    icon: Info,
    label: "Info",
  },
};

export type AnnouncementBannerViewProps = {
  announcements: ActiveAnnouncement[];
  collapsedIds: string[];
  onDismiss: (announcement: ActiveAnnouncement) => void;
  onToggleCollapse: (announcement: ActiveAnnouncement) => void;
};

/**
 * The banner itself — presentational, so it renders to static markup in a test
 * without a DOM (this repo has no jsdom, deliberately).
 *
 * ⚠️ RENDERS NOTHING AT ALL WHEN THERE IS NOTHING ACTIVE. Not an empty bar, not
 * a zero-height wrapper, not a margin. This is the state the app is in almost
 * all of the time and the easiest one to get wrong.
 */
export function AnnouncementBannerView({
  announcements,
  collapsedIds,
  onDismiss,
  onToggleCollapse,
}: AnnouncementBannerViewProps) {
  if (announcements.length === 0) {
    return null;
  }
  return (
    <div className="space-y-2 px-1 pb-3" role="status" aria-live="polite">
      {announcements.map((announcement) => {
        const treatment = TREATMENT[announcement.severity] ?? TREATMENT.INFO;
        const Icon = treatment.icon;
        const collapsed = collapsedIds.includes(announcement.id);
        const dismissible = canDismissPermanently(announcement.severity);
        return (
          <div
            key={announcement.id}
            className={`flex items-start gap-3 rounded-xl border px-4 py-3 ${treatment.wrapper}`}
          >
            <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">
                <span className="sr-only">{treatment.label}: </span>
                {announcement.title}
              </p>
              {!collapsed && (
                <p className="mt-0.5 text-sm opacity-90">{announcement.body}</p>
              )}
              {!collapsed && announcement.linkedTicketId && (
                <Link
                  to={`/tickets/${announcement.linkedTicketId}`}
                  className="mt-1 inline-block text-xs font-medium underline underline-offset-2"
                >
                  Follow the ticket
                </Link>
              )}
            </div>
            {dismissible ? (
              <button
                type="button"
                onClick={() => onDismiss(announcement)}
                aria-label={`Dismiss: ${announcement.title}`}
                className="shrink-0 rounded-lg p-1 transition-all hover:bg-black/10"
              >
                <X className="h-4 w-4" />
              </button>
            ) : (
              // An outage collapses; it does not go away. It returns in full on
              // a fresh session — the owner's decision, not a default.
              <button
                type="button"
                onClick={() => onToggleCollapse(announcement)}
                aria-label={
                  collapsed
                    ? `Expand: ${announcement.title}`
                    : `Collapse: ${announcement.title}`
                }
                className="shrink-0 rounded-lg p-1 transition-all hover:bg-black/10"
              >
                <ChevronDown
                  className={`h-4 w-4 transition-transform ${collapsed ? "-rotate-90" : ""}`}
                />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Fetches what this viewer should see and keeps it current (card 2.7).
 *
 * ⚠️ MUST BE MOUNTED OUTSIDE THE PATHNAME-KEYED WRAPPER in `App.tsx`. That div's
 * key is the pathname, so anything inside it remounts on every navigation: the
 * fade-in would replay on each page change and any dismissal held in state
 * would come back.
 *
 * The server decides what is active and who may see it. This polls rather than
 * deciding for itself, so an announcement that ends clears itself without a
 * reload.
 */
export function AnnouncementBanner() {
  const [announcements, setAnnouncements] = useState<ActiveAnnouncement[]>([]);
  const [dismissedIds, setDismissedIds] = useState<string[]>(() =>
    readIds(safeStorage("local"), DISMISSED_STORAGE_KEY),
  );
  const [collapsedIds, setCollapsedIds] = useState<string[]>(() =>
    readIds(safeStorage("session"), COLLAPSED_STORAGE_KEY),
  );

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setInterval> | null = null;
    const load = async () => {
      try {
        setAnnouncements(await getActiveAnnouncements(controller.signal));
      } catch (error) {
        // A banner is a courtesy: it must never surface an error into the shell
        // it sits above. Card 1.65's helper keeps an abort from being mistaken
        // for a failure.
        if (!isAbortError(error)) {
          setAnnouncements([]);
        }
      }
    };
    void load();
    timer = setInterval(() => void load(), POLL_MS);
    return () => {
      controller.abort();
      if (timer) clearInterval(timer);
    };
  }, []);

  const dismiss = useCallback((announcement: ActiveAnnouncement) => {
    rememberId(safeStorage("local"), DISMISSED_STORAGE_KEY, announcement.id);
    setDismissedIds((ids) =>
      ids.includes(announcement.id) ? ids : [...ids, announcement.id],
    );
  }, []);

  const toggleCollapse = useCallback((announcement: ActiveAnnouncement) => {
    setCollapsedIds((ids) => {
      if (ids.includes(announcement.id)) {
        return ids.filter((id) => id !== announcement.id);
      }
      rememberId(
        safeStorage("session"),
        COLLAPSED_STORAGE_KEY,
        announcement.id,
      );
      return [...ids, announcement.id];
    });
  }, []);

  return (
    <AnnouncementBannerView
      announcements={visibleAnnouncements(announcements, dismissedIds)}
      collapsedIds={collapsedIds}
      onDismiss={dismiss}
      onToggleCollapse={toggleCollapse}
    />
  );
}

/** Storage access throws outright in some privacy modes. Ask carefully. */
function safeStorage(kind: "local" | "session"): Storage | undefined {
  try {
    if (typeof window === "undefined") return undefined;
    return kind === "local" ? window.localStorage : window.sessionStorage;
  } catch {
    return undefined;
  }
}
