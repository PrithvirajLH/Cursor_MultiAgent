import { useCallback, useEffect, useMemo, useState } from "react";
import { Megaphone, Plus, Radio, Clock, Archive } from "lucide-react";
import {
  createAnnouncement,
  deleteAnnouncement,
  listAnnouncements,
  updateAnnouncement,
  type AnnouncementAudience,
  type AnnouncementInput,
  type AnnouncementRecord,
  type AnnouncementSeverity,
  type TeamRef,
} from "../api/client";
import { TopBar } from "../components/TopBar";
import { Drawer } from "../components/ui/Drawer";
import { useHeaderContext } from "../contexts/HeaderContext";
import { EmptyState } from "../components/ui/EmptyState";
import { handleApiError } from "../utils/handleApiError";
import {
  groupAnnouncements,
  type AnnouncementPhase,
} from "../utils/announcement-window";
import type { Role } from "../types";

const SEVERITIES: { value: AnnouncementSeverity; label: string; hint: string }[] =
  [
    { value: "INFO", label: "Info", hint: "Quiet. Dismissed for good." },
    { value: "WARNING", label: "Warning", hint: "Noticeable. Dismissed for good." },
    {
      value: "OUTAGE",
      label: "Outage",
      hint: "Impossible to miss. Comes back each session.",
    },
  ];

const PHASES: { key: AnnouncementPhase; label: string; icon: typeof Radio }[] = [
  { key: "active", label: "Showing now", icon: Radio },
  { key: "scheduled", label: "Scheduled", icon: Clock },
  { key: "expired", label: "Finished", icon: Archive },
];

type FormState = {
  id?: string;
  title: string;
  body: string;
  severity: AnnouncementSeverity;
  audience: AnnouncementAudience;
  teamId: string;
  startsAt: string;
  endsAt: string;
};

/** `datetime-local` wants `YYYY-MM-DDTHH:mm` in the viewer's own zone. */
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => `${n}`.padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate(),
  )}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function fromLocalInput(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function emptyForm(): FormState {
  return {
    title: "",
    body: "",
    severity: "INFO",
    audience: "ALL",
    teamId: "",
    startsAt: "",
    endsAt: "",
  };
}

/**
 * Announcements admin (card 2.7).
 *
 * List-first with a drawer, the house pattern for an admin screen (SLA
 * settings), grouped by what an admin actually asks: what is showing right now.
 */
export function AnnouncementsPage({
  teamsList,
  role,
}: {
  teamsList: TeamRef[];
  role: Role;
}) {
  const headerCtx = useHeaderContext();
  const [rows, setRows] = useState<AnnouncementRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const isOwner = role === "OWNER";

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(await listAnnouncements());
    } catch (err) {
      setError(handleApiError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const groups = useMemo(() => groupAnnouncements(rows), [rows]);

  const openNew = () => {
    // A TEAM_ADMIN can only speak to their own team, so the form starts where
    // they are allowed to be rather than offering a choice the server refuses.
    setForm({ ...emptyForm(), audience: isOwner ? "ALL" : "TEAM" });
    setFormError(null);
    setDrawerOpen(true);
  };

  const openExisting = (row: AnnouncementRecord) => {
    setForm({
      id: row.id,
      title: row.title,
      body: row.body,
      severity: row.severity,
      audience: row.audience,
      teamId: row.teamId ?? "",
      startsAt: toLocalInput(row.startsAt),
      endsAt: toLocalInput(row.endsAt),
    });
    setFormError(null);
    setDrawerOpen(true);
  };

  const save = async () => {
    setSaving(true);
    setFormError(null);
    const payload: AnnouncementInput = {
      title: form.title.trim(),
      body: form.body.trim(),
      severity: form.severity,
      audience: form.audience,
      teamId: form.audience === "TEAM" ? form.teamId || null : null,
      startsAt: fromLocalInput(form.startsAt) ?? undefined,
      endsAt: fromLocalInput(form.endsAt),
    };
    try {
      if (form.id) {
        await updateAnnouncement(form.id, payload);
      } else {
        await createAnnouncement(payload);
      }
      setDrawerOpen(false);
      await load();
    } catch (err) {
      setFormError(handleApiError(err));
    } finally {
      setSaving(false);
    }
  };

  /** Ending one early keeps the record; deleting it does not. */
  const endNow = async (row: AnnouncementRecord) => {
    try {
      await updateAnnouncement(row.id, { endsAt: new Date().toISOString() });
      await load();
    } catch (err) {
      setError(handleApiError(err));
    }
  };

  const remove = async (id: string) => {
    try {
      await deleteAnnouncement(id);
      setDrawerOpen(false);
      await load();
    } catch (err) {
      setFormError(handleApiError(err));
    }
  };

  const teamName = (teamId: string | null) =>
    teamsList.find((team) => team.id === teamId)?.name ?? "a team";

  // Title only. The create action lives in the toolbar below, where every other
  // admin screen puts it (Categories, Routing Rules) - a primary button beside
  // the title floats in the middle of the header bar with nothing to anchor it.
  const pageHeading = (
    <div className="min-w-0">
      <h1 className="text-xl font-semibold text-foreground">Announcements</h1>
      <p className="mt-0.5 text-sm text-muted-foreground">
        A notice on every screen — so an outage stops the duplicate tickets
        before they are raised.
      </p>
    </div>
  );

  return (
    <section className="min-h-full bg-background animate-fade-in">
      <div className="sticky top-0 z-40 border-b border-border bg-card/90 backdrop-blur-sm">
        <div className="mx-auto max-w-[1600px] px-6 py-4">
          {/* ⚠️ The page owns its title, like Operations and Routing Rules: ONE
              header row, not two. `/admin/announcements` is in
              `isShellLayoutPath` so the shell does not add its generic "Admin"
              header above this one - the two stacked and collided when it was
              not. */}
          {headerCtx ? (
            <TopBar
              title={headerCtx.title}
              subtitle={headerCtx.subtitle}
              currentEmail={headerCtx.currentEmail}
              onOpenSearch={headerCtx.onOpenSearch}
              notificationProps={headerCtx.notificationProps}
              leftContent={pageHeading}
            />
          ) : (
            pageHeading
          )}
        </div>
      </div>

      <div className="mx-auto flex max-w-[1600px] flex-col gap-6 p-6">
      <div className="flex flex-wrap items-center justify-end gap-3">
        <button
          type="button"
          onClick={openNew}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-all hover:opacity-90"
        >
          <Plus className="h-4 w-4" />
          New announcement
        </button>
      </div>

      {error && (
        <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<Megaphone className="h-5 w-5" />}
          title="Nothing announced"
          description="When something is broken, say so here once instead of answering it forty times."
        />
      ) : (
        PHASES.map(({ key, label, icon: Icon }) => {
          const group = groups[key];
          if (group.length === 0) return null;
          return (
            <section key={key} className="space-y-2">
              <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <Icon className="h-4 w-4" />
                {label}
                <span className="font-normal">({group.length})</span>
              </h2>
              <ul className="space-y-2">
                {group.map((row) => (
                  <li key={row.id}>
                    <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-border bg-card p-4">
                      <button
                        type="button"
                        onClick={() => openExisting(row)}
                        className="min-w-0 flex-1 text-left"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-semibold text-foreground">
                            {row.title}
                          </span>
                          <span className="rounded-full border border-border px-2 py-0.5 text-[11px] uppercase tracking-wide text-muted-foreground">
                            {row.severity.toLowerCase()}
                          </span>
                          <span className="text-[11px] text-muted-foreground">
                            {row.audience === "ALL"
                              ? "Everyone"
                              : teamName(row.teamId)}
                          </span>
                        </div>
                        <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                          {row.body}
                        </p>
                      </button>
                      {key === "active" && (
                        <button
                          type="button"
                          onClick={() => void endNow(row)}
                          className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-all hover:bg-accent"
                        >
                          End now
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          );
        })
      )}

      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title={form.id ? "Edit announcement" : "New announcement"}
        description="Everyone signed in sees this while it is running."
        icon={<Megaphone className="h-5 w-5" />}
        footer={
          <div className="flex items-center justify-between gap-2">
            {form.id ? (
              <button
                type="button"
                onClick={() => form.id && void remove(form.id)}
                className="rounded-lg border border-destructive/40 px-3 py-2 text-sm font-medium text-destructive transition-all hover:bg-destructive/10"
              >
                Delete
              </button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                className="rounded-lg border border-border px-3 py-2 text-sm font-medium text-foreground transition-all hover:bg-accent"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={saving || !form.title.trim() || !form.body.trim()}
                onClick={() => void save()}
                className="rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-all hover:opacity-90 disabled:opacity-60"
              >
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        }
      >
        <div className="space-y-4 p-4">
          <label className="block space-y-1">
            <span className="text-xs font-medium text-muted-foreground">Title</span>
            <input
              value={form.title}
              maxLength={120}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
              placeholder="VPN is down"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-muted-foreground">Message</span>
            <textarea
              value={form.body}
              maxLength={2000}
              rows={4}
              onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))}
              className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm"
              placeholder="We know. No need to raise a ticket — we will update here."
            />
          </label>
          <fieldset className="space-y-1">
            <legend className="text-xs font-medium text-muted-foreground">
              Severity
            </legend>
            <div className="space-y-1">
              {SEVERITIES.map((option) => (
                <label
                  key={option.value}
                  className="flex items-start gap-2 rounded-lg border border-border p-2 text-sm"
                >
                  <input
                    type="radio"
                    name="severity"
                    checked={form.severity === option.value}
                    onChange={() =>
                      setForm((f) => ({ ...f, severity: option.value }))
                    }
                    className="mt-1"
                  />
                  <span>
                    <span className="font-medium text-foreground">
                      {option.label}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {option.hint}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-muted-foreground">
              Audience
            </span>
            <select
              value={form.audience}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  audience: e.target.value as AnnouncementAudience,
                }))
              }
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
            >
              {/* Only an owner may put a banner on everybody's screen. */}
              {isOwner && <option value="ALL">Everyone</option>}
              <option value="TEAM">One team</option>
            </select>
          </label>
          {form.audience === "TEAM" && (
            <label className="block space-y-1">
              <span className="text-xs font-medium text-muted-foreground">Team</span>
              <select
                value={form.teamId}
                onChange={(e) =>
                  setForm((f) => ({ ...f, teamId: e.target.value }))
                }
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
              >
                <option value="">Select a team…</option>
                {teamsList.map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block space-y-1">
              <span className="text-xs font-medium text-muted-foreground">
                Starts
              </span>
              <input
                type="datetime-local"
                value={form.startsAt}
                onChange={(e) =>
                  setForm((f) => ({ ...f, startsAt: e.target.value }))
                }
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
              />
              <span className="block text-[11px] text-muted-foreground">
                Leave empty to start now.
              </span>
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium text-muted-foreground">Ends</span>
              <input
                type="datetime-local"
                value={form.endsAt}
                onChange={(e) =>
                  setForm((f) => ({ ...f, endsAt: e.target.value }))
                }
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
              />
              <span className="block text-[11px] text-muted-foreground">
                Leave empty to run until you end it.
              </span>
            </label>
          </div>
          {formError && <p className="text-sm text-destructive">{formError}</p>}
        </div>
      </Drawer>
      </div>
    </section>
  );
}
