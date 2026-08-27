import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, ArrowLeft } from "lucide-react";
import {
  createAutomationRule,
  fetchCategories,
  fetchTeamMembers,
  type AutomationAction,
  type AutomationCondition,
  type CategoryRef,
  type TeamMember,
  type TeamRef,
} from "../api/client";
import { TopBar } from "../components/TopBar";
import { useHeaderContext } from "../contexts/HeaderContext";
import { useToast } from "../hooks/useToast";
import type { Role } from "../types";
import { handleApiError } from "../utils/handleApiError";

type FlatCondition = {
  field: string;
  op: string;
  val: string;
};

type FlatAction = {
  type: string;
  val: string;
  target?: string;
  to?: string;
  address?: string;
  subject?: string;
};

/** Extra action parameters accepted by the API (card 1.4); not yet on the shared client type. */
type RuleAction = AutomationAction & {
  tags?: string[];
  categoryId?: string;
  target?: string;
  to?: string;
  address?: string;
  subject?: string;
};

const MAX_TAGS_PER_ACTION = 5;
const FOLLOWER_TARGET_OPTIONS = [
  { value: "requester", label: "Requester" },
  { value: "assignee", label: "Assignee" },
  { value: "user", label: "Specific person" },
];
const EMAIL_RECIPIENT_OPTIONS = [
  { value: "requester", label: "Requester" },
  { value: "assignee", label: "Assignee" },
  { value: "team_leads", label: "Team leads" },
  { value: "address", label: "Email address" },
];
const EMAIL_PLACEHOLDER_HINT =
  "Placeholders: {{ticket.displayId}}, {{ticket.subject}}, {{requester.displayName}}. Only the ticket subject is exposed — never descriptions or messages; an external address still receives that subject.";

function parseTagList(raw: string): string[] {
  // Comma-separated tag names, trimmed, capped at the API limit.
  return raw
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean)
    .slice(0, MAX_TAGS_PER_ACTION);
}

type AutomationForm = {
  name: string;
  description: string;
  enabled: boolean;
  trigger: string;
  priority: number;
  teamId: string;
  conditions: FlatCondition[];
  actions: FlatAction[];
};

type MemberOption = {
  id: string;
  label: string;
  email: string;
};

const TRIGGERS = [
  { value: "TICKET_CREATED", label: "Ticket Created" },
  { value: "STATUS_CHANGED", label: "Status Changed" },
  { value: "SLA_APPROACHING", label: "SLA Approaching" },
  { value: "SLA_BREACHED", label: "SLA Breached" },
  { value: "TIME_IN_STATUS", label: "Time in Status" },
  { value: "UNASSIGNED_FOR", label: "Unassigned For" },
];

const CONDITION_FIELDS = [
  "subject",
  "description",
  "priority",
  "status",
  "assignedTeamId",
  "assigneeId",
  "categoryId",
  "requesterId",
  "hoursSinceActivity",
  "hoursUnassigned",
];

const CONDITION_OPS = [
  "contains",
  "equals",
  "gte",
  "notEquals",
  "in",
  "notIn",
  "isEmpty",
  "isNotEmpty",
];

const ACTION_TYPES = [
  { value: "set_status", label: "Set Status" },
  { value: "assign_team", label: "Assign Team" },
  { value: "assign_user", label: "Assign User" },
  { value: "notify_team_lead", label: "Notify Team Lead" },
  { value: "notify_requester", label: "Notify requester (in-app)" },
  { value: "add_internal_note", label: "Add Internal Note" },
  { value: "set_priority", label: "Set Priority" },
  { value: "add_tag", label: "Add tags" },
  { value: "remove_tag", label: "Remove tags" },
  { value: "set_category", label: "Set category" },
  { value: "add_follower", label: "Add follower" },
  { value: "send_email", label: "Send email" },
];

const HOUR_FIELDS = ["hoursSinceActivity", "hoursUnassigned"];
const FIELD_LABELS: Record<string, string> = {
  hoursSinceActivity: "hours since activity",
  hoursUnassigned: "hours unassigned",
};
const OP_LABELS: Record<string, string> = { gte: "is at least" };

function timeTriggerConditions(trigger: string): FlatCondition[] | null {
  // Time triggers need their threshold condition; pre-add it so the rule saves.
  if (trigger === "TIME_IN_STATUS") {
    return [
      { field: "status", op: "equals", val: "" },
      { field: "hoursSinceActivity", op: "gte", val: "" },
    ];
  }
  if (trigger === "UNASSIGNED_FOR") {
    return [{ field: "hoursUnassigned", op: "gte", val: "" }];
  }
  return null;
}

const PRIORITY_OPTIONS = ["SEV1", "SEV2", "SEV3", "SEV4"];

const STATUS_OPTIONS = [
  "NEW",
  "TRIAGED",
  "ASSIGNED",
  "IN_PROGRESS",
  "WAITING_ON_REQUESTER",
  "WAITING_ON_VENDOR",
  "RESOLVED",
  "CLOSED",
  "REOPENED",
];

const EMPTY_CONDITION: FlatCondition = {
  field: "status",
  op: "equals",
  val: "",
};
const EMPTY_ACTION: FlatAction = { type: "set_status", val: "" };

function toApiConditions(conditions: FlatCondition[]): AutomationCondition[] {
  // Convert flat condition rows into API-ready condition objects.
  const next: AutomationCondition[] = [];
  conditions.forEach((condition) => {
    const field = condition.field.trim();
    const op = condition.op.trim();
    const val = condition.val.trim();
    if (!field || !op) return;
    if (op !== "isEmpty" && op !== "isNotEmpty" && !val) return;
    next.push({
      field,
      operator: op,
      value:
        op === "isEmpty" || op === "isNotEmpty"
          ? undefined
          : HOUR_FIELDS.includes(field)
            ? Number(val)
            : val,
    });
  });
  return next;
}

function toApiActions(
  actions: FlatAction[],
  role: Role,
  teamId: string,
  memberOptions: MemberOption[],
): AutomationAction[] {
  // Convert flat actions into API-ready automation actions.
  const next: RuleAction[] = [];
  actions.forEach((action) => {
    const type = action.type;
    const val = action.val.trim();
    if (!type) return;

    if (type === "notify_team_lead") {
      next.push({ type: "notify_team_lead" });
      return;
    }

    if (type === "notify_requester") {
      next.push(
        val
          ? { type: "notify_requester", body: val }
          : { type: "notify_requester" },
      );
      return;
    }

    if (type === "add_follower") {
      const target = action.target ?? "requester";
      if (target === "user") {
        if (val) next.push({ type: "add_follower", userId: val });
      } else {
        next.push({ type: "add_follower", target });
      }
      return;
    }

    if (type === "send_email") {
      const to = action.to ?? "requester";
      const subject = (action.subject ?? "").trim();
      const address = (action.address ?? "").trim();
      if (!subject || !val) return;
      if (to === "address" && !address) return;
      next.push({
        type: "send_email",
        to,
        subject,
        body: val,
        ...(to === "address" ? { address } : {}),
      });
      return;
    }

    if (!val) return;

    if (type === "add_tag" || type === "remove_tag") {
      const tags = parseTagList(val);
      if (tags.length > 0) next.push({ type, tags });
      return;
    }

    if (type === "set_category") {
      next.push({ type: "set_category", categoryId: val });
      return;
    }

    if (type === "assign_team") {
      next.push({ type: "assign_team", teamId: val });
      return;
    }

    if (type === "assign_user") {
      if (role !== "TEAM_ADMIN" || !teamId) return;
      const member = memberOptions.find((item) => item.id === val);
      if (!member) return;
      next.push({ type: "assign_user", userId: member.id, teamId });
      return;
    }

    if (type === "set_priority") {
      next.push({ type: "set_priority", priority: val });
      return;
    }

    if (type === "set_status") {
      next.push({ type: "set_status", status: val });
      return;
    }

    if (type === "add_internal_note") {
      next.push({ type: "add_internal_note", body: val });
    }
  });
  return next;
}

function resolveTeamAdminScopeTeamId(teamsList: TeamRef[]): string {
  // Resolve the single-team scope id for team admins.
  return teamsList.length === 1 ? teamsList[0].id : "";
}

export function NewAutomationRulePage({
  teamsList,
  role,
}: {
  teamsList: TeamRef[];
  role: Role;
}) {
  // Render a dedicated page for creating a new automation rule.
  const headerCtx = useHeaderContext();
  const toast = useToast();
  const navigate = useNavigate();

  const isTeamAdmin = role === "TEAM_ADMIN";
  const teamAdminScopeTeamId = isTeamAdmin
    ? resolveTeamAdminScopeTeamId(teamsList)
    : "";

  const [memberOptions, setMemberOptions] = useState<MemberOption[]>([]);
  const [categories, setCategories] = useState<CategoryRef[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState<AutomationForm>(() => ({
    name: "",
    description: "",
    enabled: true,
    trigger: "TICKET_CREATED",
    priority: 1,
    teamId: isTeamAdmin ? teamAdminScopeTeamId : "",
    conditions: [{ ...EMPTY_CONDITION }],
    actions: [{ ...EMPTY_ACTION }],
  }));

  useEffect(() => {
    // Load assignable members for team admins.
    if (!isTeamAdmin || !teamAdminScopeTeamId) {
      setMemberOptions([]);
      return;
    }
    setLoadingMembers(true);
    fetchTeamMembers(teamAdminScopeTeamId)
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
  }, [isTeamAdmin, teamAdminScopeTeamId, toast]);

  useEffect(() => {
    // Active categories for the "Set category" action.
    fetchCategories({ includeInactive: false })
      .then((response) => setCategories(response.data))
      .catch(() => setCategories([]));
  }, []);

  const canSubmit = useMemo(() => {
    if (!form.name.trim()) return false;
    const conditions = toApiConditions(form.conditions);
    if (conditions.length === 0) return false;
    const actions = toApiActions(
      form.actions,
      role,
      form.teamId,
      memberOptions,
    );
    if (actions.length === 0) return false;
    return true;
  }, [
    form.actions,
    form.conditions,
    form.name,
    form.teamId,
    memberOptions,
    role,
  ]);

  function handleAddCondition() {
    // Append a new condition row.
    setForm((prev) => ({
      ...prev,
      conditions: [...prev.conditions, { ...EMPTY_CONDITION }],
    }));
  }

  function handleRemoveCondition(index: number) {
    // Remove a condition row if more than one exists.
    setForm((prev) => {
      if (prev.conditions.length === 1) return prev;
      return {
        ...prev,
        conditions: prev.conditions.filter(
          (_, itemIndex) => itemIndex !== index,
        ),
      };
    });
  }

  function handleUpdateCondition(
    index: number,
    key: keyof FlatCondition,
    value: string,
  ) {
    // Update a specific field of a condition row.
    setForm((prev) => ({
      ...prev,
      conditions: prev.conditions.map((condition, itemIndex) =>
        itemIndex === index ? { ...condition, [key]: value } : condition,
      ),
    }));
  }

  function handleAddAction() {
    // Append a new action row.
    setForm((prev) => ({
      ...prev,
      actions: [...prev.actions, { ...EMPTY_ACTION }],
    }));
  }

  function handleRemoveAction(index: number) {
    // Remove an action row if more than one exists.
    setForm((prev) => {
      if (prev.actions.length === 1) return prev;
      return {
        ...prev,
        actions: prev.actions.filter((_, itemIndex) => itemIndex !== index),
      };
    });
  }

  function handleUpdateAction(
    index: number,
    key: keyof FlatAction,
    value: string,
  ) {
    // Update a specific field of an action row.
    setForm((prev) => ({
      ...prev,
      actions: prev.actions.map((action, itemIndex) =>
        itemIndex === index
          ? key === "type"
            ? { type: value, val: "" }
            : { ...action, [key]: value }
          : action,
      ),
    }));
  }

  async function handleSubmit() {
    // Validate and submit the new automation rule to the API.
    const name = form.name.trim();
    if (!name) {
      const message = "Automation name is required.";
      setError(message);
      toast.error(message);
      return;
    }

    const conditions = toApiConditions(form.conditions);
    if (conditions.length === 0) {
      const message = "Add at least one valid condition.";
      setError(message);
      toast.error(message);
      return;
    }

    const teamId = isTeamAdmin ? teamAdminScopeTeamId : form.teamId.trim();
    if (
      !teamId &&
      form.actions.some((action) => action.type === "assign_user")
    ) {
      const message = "Assign user actions require a scoped team.";
      setError(message);
      toast.error(message);
      return;
    }

    const actions = toApiActions(form.actions, role, teamId, memberOptions);
    if (actions.length === 0) {
      const message = "Add at least one valid action.";
      setError(message);
      toast.error(message);
      return;
    }

    const payload: Parameters<typeof createAutomationRule>[0] = {
      name,
      description: form.description.trim() || undefined,
      trigger: form.trigger,
      conditions,
      actions,
      isActive: form.enabled,
      priority: Math.max(1, Number(form.priority) || 1),
      ...(teamId ? { teamId } : {}),
    };

    setSaving(true);
    setError(null);
    try {
      await createAutomationRule(payload);
      toast.success("Automation rule created.");
      navigate("/automation");
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
        <div className="mx-auto max-w-[1600px] py-4 px-6">
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
                    New Automation
                  </h1>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    Define triggers, conditions, and actions that run
                    automatically on tickets.
                  </p>
                </div>
              }
            />
          ) : (
            <div className="min-w-0">
              <h1 className="text-xl font-semibold text-foreground">
                New Automation
              </h1>
              <p className="mt-0.5 text-sm text-muted-foreground">
                Define triggers, conditions, and actions that run automatically
                on tickets.
              </p>
            </div>
          )}
        </div>
      </div>

      <div className="mx-auto w-full max-w-[1000px] px-6 py-8">
        <button
          type="button"
          onClick={() => navigate("/automation")}
          className="mb-4 inline-flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>Back to automations</span>
        </button>

        {error && (
          <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
            {error}
          </div>
        )}

        <div className="rounded-2xl border border-border bg-card shadow-sm">
          <div className="border-b border-border px-6 py-4">
            <h2 className="text-lg font-semibold text-foreground">
              Automation configuration
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Automations are evaluated when their trigger fires. The first
              matching automation for a ticket will run its actions.
            </p>
          </div>

          <div className="space-y-6 px-6 py-6">
            <div className="grid gap-4 md:grid-cols-3">
              <div className="md:col-span-2">
                <label className="mb-1 block text-sm font-medium text-foreground">
                  Automation name <span className="text-red-500">*</span>
                </label>
                <input
                  value={form.name}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, name: event.target.value }))
                  }
                  className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:border-transparent focus:ring-2 focus:ring-ring"
                  placeholder="e.g. Auto-close resolved tickets after 5 days"
                />
              </div>
              <div className="space-y-2">
                <label className="mb-1 block text-sm font-medium text-foreground">
                  Trigger
                </label>
                <select
                  value={form.trigger}
                  onChange={(event) => {
                    const nextTrigger = event.target.value;
                    setForm((prev) => ({
                      ...prev,
                      trigger: nextTrigger,
                      conditions:
                        timeTriggerConditions(nextTrigger) ?? prev.conditions,
                    }));
                  }}
                  className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm focus:border-transparent focus:ring-2 focus:ring-ring"
                >
                  {TRIGGERS.map((trigger) => (
                    <option key={trigger.value} value={trigger.value}>
                      {trigger.label}
                    </option>
                  ))}
                </select>
                <label className="mb-1 mt-3 block text-sm font-medium text-foreground">
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
                  Lower numbers run first. The first matching automation is
                  used.
                </p>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              <div className="md:col-span-2">
                <label className="mb-1 block text-sm font-medium text-foreground">
                  Description <span className="text-muted-foreground">(optional)</span>
                </label>
                <textarea
                  value={form.description}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      description: event.target.value,
                    }))
                  }
                  rows={3}
                  className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:border-transparent focus:ring-2 focus:ring-ring"
                  placeholder="Explain what this automation does so your team can understand it at a glance."
                />
              </div>
              <div className="flex flex-col justify-between gap-4">
                <div className="flex items-center justify-between rounded-xl border border-border bg-muted px-4 py-3">
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      Rule status
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Disable to keep the automation configured but inactive.
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

                {!isTeamAdmin && (
                  <div>
                    <label className="mb-1 block text-sm font-medium text-foreground">
                      Scope
                    </label>
                    <select
                      value={form.teamId}
                      onChange={(event) =>
                        setForm((prev) => ({
                          ...prev,
                          teamId: event.target.value,
                        }))
                      }
                      className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm focus:border-transparent focus:ring-2 focus:ring-ring"
                    >
                      <option value="">Global (all teams)</option>
                      {teamsList.map((team) => (
                        <option key={team.id} value={team.id}>
                          {team.name}
                        </option>
                      ))}
                    </select>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Limit this automation to a specific team, or leave as
                      global.
                    </p>
                  </div>
                )}
              </div>
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <p className="text-sm font-semibold text-foreground">
                  Conditions
                </p>
                <span className="text-xs text-muted-foreground">
                  All conditions must match for the automation to run.
                </span>
              </div>
              <div className="space-y-2">
                {form.conditions.map((condition, index) => (
                  <div
                    key={`condition-${index}`}
                    className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted p-2.5"
                  >
                    <select
                      value={condition.field}
                      onChange={(event) =>
                        handleUpdateCondition(
                          index,
                          "field",
                          event.target.value,
                        )
                      }
                      className="min-w-[120px] flex-1 rounded-lg border border-border bg-card px-2 py-1.5 text-sm focus:border-transparent focus:ring-2 focus:ring-ring"
                    >
                      <option value="">Field…</option>
                      {CONDITION_FIELDS.map((field) => (
                        <option key={field} value={field}>
                          {FIELD_LABELS[field] ?? field.replace("_", " ")}
                        </option>
                      ))}
                    </select>
                    <select
                      value={condition.op}
                      onChange={(event) =>
                        handleUpdateCondition(index, "op", event.target.value)
                      }
                      className="w-28 rounded-lg border border-border bg-card px-2 py-1.5 text-sm focus:border-transparent focus:ring-2 focus:ring-ring"
                    >
                      {CONDITION_OPS.map((op) => (
                        <option key={op} value={op}>
                          {OP_LABELS[op] ?? op}
                        </option>
                      ))}
                    </select>
                    {condition.op !== "isEmpty" &&
                      condition.op !== "isNotEmpty" && (
                        <input
                          type={
                            HOUR_FIELDS.includes(condition.field)
                              ? "number"
                              : "text"
                          }
                          min={
                            HOUR_FIELDS.includes(condition.field) ? 0 : undefined
                          }
                          value={condition.val}
                          onChange={(event) =>
                            handleUpdateCondition(
                              index,
                              "val",
                              event.target.value,
                            )
                          }
                          className="min-w-[140px] flex-1 rounded-lg border border-border px-2 py-1.5 text-sm focus:border-transparent focus:ring-2 focus:ring-ring"
                          placeholder={
                            HOUR_FIELDS.includes(condition.field)
                              ? "hours"
                              : "value…"
                          }
                        />
                      )}
                    <button
                      type="button"
                      onClick={() => handleRemoveCondition(index)}
                      className="text-muted-foreground hover:text-red-500"
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
                  className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:text-primary/80"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>Add condition</span>
                </button>
              </div>
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <p className="text-sm font-semibold text-foreground">Actions</p>
                <span className="text-xs text-muted-foreground">
                  Actions run in order when the conditions match.
                </span>
              </div>
              <div className="space-y-2">
                {form.actions.map((action, index) => (
                  <div
                    key={`action-${index}`}
                    className="flex flex-wrap items-center gap-2 rounded-lg border border-green-500/20 bg-green-500/10 p-2.5"
                  >
                    <svg
                      className="h-4 w-4 flex-shrink-0 text-green-500"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M5 13l4 4L19 7"
                      />
                    </svg>
                    <select
                      value={action.type}
                      onChange={(event) =>
                        handleUpdateAction(index, "type", event.target.value)
                      }
                      className="min-w-[150px] rounded-lg border border-green-500/20 bg-card px-2 py-1.5 text-sm focus:border-transparent focus:ring-2 focus:ring-ring"
                    >
                      {ACTION_TYPES.filter((item) =>
                        item.value === "assign_user" ? isTeamAdmin : true,
                      ).map((item) => (
                        <option key={item.value} value={item.value}>
                          {item.label}
                        </option>
                      ))}
                    </select>

                    {action.type === "assign_team" && (
                      <select
                        value={action.val}
                        onChange={(event) =>
                          handleUpdateAction(index, "val", event.target.value)
                        }
                        className="min-w-[160px] flex-1 rounded-lg border border-green-500/20 bg-card px-2 py-1.5 text-sm focus:border-transparent focus:ring-2 focus:ring-ring"
                      >
                        <option value="">Select team…</option>
                        {teamsList.map((team) => (
                          <option key={team.id} value={team.id}>
                            {team.name}
                          </option>
                        ))}
                      </select>
                    )}

                    {action.type === "assign_user" && (
                      <select
                        value={action.val}
                        onChange={(event) =>
                          handleUpdateAction(index, "val", event.target.value)
                        }
                        className="min-w-[160px] flex-1 rounded-lg border border-green-500/20 bg-card px-2 py-1.5 text-sm focus:border-transparent focus:ring-2 focus:ring-ring"
                        disabled={loadingMembers || !teamAdminScopeTeamId}
                      >
                        <option value="">
                          {loadingMembers
                            ? "Loading users…"
                            : teamAdminScopeTeamId
                              ? "Select user…"
                              : "User assignment requires a scoped team."}
                        </option>
                        {memberOptions.map((user) => (
                          <option key={user.id} value={user.id}>
                            {user.label}
                          </option>
                        ))}
                      </select>
                    )}

                    {action.type === "set_priority" && (
                      <select
                        value={action.val}
                        onChange={(event) =>
                          handleUpdateAction(index, "val", event.target.value)
                        }
                        className="min-w-[120px] rounded-lg border border-green-500/20 bg-card px-2 py-1.5 text-sm focus:border-transparent focus:ring-2 focus:ring-ring"
                      >
                        <option value="">Select priority…</option>
                        {PRIORITY_OPTIONS.map((priority) => (
                          <option key={priority} value={priority}>
                            {priority}
                          </option>
                        ))}
                      </select>
                    )}

                    {action.type === "set_status" && (
                      <select
                        value={action.val}
                        onChange={(event) =>
                          handleUpdateAction(index, "val", event.target.value)
                        }
                        className="min-w-[140px] rounded-lg border border-green-500/20 bg-card px-2 py-1.5 text-sm focus:border-transparent focus:ring-2 focus:ring-ring"
                      >
                        <option value="">Select status…</option>
                        {STATUS_OPTIONS.map((status) => (
                          <option key={status} value={status}>
                            {status}
                          </option>
                        ))}
                      </select>
                    )}

                    {action.type === "add_internal_note" && (
                      <input
                        value={action.val}
                        onChange={(event) =>
                          handleUpdateAction(index, "val", event.target.value)
                        }
                        className="min-w-[160px] flex-1 rounded-lg border border-green-500/20 bg-card text-foreground px-2 py-1.5 text-sm focus:border-transparent focus:ring-2 focus:ring-ring"
                        placeholder="Note content…"
                      />
                    )}

                    {action.type === "notify_requester" && (
                      <input
                        value={action.val}
                        onChange={(event) =>
                          handleUpdateAction(index, "val", event.target.value)
                        }
                        className="min-w-[160px] flex-1 rounded-lg border border-green-500/20 bg-card text-foreground px-2 py-1.5 text-sm focus:border-transparent focus:ring-2 focus:ring-ring"
                        placeholder="Reminder text (optional)"
                      />
                    )}

                    {(action.type === "add_tag" ||
                      action.type === "remove_tag") && (
                      <input
                        value={action.val}
                        onChange={(event) =>
                          handleUpdateAction(index, "val", event.target.value)
                        }
                        className="min-w-[160px] flex-1 rounded-lg border border-green-500/20 bg-card text-foreground px-2 py-1.5 text-sm focus:border-transparent focus:ring-2 focus:ring-ring"
                        placeholder="Tags, comma-separated (max 5)"
                      />
                    )}

                    {action.type === "set_category" && (
                      <select
                        value={action.val}
                        onChange={(event) =>
                          handleUpdateAction(index, "val", event.target.value)
                        }
                        className="min-w-[150px] rounded-lg border border-green-500/20 bg-card px-2 py-1.5 text-sm focus:border-transparent focus:ring-2 focus:ring-ring"
                      >
                        <option value="">Select category…</option>
                        {categories.map((category) => (
                          <option key={category.id} value={category.id}>
                            {category.name}
                          </option>
                        ))}
                      </select>
                    )}

                    {action.type === "add_follower" && (
                      <>
                        <select
                          value={action.target ?? "requester"}
                          onChange={(event) =>
                            handleUpdateAction(
                              index,
                              "target",
                              event.target.value,
                            )
                          }
                          className="min-w-[150px] rounded-lg border border-green-500/20 bg-card px-2 py-1.5 text-sm focus:border-transparent focus:ring-2 focus:ring-ring"
                        >
                          {FOLLOWER_TARGET_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                        {(action.target ?? "requester") === "user" &&
                          (memberOptions.length > 0 ? (
                            <select
                              value={action.val}
                              onChange={(event) =>
                                handleUpdateAction(
                                  index,
                                  "val",
                                  event.target.value,
                                )
                              }
                              className="min-w-[150px] rounded-lg border border-green-500/20 bg-card px-2 py-1.5 text-sm focus:border-transparent focus:ring-2 focus:ring-ring"
                            >
                              <option value="">Select person…</option>
                              {memberOptions.map((user) => (
                                <option key={user.id} value={user.id}>
                                  {user.label}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <input
                              value={action.val}
                              onChange={(event) =>
                                handleUpdateAction(
                                  index,
                                  "val",
                                  event.target.value,
                                )
                              }
                              className="min-w-[160px] flex-1 rounded-lg border border-green-500/20 bg-card text-foreground px-2 py-1.5 text-sm focus:border-transparent focus:ring-2 focus:ring-ring"
                              placeholder="User id"
                            />
                          ))}
                      </>
                    )}

                    {action.type === "send_email" && (
                      <div className="flex flex-1 flex-wrap items-center gap-2">
                        <select
                          value={action.to ?? "requester"}
                          onChange={(event) =>
                            handleUpdateAction(index, "to", event.target.value)
                          }
                          className="min-w-[150px] rounded-lg border border-green-500/20 bg-card px-2 py-1.5 text-sm focus:border-transparent focus:ring-2 focus:ring-ring"
                        >
                          {EMAIL_RECIPIENT_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                        {(action.to ?? "requester") === "address" && (
                          <input
                            type="email"
                            value={action.address ?? ""}
                            onChange={(event) =>
                              handleUpdateAction(
                                index,
                                "address",
                                event.target.value,
                              )
                            }
                            className="min-w-[160px] flex-1 rounded-lg border border-green-500/20 bg-card text-foreground px-2 py-1.5 text-sm focus:border-transparent focus:ring-2 focus:ring-ring"
                            placeholder="name@example.com"
                          />
                        )}
                        <input
                          value={action.subject ?? ""}
                          maxLength={200}
                          onChange={(event) =>
                            handleUpdateAction(
                              index,
                              "subject",
                              event.target.value,
                            )
                          }
                          className="min-w-[160px] flex-1 rounded-lg border border-green-500/20 bg-card text-foreground px-2 py-1.5 text-sm focus:border-transparent focus:ring-2 focus:ring-ring"
                          placeholder="Subject"
                        />
                        <input
                          value={action.val}
                          maxLength={4000}
                          onChange={(event) =>
                            handleUpdateAction(index, "val", event.target.value)
                          }
                          className="min-w-[160px] flex-1 rounded-lg border border-green-500/20 bg-card text-foreground px-2 py-1.5 text-sm focus:border-transparent focus:ring-2 focus:ring-ring"
                          placeholder="Body"
                        />
                        <span className="w-full text-[11px] text-muted-foreground">
                          {EMAIL_PLACEHOLDER_HINT}
                        </span>
                      </div>
                    )}

                    {action.type === "notify_team_lead" && (
                      <span className="text-xs text-green-400">
                        Sends a notification to the scoped team&apos;s lead.
                      </span>
                    )}

                    <button
                      type="button"
                      onClick={() => handleRemoveAction(index)}
                      className="text-muted-foreground hover:text-red-500"
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
                  onClick={handleAddAction}
                  className="inline-flex items-center gap-1 text-xs font-medium text-green-400 hover:text-green-300"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>Add action</span>
                </button>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between rounded-b-2xl border-t border-border bg-muted px-6 py-4">
            <span className="text-xs text-muted-foreground">
              * Required fields. Automations are logged in the audit log when
              they run.
            </span>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => navigate("/automation")}
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
                Create automation
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
