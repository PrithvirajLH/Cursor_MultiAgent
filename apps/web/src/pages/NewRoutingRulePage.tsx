import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, ArrowLeft } from "lucide-react";
import {
  createRoutingRule,
  fetchTeamMembers,
  type TeamMember,
  type TeamRef,
} from "../api/client";
import { TopBar } from "../components/TopBar";
import { useHeaderContext } from "../contexts/HeaderContext";
import { useToast } from "../hooks/useToast";
import type { Role } from "../types";
import { handleApiError } from "../utils/handleApiError";

type RoutingCondition = {
  field: string;
  op: string;
  val: string;
};

type RoutingAction = {
  type: "assign_team" | "assign_member";
  val: string;
};

type RoutingForm = {
  name: string;
  enabled: boolean;
  priority: number;
  conditions: RoutingCondition[];
  actions: RoutingAction[];
};

type AssignmentMode = "team" | "member";

type MemberOption = {
  id: string;
  label: string;
  email: string;
};

const DEFAULT_CONDITION: RoutingCondition = {
  field: "subject",
  op: "contains",
  val: "",
};

function normalizeKeyword(value: string): string {
  return value.trim().toLowerCase();
}

function toUniqueKeywords(conditions: RoutingCondition[]): string[] {
  const seen = new Set<string>();
  const next: string[] = [];
  conditions.forEach((condition) => {
    const normalized = normalizeKeyword(condition.val);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    next.push(normalized);
  });
  return next;
}

export function NewRoutingRulePage({
  teamsList,
  role,
}: {
  teamsList: TeamRef[];
  role: Role;
}) {
  const headerCtx = useHeaderContext();
  const toast = useToast();
  const navigate = useNavigate();

  const assignmentMode: AssignmentMode =
    role === "TEAM_ADMIN" ? "member" : "team";

  const [memberOptions, setMemberOptions] = useState<MemberOption[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState<RoutingForm>(() => {
    const nextPriority = 1;
    const defaultTeamId = teamsList[0]?.id ?? "";
    return {
      name: "",
      enabled: true,
      priority: nextPriority,
      conditions: [{ ...DEFAULT_CONDITION }],
      actions: [
        {
          type: assignmentMode === "member" ? "assign_member" : "assign_team",
          val: assignmentMode === "member" ? "" : defaultTeamId,
        },
      ],
    };
  });

  useEffect(() => {
    if (assignmentMode !== "member") {
      setMemberOptions([]);
      return;
    }
    const teamId = teamsList[0]?.id;
    if (!teamId) {
      setMemberOptions([]);
      return;
    }
    setLoadingMembers(true);
    fetchTeamMembers(teamId)
      .then((response) => {
        const options = response.data
          .map((member: TeamMember) => ({
            id: member.user.id,
            label: member.user.displayName || member.user.email,
            email: member.user.email,
          }))
          .sort((a, b) => a.label.localeCompare(b.label));
        setMemberOptions(options);
      })
      .catch((err) => {
        const message = handleApiError(err);
        setError(message);
        toast.error(message);
      })
      .finally(() => {
        setLoadingMembers(false);
      });
  }, [assignmentMode, teamsList, toast]);

  const canSubmit = useMemo(() => {
    if (!form.name.trim()) return false;
    const keywords = toUniqueKeywords(form.conditions);
    if (keywords.length === 0) return false;
    const action = form.actions[0];
    if (!action?.val.trim()) return false;
    if (assignmentMode === "member" && memberOptions.length === 0) return false;
    return true;
  }, [
    assignmentMode,
    form.actions,
    form.conditions,
    form.name,
    memberOptions.length,
  ]);

  function handleAddCondition() {
    setForm((prev) => ({
      ...prev,
      conditions: [...prev.conditions, { ...DEFAULT_CONDITION }],
    }));
  }

  function handleRemoveCondition(index: number) {
    setForm((prev) => {
      if (prev.conditions.length === 1) return prev;
      return {
        ...prev,
        conditions: prev.conditions.filter((_, i) => i !== index),
      };
    });
  }

  function handleUpdateCondition(index: number, value: string) {
    setForm((prev) => ({
      ...prev,
      conditions: prev.conditions.map((condition, i) =>
        i === index ? { ...condition, val: value } : condition,
      ),
    }));
  }

  function handleUpdateAction(value: string) {
    setForm((prev) => ({
      ...prev,
      actions: prev.actions.map((action, index) =>
        index === 0 ? { ...action, val: value } : action,
      ),
    }));
  }

  async function handleSubmit() {
    const keywords = toUniqueKeywords(form.conditions);
    if (!form.name.trim()) {
      const message = "Rule name is required.";
      setError(message);
      toast.error(message);
      return;
    }
    if (keywords.length === 0) {
      const message = "Add at least one subject keyword.";
      setError(message);
      toast.error(message);
      return;
    }

    const assignmentAction = form.actions[0];
    if (!assignmentAction?.val.trim()) {
      const message =
        assignmentMode === "member"
          ? "Select a team member to assign."
          : "Select a team to assign.";
      setError(message);
      toast.error(message);
      return;
    }

    const basePayload = {
      name: form.name.trim(),
      keywords,
      priority: Math.max(1, Number(form.priority) || 1),
      isActive: form.enabled,
    };

    let payload:
      | (typeof basePayload & { teamId: string; assigneeId?: string })
      | undefined;

    if (assignmentMode === "member") {
      const scopedTeamId = teamsList[0]?.id;
      if (!scopedTeamId) {
        const message = "No team found for team admin routing rules.";
        setError(message);
        toast.error(message);
        return;
      }
      const member = memberOptions.find((m) => m.id === assignmentAction.val);
      if (!member) {
        const message = "Select a valid team member.";
        setError(message);
        toast.error(message);
        return;
      }
      payload = {
        ...basePayload,
        teamId: scopedTeamId,
        assigneeId: member.id,
      };
    } else {
      const team = teamsList.find((t) => t.id === assignmentAction.val);
      if (!team) {
        const message = "Select a valid team.";
        setError(message);
        toast.error(message);
        return;
      }
      payload = {
        ...basePayload,
        teamId: team.id,
      };
    }

    setSaving(true);
    setError(null);
    try {
      await createRoutingRule(payload);
      toast.success("Routing rule created.");
      navigate("/routing");
    } catch (err) {
      const message = handleApiError(err);
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  const headerValue = headerCtx;

  return (
    <section className="min-h-full bg-background animate-fade-in">
      <div className="sticky top-0 z-40 border-b border-border bg-card/90 backdrop-blur-sm">
        <div className="mx-auto max-w-none py-4 px-6">
          {headerValue ? (
            <TopBar
              title={headerValue.title}
              subtitle={headerValue.subtitle}
              currentEmail={headerValue.currentEmail}
              onOpenSearch={headerValue.onOpenSearch}
              notificationProps={headerValue.notificationProps}
              leftContent={
                <div className="min-w-0">
                  <h1 className="text-xl font-semibold text-foreground">
                    New Routing Rule
                  </h1>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    Define subject keywords and auto-assignment for incoming
                    tickets.
                  </p>
                </div>
              }
            />
          ) : (
            <div className="min-w-0">
              <h1 className="text-xl font-semibold text-foreground">
                New Routing Rule
              </h1>
              <p className="mt-0.5 text-sm text-muted-foreground">
                Define subject keywords and auto-assignment for incoming
                tickets.
              </p>
            </div>
          )}
        </div>
      </div>

      <div className="mx-auto w-full max-w-[900px] px-6 py-8">
        <button
          type="button"
          onClick={() => navigate("/routing")}
          className="mb-4 inline-flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>Back to routing rules</span>
        </button>

        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="rounded-2xl border border-border bg-card shadow-sm">
          <div className="border-b border-border px-6 py-4">
            <h2 className="text-lg font-semibold text-foreground">
              Rule configuration
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Rules are evaluated in order. The first matching rule wins.
            </p>
          </div>

          <div className="space-y-6 px-6 py-6">
            <div className="grid gap-4 md:grid-cols-3">
              <div className="md:col-span-2">
                <label className="mb-1 block text-sm font-medium text-foreground">
                  Rule name <span className="text-red-500">*</span>
                </label>
                <input
                  value={form.name}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, name: event.target.value }))
                  }
                  className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:border-transparent focus:ring-2 focus:ring-ring"
                  placeholder="e.g. VIP Fast Lane"
                />
              </div>
              <div className="flex flex-col gap-2">
                <label className="mb-1 block text-sm font-medium text-foreground">
                  Priority
                </label>
                <input
                  type="number"
                  min={1}
                  value={form.priority}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      priority: Number(event.target.value) || 1,
                    }))
                  }
                  className="w-24 rounded-lg border border-border px-3 py-2 text-sm focus:border-transparent focus:ring-2 focus:ring-ring"
                />
                <p className="text-xs text-muted-foreground">
                  Lower numbers run first. The first matching rule is used.
                </p>
              </div>
            </div>

            <div className="flex items-center justify-between rounded-xl border border-border bg-muted px-4 py-3">
              <div>
                <p className="text-sm font-medium text-foreground">
                  Rule status
                </p>
                <p className="text-xs text-muted-foreground">
                  Disable to keep the rule configured but inactive.
                </p>
              </div>
              <label className="relative inline-flex h-[22px] w-10 items-center">
                <input
                  type="checkbox"
                  checked={form.enabled}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      enabled: event.target.checked,
                    }))
                  }
                  className="peer sr-only"
                />
                <span className="absolute inset-0 cursor-pointer rounded-full bg-muted transition peer-checked:bg-primary" />
                <span className="absolute bottom-[3px] left-[3px] h-4 w-4 rounded-full bg-white transition-transform peer-checked:translate-x-[18px]" />
              </label>
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <p className="text-sm font-semibold text-foreground">
                  Subject keywords
                </p>
                <span className="text-xs text-muted-foreground">
                  All keywords are matched against the ticket subject.
                </span>
              </div>
              <div className="space-y-2">
                {form.conditions.map((condition, index) => (
                  <div
                    key={`condition-${index}`}
                    className="flex items-center gap-2 rounded-xl border border-border bg-muted p-2.5"
                  >
                    <span className="rounded-lg bg-card px-2 py-1 text-xs font-medium text-muted-foreground">
                      subject
                    </span>
                    <span className="rounded-lg bg-card px-2 py-1 text-xs font-medium text-muted-foreground">
                      contains
                    </span>
                    <input
                      value={condition.val}
                      onChange={(event) =>
                        handleUpdateCondition(index, event.target.value)
                      }
                      className="flex-1 rounded-lg border border-border px-2 py-1.5 text-sm focus:border-transparent focus:ring-2 focus:ring-ring"
                      placeholder="keyword…"
                    />
                    <button
                      type="button"
                      onClick={() => handleRemoveCondition(index)}
                      className="flex-shrink-0 text-muted-foreground hover:text-red-500"
                    >
                      <svg
                        className="h-4 w-4"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M6 18L18 6M6 6l12 12"
                        />
                      </svg>
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={handleAddCondition}
                  className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:text-blue-700"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>Add keyword</span>
                </button>
              </div>
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <p className="text-sm font-semibold text-foreground">
                  Assignment
                </p>
                <span className="text-xs text-muted-foreground">
                  Route matching tickets to the right{" "}
                  {assignmentMode === "member" ? "agent" : "team"}.
                </span>
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2 rounded-lg border border-blue-100 bg-blue-50 p-2.5">
                  <svg
                    className="h-4 w-4 flex-shrink-0 text-blue-400"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M13 10V3L4 14h7v7l9-11h-7z"
                    />
                  </svg>
                  <span className="rounded-lg bg-card px-2 py-1 text-xs font-medium text-primary">
                    {assignmentMode === "member"
                      ? "Assign member"
                      : "Assign team"}
                  </span>
                  <select
                    value={form.actions[0]?.val ?? ""}
                    onChange={(event) => handleUpdateAction(event.target.value)}
                    className="flex-1 rounded-lg border border-primary/30 bg-card px-2 py-1.5 text-sm focus:border-transparent focus:ring-2 focus:ring-ring"
                  >
                    <option value="">
                      {assignmentMode === "member"
                        ? "Select member…"
                        : "Select team…"}
                    </option>
                    {assignmentMode === "member"
                      ? memberOptions.map((member) => (
                          <option key={member.id} value={member.id}>
                            {member.label}
                          </option>
                        ))
                      : teamsList.map((team) => (
                          <option key={team.id} value={team.id}>
                            {team.name}
                          </option>
                        ))}
                  </select>
                </div>
                {assignmentMode === "member" &&
                  memberOptions.length === 0 &&
                  !loadingMembers && (
                    <p className="text-xs text-amber-700">
                      No team members found for assignment. Add team members
                      first.
                    </p>
                  )}
              </div>
            </div>
          </div>

          <div className="flex justify-between items-center border-t border-border bg-muted px-6 py-4 rounded-b-2xl">
            <span className="text-xs text-muted-foreground">
              * Required fields. Press Enter to save quickly.
            </span>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => navigate("/routing")}
                disabled={saving}
                className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleSubmit()}
                disabled={saving || !canSubmit}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 disabled:cursor-not-allowed disabled:bg-primary/40"
              >
                {saving ? "Saving…" : "Create rule"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
