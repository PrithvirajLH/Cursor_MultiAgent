import { useEffect, useMemo, useState } from "react";
import {
  Plus,
  Pencil,
  Trash2,
  ArrowRight,
  Filter,
  Zap,
  Route,
} from "lucide-react";
import {
  createRoutingRule,
  deleteRoutingRule,
  fetchCategories,
  fetchTeamMembers,
  fetchRoutingRules,
  updateRoutingRule,
  type CategoryRef,
  type RoutingActionItem,
  type RoutingActionType,
  type RoutingCondition,
  type RoutingConditionField,
  type RoutingConditionOp,
  type RoutingMatchType,
  type RoutingRule,
  type TeamMember,
  type TeamRef,
} from "../api/client";
import { TopBar } from "../components/TopBar";
import { Drawer } from "../components/ui/Drawer";
import { EmptyState } from "../components/ui/EmptyState";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { useHeaderContext } from "../contexts/HeaderContext";
import { useToast } from "../hooks/useToast";
import {
  REALTIME_ADMIN_CHANGED_EVENT,
  type RealtimeAdminChangedEventPayload,
} from "../realtime/events";
import type { Role } from "../types";
import { handleApiError } from "../utils/handleApiError";

type MemberOption = { id: string; label: string; email: string };

type BuilderForm = {
  id: string | null;
  name: string;
  enabled: boolean;
  matchType: RoutingMatchType;
  conditions: RoutingCondition[];
  actions: RoutingActionItem[];
};

type FieldKind = "text" | "priority" | "category" | "channel";

const FIELD_OPTIONS: {
  value: RoutingConditionField;
  label: string;
  kind: FieldKind;
}[] = [
  { value: "subject", label: "Subject", kind: "text" },
  { value: "message", label: "Message text", kind: "text" },
  { value: "priority", label: "Priority", kind: "priority" },
  { value: "category", label: "Category", kind: "category" },
  { value: "channel", label: "Channel", kind: "channel" },
  { value: "sender", label: "Sender email", kind: "text" },
];

const FIELD_LABEL: Record<RoutingConditionField, string> = Object.fromEntries(
  FIELD_OPTIONS.map((f) => [f.value, f.label]),
) as Record<RoutingConditionField, string>;

const FIELD_KIND: Record<RoutingConditionField, FieldKind> = Object.fromEntries(
  FIELD_OPTIONS.map((f) => [f.value, f.kind]),
) as Record<RoutingConditionField, FieldKind>;

const TEXT_OPS: { value: RoutingConditionOp; label: string }[] = [
  { value: "contains", label: "contains" },
  { value: "not_contains", label: "does not contain" },
];
const ENUM_OPS: { value: RoutingConditionOp; label: string }[] = [
  { value: "is", label: "is" },
  { value: "is_not", label: "is not" },
];

const OP_LABEL: Record<RoutingConditionOp, string> = {
  contains: "contains",
  not_contains: "does not contain",
  is: "is",
  is_not: "is not",
};

const PRIORITY_OPTIONS = [
  { value: "SEV1", label: "SEV1" },
  { value: "SEV2", label: "SEV2" },
  { value: "SEV3", label: "SEV3" },
  { value: "SEV4", label: "SEV4" },
];
const CHANNEL_OPTIONS = [
  { value: "PORTAL", label: "Portal" },
  { value: "EMAIL", label: "Email" },
  { value: "API", label: "API" },
  { value: "AGENT_PORTAL", label: "Agent Portal" },
];

const ACTION_LABEL: Record<RoutingActionType, string> = {
  assign_team: "Assign to team",
  assign_member: "Assign to member",
  set_priority: "Set priority",
  add_tag: "Add tag",
};

function opsForField(field: RoutingConditionField) {
  return FIELD_KIND[field] === "text" ? TEXT_OPS : ENUM_OPS;
}

function defaultValueForField(field: RoutingConditionField): string {
  switch (FIELD_KIND[field]) {
    case "priority":
      return "SEV3";
    case "channel":
      return "EMAIL";
    default:
      return "";
  }
}

function emptyForm(isTeamAdmin: boolean): BuilderForm {
  return {
    id: null,
    name: "",
    enabled: true,
    matchType: "ALL",
    conditions: [{ field: "subject", op: "contains", value: "" }],
    actions: [
      { type: isTeamAdmin ? "assign_member" : "assign_team", value: "" },
    ],
  };
}

function ruleToForm(rule: RoutingRule, isTeamAdmin: boolean): BuilderForm {
  const conditions: RoutingCondition[] =
    rule.conditions && rule.conditions.length > 0
      ? rule.conditions.map((c) => ({ ...c }))
      : rule.keywords.length > 0
        ? rule.keywords.map((keyword) => ({
            field: "subject" as const,
            op: "contains" as const,
            value: keyword,
          }))
        : [{ field: "subject", op: "contains", value: "" }];

  const actions: RoutingActionItem[] =
    rule.actions && rule.actions.length > 0
      ? rule.actions.map((a) => ({ ...a }))
      : [
          {
            type: rule.assigneeId ? "assign_member" : "assign_team",
            value: rule.assigneeId ?? rule.teamId,
          },
        ];

  return {
    id: rule.id,
    name: rule.name,
    enabled: rule.isActive,
    matchType: rule.matchType ?? "ALL",
    conditions,
    actions: isTeamAdmin
      ? actions.map((a) =>
          a.type === "assign_team" ? { ...a, type: "assign_member" } : a,
        )
      : actions,
  };
}

function Toggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="relative inline-flex h-[22px] w-10 items-center">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="peer sr-only"
      />
      <span className="absolute inset-0 cursor-pointer rounded-full bg-muted transition peer-checked:bg-primary peer-disabled:cursor-not-allowed peer-disabled:opacity-60" />
      <span className="absolute bottom-[3px] left-[3px] h-4 w-4 rounded-full bg-white transition-transform peer-checked:translate-x-[18px]" />
    </label>
  );
}

export function RoutingRulesPage({
  teamsList,
  role,
}: {
  teamsList: TeamRef[];
  role: Role;
}) {
  const headerCtx = useHeaderContext();
  const toast = useToast();
  const isTeamAdmin = role === "TEAM_ADMIN";

  const [rules, setRules] = useState<RoutingRule[]>([]);
  const [memberOptions, setMemberOptions] = useState<MemberOption[]>([]);
  const [categories, setCategories] = useState<CategoryRef[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [updatingRuleId, setUpdatingRuleId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [form, setForm] = useState<BuilderForm>(() => emptyForm(isTeamAdmin));
  const [deleteTarget, setDeleteTarget] = useState<RoutingRule | null>(null);
  const [deleting, setDeleting] = useState(false);

  const teamName = useMemo(() => {
    const map = new Map(teamsList.map((t) => [t.id, t.name]));
    // Rules may reference a team that isn't in the (possibly scoped) teamsList;
    // the API includes the team ref, so fold those names in too.
    rules.forEach((r) => {
      if (r.team?.id && r.team.name) map.set(r.team.id, r.team.name);
    });
    return (id: string) => map.get(id) ?? id;
  }, [teamsList, rules]);
  const memberName = useMemo(() => {
    const map = new Map(memberOptions.map((m) => [m.id, m.label]));
    rules.forEach((r) => {
      if (r.assignee?.id) {
        map.set(r.assignee.id, r.assignee.displayName || r.assignee.email);
      }
    });
    return (id: string) => map.get(id) ?? id;
  }, [memberOptions, rules]);
  const categoryName = useMemo(() => {
    const map = new Map(categories.map((c) => [c.id, c.name]));
    return (id: string) => map.get(id) ?? id;
  }, [categories]);

  useEffect(() => {
    void loadRules();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role]);

  useEffect(() => {
    let active = true;
    fetchCategories()
      .then((res) => {
        if (active) setCategories(res.data);
      })
      .catch(() => {
        /* category dropdown is optional */
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!isTeamAdmin) {
      setMemberOptions([]);
      return;
    }
    const teamId = teamsList[0]?.id;
    if (!teamId) {
      setMemberOptions([]);
      return;
    }
    let active = true;
    fetchTeamMembers(teamId)
      .then((response) => {
        if (!active) return;
        setMemberOptions(
          response.data
            .map((member: TeamMember) => ({
              id: member.user.id,
              label: member.user.displayName || member.user.email,
              email: member.user.email,
            }))
            .sort((a, b) => a.label.localeCompare(b.label)),
        );
      })
      .catch((err) => {
        if (!active) return;
        setMemberOptions([]);
        toast.error(handleApiError(err));
      });
    return () => {
      active = false;
    };
  }, [isTeamAdmin, teamsList, toast]);

  useEffect(() => {
    const handleAdminChanged = (event: Event) => {
      const payload = (event as CustomEvent<RealtimeAdminChangedEventPayload>)
        .detail;
      const scope = payload?.scope;
      if (
        scope !== "routing_rule" &&
        scope !== "team" &&
        scope !== "team_member"
      ) {
        return;
      }
      void loadRules();
    };
    window.addEventListener(
      REALTIME_ADMIN_CHANGED_EVENT,
      handleAdminChanged as EventListener,
    );
    return () =>
      window.removeEventListener(
        REALTIME_ADMIN_CHANGED_EVENT,
        handleAdminChanged as EventListener,
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadRules() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetchRoutingRules();
      setRules(response.data);
    } catch (err) {
      const message = handleApiError(err);
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }

  const sortedRules = useMemo(
    () =>
      [...rules].sort(
        (a, b) => a.priority - b.priority || a.name.localeCompare(b.name),
      ),
    [rules],
  );

  const actionTypeOptions = useMemo<
    { value: RoutingActionType; label: string }[]
  >(
    () =>
      (isTeamAdmin
        ? (["assign_member", "set_priority", "add_tag"] as const)
        : (["assign_team", "set_priority", "add_tag"] as const)
      ).map((value) => ({ value, label: ACTION_LABEL[value] })),
    [isTeamAdmin],
  );

  function openCreate() {
    setForm(emptyForm(isTeamAdmin));
    setDrawerOpen(true);
  }
  function openEdit(rule: RoutingRule) {
    setForm(ruleToForm(rule, isTeamAdmin));
    setDrawerOpen(true);
  }

  function describeAction(action: RoutingActionItem): string {
    switch (action.type) {
      case "assign_team":
        return `Assign to ${teamName(action.value)}`;
      case "assign_member":
        return `Assign to ${memberName(action.value)}`;
      case "set_priority":
        return `Set priority ${action.value}`;
      case "add_tag":
        return `Add tag "${action.value}"`;
      default:
        return action.type;
    }
  }

  function conditionValueLabel(condition: RoutingCondition): string {
    if (condition.field === "category") return categoryName(condition.value);
    if (condition.field === "channel") {
      return (
        CHANNEL_OPTIONS.find((c) => c.value === condition.value)?.label ??
        condition.value
      );
    }
    return condition.value;
  }

  function viewConditions(rule: RoutingRule): RoutingCondition[] {
    if (rule.conditions && rule.conditions.length > 0) return rule.conditions;
    return rule.keywords.map((keyword) => ({
      field: "subject",
      op: "contains",
      value: keyword,
    }));
  }
  function viewActions(rule: RoutingRule): RoutingActionItem[] {
    if (rule.actions && rule.actions.length > 0) return rule.actions;
    return [
      {
        type: rule.assigneeId ? "assign_member" : "assign_team",
        value: rule.assigneeId ?? rule.teamId,
      },
    ];
  }

  async function handleSave() {
    const cleanConditions = form.conditions.filter(
      (c) => c.value.trim() !== "",
    );
    const cleanActions = form.actions.filter((a) => a.value.trim() !== "");
    if (!form.name.trim()) {
      toast.error("Give the rule a name.");
      return;
    }
    if (cleanConditions.length === 0) {
      toast.error("Add at least one condition.");
      return;
    }
    const assignType: RoutingActionType = isTeamAdmin
      ? "assign_member"
      : "assign_team";
    if (!cleanActions.some((a) => a.type === assignType)) {
      toast.error(
        isTeamAdmin
          ? "Add an “Assign to member” action."
          : "Add an “Assign to team” action.",
      );
      return;
    }

    const payload = {
      name: form.name.trim(),
      matchType: form.matchType,
      conditions: cleanConditions,
      actions: cleanActions,
      isActive: form.enabled,
    };

    setSaving(true);
    try {
      if (form.id) {
        const updated = await updateRoutingRule(form.id, payload);
        setRules((prev) =>
          prev.map((rule) => (rule.id === form.id ? updated : rule)),
        );
        toast.success("Routing rule updated.");
      } else {
        const created = await createRoutingRule(payload);
        setRules((prev) => [...prev, created]);
        toast.success("Routing rule created.");
      }
      setDrawerOpen(false);
    } catch (err) {
      toast.error(handleApiError(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleRule(rule: RoutingRule, nextEnabled: boolean) {
    setUpdatingRuleId(rule.id);
    try {
      const updated = await updateRoutingRule(rule.id, {
        isActive: nextEnabled,
      });
      setRules((prev) =>
        prev.map((item) => (item.id === rule.id ? updated : item)),
      );
      toast.success(nextEnabled ? "Rule enabled." : "Rule disabled.");
    } catch (err) {
      toast.error(handleApiError(err));
    } finally {
      setUpdatingRuleId(null);
    }
  }

  async function handleDeleteRule() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteRoutingRule(deleteTarget.id);
      setRules((prev) => prev.filter((item) => item.id !== deleteTarget.id));
      toast.success("Routing rule deleted.");
      setDeleteTarget(null);
    } catch (err) {
      toast.error(handleApiError(err));
    } finally {
      setDeleting(false);
    }
  }

  // ——— builder mutations ———
  function setConditions(next: RoutingCondition[]) {
    setForm((prev) => ({ ...prev, conditions: next }));
  }
  function setActions(next: RoutingActionItem[]) {
    setForm((prev) => ({ ...prev, actions: next }));
  }

  const canEdit = role === "OWNER" || role === "TEAM_ADMIN";

  return (
    <section className="min-h-full bg-background animate-fade-in">
      <div className="sticky top-0 z-40 border-b border-border bg-card/90 backdrop-blur-sm">
        <div className="mx-auto max-w-none px-6 py-4">
          {headerCtx ? (
            <TopBar
              title={headerCtx.title}
              subtitle={headerCtx.subtitle}
              currentEmail={headerCtx.currentEmail}
              onOpenSearch={headerCtx.onOpenSearch}
              notificationProps={headerCtx.notificationProps}
              leftContent={
                <div className="min-w-0">
                  <h1 className="text-xl font-semibold text-foreground">
                    Routing Rules
                  </h1>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    Send incoming tickets to the right place automatically.
                  </p>
                </div>
              }
            />
          ) : (
            <div className="min-w-0">
              <h1 className="text-xl font-semibold text-foreground">
                Routing Rules
              </h1>
              <p className="mt-0.5 text-sm text-muted-foreground">
                Send incoming tickets to the right place automatically.
              </p>
            </div>
          )}
        </div>
      </div>

      <div className="mx-auto max-w-none p-6">
        {error && (
          <div className="mb-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400">
            {error}
          </div>
        )}

        <div className="mb-5 flex items-start justify-between gap-4 rounded-xl border border-border bg-card p-4">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-blue-50 text-primary dark:bg-blue-500/10">
              <Route className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-foreground">
                How routing works
              </h2>
              <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                Each rule reads like a sentence: <em>when</em> a ticket matches
                your conditions, <em>then</em> these actions run. Rules are
                checked top to bottom and the first match wins.
              </p>
            </div>
          </div>
          {canEdit && (
            <button
              type="button"
              onClick={openCreate}
              className="flex flex-shrink-0 items-center space-x-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-primary/90"
            >
              <Plus className="h-4 w-4" />
              <span>New Rule</span>
            </button>
          )}
        </div>

        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div
                key={`rule-skel-${i}`}
                className="rounded-xl border border-border bg-card p-5"
              >
                <div className="h-5 w-40 skeleton-shimmer rounded" />
                <div className="mt-3 h-4 w-3/4 skeleton-shimmer rounded" />
                <div className="mt-2 h-4 w-1/2 skeleton-shimmer rounded" />
              </div>
            ))}
          </div>
        ) : sortedRules.length === 0 ? (
          <EmptyState
            icon={<Route className="h-6 w-6" />}
            title="No routing rules yet"
            description="Create your first rule to automatically assign and prioritize incoming tickets — no code required."
            action={
              canEdit ? (
                <button
                  type="button"
                  onClick={openCreate}
                  className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-white hover:bg-primary/90"
                >
                  <Plus className="h-4 w-4" />
                  New Rule
                </button>
              ) : undefined
            }
          />
        ) : (
          <div className="space-y-3">
            {sortedRules.map((rule, index) => {
              const conditions = viewConditions(rule);
              const actions = viewActions(rule);
              const matchWord =
                (rule.matchType ?? "ALL") === "ANY" ? "any" : "all";
              return (
                <div
                  key={rule.id}
                  className={`rounded-xl border bg-card p-4 transition-all hover:shadow-sm ${
                    rule.isActive
                      ? "border-border"
                      : "border-border opacity-60"
                  }`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex min-w-0 items-start gap-3">
                      <span className="mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md bg-accent text-xs font-semibold text-muted-foreground">
                        {index + 1}
                      </span>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-semibold text-foreground">
                            {rule.name}
                          </span>
                          {!rule.isActive && (
                            <span className="rounded-md bg-accent px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                              Disabled
                            </span>
                          )}
                        </div>

                        {/* WHEN */}
                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          <span className="inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            <Filter className="h-3 w-3" /> When {matchWord} of
                          </span>
                          {conditions.map((condition, i) => (
                            <span
                              key={`c-${i}`}
                              className="inline-flex items-center gap-1 rounded-md bg-accent px-2 py-1 text-xs text-foreground"
                            >
                              <span className="text-muted-foreground">
                                {FIELD_LABEL[condition.field]}
                              </span>
                              <span className="text-muted-foreground">
                                {OP_LABEL[condition.op]}
                              </span>
                              <span className="font-semibold">
                                {conditionValueLabel(condition)}
                              </span>
                            </span>
                          ))}
                        </div>

                        {/* THEN */}
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                          <span className="inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-primary">
                            <ArrowRight className="h-3 w-3" /> Then
                          </span>
                          {actions.map((action, i) => (
                            <span
                              key={`a-${i}`}
                              className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium ${
                                action.type === "add_tag"
                                  ? "bg-purple-100 text-purple-700 dark:bg-purple-500/15 dark:text-purple-300"
                                  : action.type === "set_priority"
                                    ? "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300"
                                    : "bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300"
                              }`}
                            >
                              {describeAction(action)}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>

                    {canEdit && (
                      <div className="flex flex-shrink-0 items-center gap-2">
                        <Toggle
                          checked={rule.isActive}
                          disabled={updatingRuleId === rule.id}
                          onChange={(value) =>
                            void handleToggleRule(rule, value)
                          }
                        />
                        <button
                          type="button"
                          onClick={() => openEdit(rule)}
                          aria-label="Edit rule"
                          className="rounded p-1.5 text-muted-foreground hover:bg-blue-50 hover:text-primary dark:hover:bg-blue-500/10"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleteTarget(rule)}
                          aria-label="Delete rule"
                          className="rounded p-1.5 text-muted-foreground hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {drawerOpen && (
        <RuleBuilderDrawer
          form={form}
          setForm={setForm}
          setConditions={setConditions}
          setActions={setActions}
          actionTypeOptions={actionTypeOptions}
          teamsList={teamsList}
          memberOptions={memberOptions}
          categories={categories}
          isTeamAdmin={isTeamAdmin}
          saving={saving}
          onClose={() => setDrawerOpen(false)}
          onSave={() => void handleSave()}
          describeAction={describeAction}
          conditionValueLabel={conditionValueLabel}
        />
      )}

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete routing rule"
        message={
          <>
            Delete <strong>{deleteTarget?.name}</strong>? Incoming tickets will
            no longer be routed by this rule. This cannot be undone.
          </>
        }
        confirmLabel="Delete"
        destructive
        loading={deleting}
        onConfirm={() => void handleDeleteRule()}
        onCancel={() => setDeleteTarget(null)}
      />
    </section>
  );
}

function RuleBuilderDrawer({
  form,
  setForm,
  setConditions,
  setActions,
  actionTypeOptions,
  teamsList,
  memberOptions,
  categories,
  isTeamAdmin,
  saving,
  onClose,
  onSave,
  describeAction,
  conditionValueLabel,
}: {
  form: BuilderForm;
  setForm: React.Dispatch<React.SetStateAction<BuilderForm>>;
  setConditions: (next: RoutingCondition[]) => void;
  setActions: (next: RoutingActionItem[]) => void;
  actionTypeOptions: { value: RoutingActionType; label: string }[];
  teamsList: TeamRef[];
  memberOptions: MemberOption[];
  categories: CategoryRef[];
  isTeamAdmin: boolean;
  saving: boolean;
  onClose: () => void;
  onSave: () => void;
  describeAction: (action: RoutingActionItem) => string;
  conditionValueLabel: (condition: RoutingCondition) => string;
}) {
  const selectClass =
    "rounded-lg border border-border bg-card px-2 py-1.5 text-sm text-foreground focus:border-transparent focus:ring-2 focus:ring-ring";
  const inputClass =
    "flex-1 rounded-lg border border-border bg-card px-2 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-transparent focus:ring-2 focus:ring-ring";

  function updateCondition(
    index: number,
    patch: Partial<RoutingCondition>,
  ) {
    setConditions(
      form.conditions.map((c, i) => {
        if (i !== index) return c;
        const next = { ...c, ...patch };
        // When the field changes, reset op + value to valid defaults.
        if (patch.field && patch.field !== c.field) {
          next.op = opsForField(patch.field)[0].value;
          next.value = defaultValueForField(patch.field);
        }
        return next;
      }),
    );
  }

  function updateAction(index: number, patch: Partial<RoutingActionItem>) {
    setActions(
      form.actions.map((a, i) => {
        if (i !== index) return a;
        const next = { ...a, ...patch };
        if (patch.type && patch.type !== a.type) {
          next.value = patch.type === "set_priority" ? "SEV3" : "";
        }
        return next;
      }),
    );
  }

  function actionValueControl(action: RoutingActionItem, index: number) {
    if (action.type === "assign_team") {
      return (
        <select
          value={action.value}
          onChange={(e) => updateAction(index, { value: e.target.value })}
          className={`${selectClass} flex-1`}
        >
          <option value="">Select team…</option>
          {teamsList.map((team) => (
            <option key={team.id} value={team.id}>
              {team.name}
            </option>
          ))}
        </select>
      );
    }
    if (action.type === "assign_member") {
      return (
        <select
          value={action.value}
          onChange={(e) => updateAction(index, { value: e.target.value })}
          className={`${selectClass} flex-1`}
        >
          <option value="">Select member…</option>
          {memberOptions.map((member) => (
            <option key={member.id} value={member.id}>
              {member.label}
            </option>
          ))}
        </select>
      );
    }
    if (action.type === "set_priority") {
      return (
        <select
          value={action.value}
          onChange={(e) => updateAction(index, { value: e.target.value })}
          className={`${selectClass} flex-1`}
        >
          {PRIORITY_OPTIONS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      );
    }
    return (
      <input
        value={action.value}
        onChange={(e) => updateAction(index, { value: e.target.value })}
        placeholder="tag name…"
        className={inputClass}
      />
    );
  }

  function conditionValueControl(
    condition: RoutingCondition,
    index: number,
  ) {
    const kind = FIELD_KIND[condition.field];
    if (kind === "priority") {
      return (
        <select
          value={condition.value}
          onChange={(e) => updateCondition(index, { value: e.target.value })}
          className={`${selectClass} flex-1`}
        >
          {PRIORITY_OPTIONS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      );
    }
    if (kind === "channel") {
      return (
        <select
          value={condition.value}
          onChange={(e) => updateCondition(index, { value: e.target.value })}
          className={`${selectClass} flex-1`}
        >
          {CHANNEL_OPTIONS.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      );
    }
    if (kind === "category") {
      return (
        <select
          value={condition.value}
          onChange={(e) => updateCondition(index, { value: e.target.value })}
          className={`${selectClass} flex-1`}
        >
          <option value="">Select category…</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      );
    }
    return (
      <input
        value={condition.value}
        onChange={(e) => updateCondition(index, { value: e.target.value })}
        placeholder={
          condition.field === "sender" ? "e.g. @vip-client.com" : "type text…"
        }
        className={inputClass}
      />
    );
  }

  const previewConditions = form.conditions.filter(
    (c) => c.value.trim() !== "",
  );
  const previewActions = form.actions.filter((a) => a.value.trim() !== "");

  return (
    <Drawer
      open
      onClose={onClose}
      widthClassName="max-w-2xl"
      icon={
        <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-blue-100 dark:bg-blue-500/15">
          <Route className="h-4 w-4 text-primary" />
        </div>
      }
      title={form.id ? "Edit rule" : "New routing rule"}
      description="Describe when the rule applies and what it should do."
      footer={
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={saving}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary/90 disabled:opacity-60"
          >
            {saving ? "Saving…" : form.id ? "Save changes" : "Create rule"}
          </button>
        </div>
      }
    >
      <div className="space-y-6">
        {/* Name + enabled */}
        <div className="flex items-end gap-3">
          <div className="flex-1">
            <label className="mb-1 block text-xs font-medium text-foreground">
              Rule name
            </label>
            <input
              value={form.name}
              onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
              placeholder="e.g. Billing questions → Finance"
              className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-transparent focus:ring-2 focus:ring-ring"
            />
          </div>
          <div className="flex items-center gap-2 pb-1.5">
            <Toggle
              checked={form.enabled}
              onChange={(value) => setForm((p) => ({ ...p, enabled: value }))}
            />
            <span className="text-sm text-foreground">Active</span>
          </div>
        </div>

        {/* Live preview */}
        <div className="rounded-xl border border-dashed border-border bg-muted/50 p-4 text-sm leading-relaxed">
          <span className="font-semibold text-muted-foreground">When </span>
          <span className="font-semibold text-primary">
            {form.matchType === "ANY" ? "any" : "all"}
          </span>
          <span className="text-muted-foreground"> of these match: </span>
          {previewConditions.length === 0 ? (
            <span className="italic text-muted-foreground">
              (add a condition)
            </span>
          ) : (
            previewConditions.map((c, i) => (
              <span key={i}>
                {i > 0 && (
                  <span className="text-muted-foreground">
                    {" "}
                    {form.matchType === "ANY" ? "or" : "and"}{" "}
                  </span>
                )}
                <span className="font-medium text-foreground">
                  {FIELD_LABEL[c.field]} {OP_LABEL[c.op]} “
                  {conditionValueLabel(c)}”
                </span>
              </span>
            ))
          )}
          <span className="text-muted-foreground"> → then </span>
          {previewActions.length === 0 ? (
            <span className="italic text-muted-foreground">(add an action)</span>
          ) : (
            previewActions.map((a, i) => (
              <span key={i}>
                {i > 0 && <span className="text-muted-foreground">, </span>}
                <span className="font-medium text-foreground">
                  {describeAction(a)}
                </span>
              </span>
            ))
          )}
          .
        </div>

        {/* Conditions */}
        <div>
          <div className="mb-2 flex items-center justify-between">
            <p className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
              <Filter className="h-4 w-4 text-muted-foreground" /> When a ticket
              matches
            </p>
            <select
              value={form.matchType}
              onChange={(e) =>
                setForm((p) => ({
                  ...p,
                  matchType: e.target.value as RoutingMatchType,
                }))
              }
              className={selectClass}
            >
              <option value="ALL">all conditions</option>
              <option value="ANY">any condition</option>
            </select>
          </div>
          <div className="space-y-2">
            {form.conditions.map((condition, index) => (
              <div
                key={index}
                className="flex items-center gap-2 rounded-xl border border-border bg-muted/40 p-2.5"
              >
                <select
                  value={condition.field}
                  onChange={(e) =>
                    updateCondition(index, {
                      field: e.target.value as RoutingConditionField,
                    })
                  }
                  className={selectClass}
                >
                  {FIELD_OPTIONS.map((f) => (
                    <option key={f.value} value={f.value}>
                      {f.label}
                    </option>
                  ))}
                </select>
                <select
                  value={condition.op}
                  onChange={(e) =>
                    updateCondition(index, {
                      op: e.target.value as RoutingConditionOp,
                    })
                  }
                  className={selectClass}
                >
                  {opsForField(condition.field).map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                {conditionValueControl(condition, index)}
                <button
                  type="button"
                  onClick={() =>
                    setConditions(
                      form.conditions.length > 1
                        ? form.conditions.filter((_, i) => i !== index)
                        : form.conditions,
                    )
                  }
                  disabled={form.conditions.length <= 1}
                  aria-label="Remove condition"
                  className="flex-shrink-0 rounded p-1 text-muted-foreground hover:text-red-500 disabled:opacity-30"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() =>
              setConditions([
                ...form.conditions,
                { field: "subject", op: "contains", value: "" },
              ])
            }
            className="mt-2 flex items-center gap-1 text-xs font-medium text-primary hover:text-blue-700"
          >
            <Plus className="h-3.5 w-3.5" /> Add condition
          </button>
        </div>

        {/* Actions */}
        <div>
          <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-foreground">
            <Zap className="h-4 w-4 text-muted-foreground" /> Then do this
          </p>
          <div className="space-y-2">
            {form.actions.map((action, index) => (
              <div
                key={index}
                className="flex items-center gap-2 rounded-xl border border-blue-100 bg-blue-50/60 p-2.5 dark:border-blue-500/20 dark:bg-blue-500/5"
              >
                <select
                  value={action.type}
                  onChange={(e) =>
                    updateAction(index, {
                      type: e.target.value as RoutingActionType,
                    })
                  }
                  className={selectClass}
                >
                  {actionTypeOptions.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                {actionValueControl(action, index)}
                <button
                  type="button"
                  onClick={() =>
                    setActions(
                      form.actions.length > 1
                        ? form.actions.filter((_, i) => i !== index)
                        : form.actions,
                    )
                  }
                  disabled={form.actions.length <= 1}
                  aria-label="Remove action"
                  className="flex-shrink-0 rounded p-1 text-muted-foreground hover:text-red-500 disabled:opacity-30"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() =>
              setActions([
                ...form.actions,
                { type: "set_priority", value: "SEV3" },
              ])
            }
            className="mt-2 flex items-center gap-1 text-xs font-medium text-primary hover:text-blue-700"
          >
            <Plus className="h-3.5 w-3.5" /> Add action
          </button>
          {isTeamAdmin && memberOptions.length === 0 && (
            <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">
              No team members found for assignment. Add members to your team
              first.
            </p>
          )}
        </div>
      </div>
    </Drawer>
  );
}
