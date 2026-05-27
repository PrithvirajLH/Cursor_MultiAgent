import { useEffect, useMemo, useRef, useState } from "react";
import {
  Plus,
  ShieldCheck,
  Users,
  Clock,
  CheckCircle2,
  Gauge,
  Pencil,
  Trash2,
} from "lucide-react";
import {
  createSlaPolicyConfig,
  deleteSlaPolicyConfig,
  fetchReportSlaComplianceByPriority,
  fetchReportSlaComplianceByTeam,
  fetchReportSlaCompliance,
  fetchSlaBusinessHoursSettings,
  fetchSlaPolicyConfigs,
  updateSlaBusinessHoursSettings,
  updateSlaPolicyConfig,
  type SlaBusinessDayRecord,
  type SlaBusinessHoursSettings,
  type SlaComplianceResponse,
  type SlaComplianceByPriorityResponse,
  type SlaComplianceByTeamResponse,
  type SlaPolicyConfigRecord,
  type SlaPolicyNotifyRole,
  type TeamRef,
} from "../api/client";
import { TopBar } from "../components/TopBar";
import { Drawer } from "../components/ui/Drawer";
import { StatCard } from "../components/ui/StatCard";
import { PageTabs } from "../components/ui/PageTabs";
import { EmptyState } from "../components/ui/EmptyState";
import { useHeaderContext } from "../contexts/HeaderContext";
import { useModalFocusTrap } from "../hooks/useModalFocusTrap";
import { useToast } from "../hooks/useToast";
import {
  REALTIME_ADMIN_CHANGED_EVENT,
  type RealtimeAdminChangedEventPayload,
} from "../realtime/events";
import type { Role } from "../types";

type TabKey = "policies" | "overview" | "business-hours";
type ModalSection = "targets" | "teams" | "escalation";
type PolicySource = "live";
type NotifyValue = "agent" | "lead" | "manager" | "owner";
type PriorityKey = "critical" | "high" | "medium" | "low";
type DayName =
  | "Monday"
  | "Tuesday"
  | "Wednesday"
  | "Thursday"
  | "Friday"
  | "Saturday"
  | "Sunday";

type PolicyTargets = Record<
  PriorityKey,
  { firstResponse: number; resolution: number }
>;
type BusinessHoursModel = Record<
  DayName,
  { enabled: boolean; start: string; end: string }
>;

type PolicyModel = {
  id: string;
  name: string;
  description: string;
  isDefault: boolean;
  enabled: boolean;
  appliedTeamIds: string[];
  appliedTo: string[];
  targets: PolicyTargets;
  businessHours: boolean;
  escalation: boolean;
  escalationAfter: number;
  breachNotify: NotifyValue[];
  createdAt: string;
  compliance: number;
  source: PolicySource;
};

const PRIORITIES: PriorityKey[] = ["critical", "high", "medium", "low"];
const PRIORITY_META: Record<
  PriorityKey,
  { label: string; color: string; dot: string }
> = {
  critical: {
    label: "SEV1",
    color: "bg-red-100 text-red-700",
    dot: "bg-red-500",
  },
  high: {
    label: "SEV2",
    color: "bg-orange-100 text-orange-700",
    dot: "bg-orange-500",
  },
  medium: {
    label: "SEV3",
    color: "bg-yellow-100 text-yellow-700",
    dot: "bg-yellow-500",
  },
  low: { label: "SEV4", color: "bg-blue-100 text-blue-700", dot: "bg-blue-500" },
};

const API_TO_UI_PRIORITY: Record<string, PriorityKey> = {
  SEV1: "critical",
  SEV2: "high",
  SEV3: "medium",
  SEV4: "low",
};

const UI_TO_API_PRIORITY: Record<PriorityKey, string> = {
  critical: "SEV1",
  high: "SEV2",
  medium: "SEV3",
  low: "SEV4",
};

const NOTIFY_OPTIONS: { value: NotifyValue; label: string }[] = [
  { value: "agent", label: "Assigned Agent" },
  { value: "lead", label: "Team Lead" },
  { value: "manager", label: "Manager" },
  { value: "owner", label: "Platform Owner" },
];

const DEFAULT_TARGETS: PolicyTargets = {
  critical: { firstResponse: 1, resolution: 4 },
  high: { firstResponse: 4, resolution: 24 },
  medium: { firstResponse: 8, resolution: 72 },
  low: { firstResponse: 24, resolution: 168 },
};

const DAY_ORDER: DayName[] = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

const DEFAULT_BUSINESS_HOURS: BusinessHoursModel = {
  Monday: { enabled: true, start: "09:00", end: "18:00" },
  Tuesday: { enabled: true, start: "09:00", end: "18:00" },
  Wednesday: { enabled: true, start: "09:00", end: "18:00" },
  Thursday: { enabled: true, start: "09:00", end: "18:00" },
  Friday: { enabled: true, start: "09:00", end: "17:00" },
  Saturday: { enabled: false, start: "10:00", end: "14:00" },
  Sunday: { enabled: false, start: "10:00", end: "14:00" },
};

const API_TO_NOTIFY: Record<SlaPolicyNotifyRole, NotifyValue> = {
  AGENT: "agent",
  LEAD: "lead",
  MANAGER: "manager",
  OWNER: "owner",
};

const NOTIFY_TO_API: Record<NotifyValue, SlaPolicyNotifyRole> = {
  agent: "AGENT",
  lead: "LEAD",
  manager: "MANAGER",
  owner: "OWNER",
};

function ymd(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function fmtHours(hours: number): string {
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  if (hours === 1) return "1h";
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  const remainder = hours % 24;
  return remainder === 0 ? `${days}d` : `${days}d ${remainder}h`;
}

function complianceColor(value: number): string {
  if (value >= 95) return "text-green-600";
  if (value >= 85) return "text-yellow-600";
  return "text-red-600";
}

function complianceBg(value: number): string {
  if (value >= 95) return "bg-green-500";
  if (value >= 85) return "bg-yellow-500";
  return "bg-red-500";
}

function cloneTargets(targets: PolicyTargets): PolicyTargets {
  return PRIORITIES.reduce((acc, key) => {
    acc[key] = {
      firstResponse: targets[key].firstResponse,
      resolution: targets[key].resolution,
    };
    return acc;
  }, {} as PolicyTargets);
}

function createEmptyPolicy(): PolicyModel {
  return {
    id: "",
    name: "",
    description: "",
    isDefault: false,
    enabled: true,
    appliedTeamIds: [],
    appliedTo: [],
    targets: cloneTargets(DEFAULT_TARGETS),
    businessHours: true,
    escalation: true,
    escalationAfter: 80,
    breachNotify: ["agent", "lead"],
    createdAt: "Now",
    compliance: 0,
    source: "live",
  };
}

function targetsFromApi(
  targets: Array<{
    priority: string;
    firstResponseHours: number;
    resolutionHours: number;
  }>,
): PolicyTargets {
  const next = cloneTargets(DEFAULT_TARGETS);
  targets.forEach((target) => {
    const key = API_TO_UI_PRIORITY[target.priority];
    if (!key) return;
    next[key] = {
      firstResponse: Number(target.firstResponseHours) || 0,
      resolution: Number(target.resolutionHours) || 0,
    };
  });
  return next;
}

function toApiPolicies(
  targets: PolicyTargets,
): Array<{
  priority: string;
  firstResponseHours: number;
  resolutionHours: number;
}> {
  return PRIORITIES.map((priority) => ({
    priority: UI_TO_API_PRIORITY[priority],
    firstResponseHours: Number(targets[priority].firstResponse),
    resolutionHours: Number(targets[priority].resolution),
  }));
}

function businessHoursFromApi(
  schedule: SlaBusinessHoursSettings["schedule"],
): BusinessHoursModel {
  const next: BusinessHoursModel = { ...DEFAULT_BUSINESS_HOURS };
  schedule.forEach((item) => {
    if (!(item.day in next)) return;
    next[item.day] = {
      enabled: Boolean(item.enabled),
      start: item.start,
      end: item.end,
    };
  });
  return next;
}

function businessHoursToApi(hours: BusinessHoursModel): SlaBusinessDayRecord[] {
  return DAY_ORDER.map((day) => ({
    day,
    enabled: Boolean(hours[day]?.enabled),
    start: hours[day]?.start ?? DEFAULT_BUSINESS_HOURS[day].start,
    end: hours[day]?.end ?? DEFAULT_BUSINESS_HOURS[day].end,
  }));
}

function policyFromRecord(
  record: SlaPolicyConfigRecord,
  compliance: number,
): PolicyModel {
  return {
    id: record.id,
    name: record.name,
    description: record.description ?? "",
    isDefault: record.isDefault,
    enabled: record.enabled,
    appliedTeamIds: record.appliedTeamIds,
    appliedTo: record.appliedTeams.map((team) => team.name),
    targets: targetsFromApi(record.targets),
    businessHours: record.businessHoursOnly,
    escalation: record.escalationEnabled,
    escalationAfter: record.escalationAfterPercent,
    breachNotify: (record.breachNotifyRoles ?? [])
      .map((role) => API_TO_NOTIFY[role])
      .filter((value): value is NotifyValue => Boolean(value)),
    createdAt: record.createdAt,
    compliance,
    source: "live",
  };
}

function ToggleSwitch({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="relative inline-flex h-6 w-11 items-center">
      <input
        type="checkbox"
        className="peer sr-only"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span
        className={`absolute inset-0 rounded-full bg-muted transition-colors peer-checked:bg-primary ${
          disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"
        }`}
      />
      <span
        className={`absolute left-[3px] h-[18px] w-[18px] rounded-full bg-card transition-transform peer-checked:translate-x-5 ${
          disabled ? "cursor-not-allowed" : "cursor-pointer"
        }`}
      />
    </label>
  );
}

function DeleteModal({
  policy,
  onConfirm,
  onCancel,
}: {
  policy: PolicyModel;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useModalFocusTrap({ open: true, containerRef: dialogRef, onClose: onCancel });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Delete SLA policy"
        tabIndex={-1}
        className="w-full max-w-md rounded-lg bg-card p-6 shadow-xl"
      >
        <div className="mb-4 flex items-center space-x-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-100">
            <svg
              className="h-5 w-5 text-red-600"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01M10.293 4.293a1 1 0 011.414 0L21 13.586V19a2 2 0 01-2 2H5a2 2 0 01-2-2v-5.414l9.293-9.293z"
              />
            </svg>
          </div>
          <div>
            <h3 className="text-base font-semibold text-foreground">
              Delete SLA Policy
            </h3>
            <p className="text-sm text-muted-foreground">
              This action cannot be undone.
            </p>
          </div>
        </div>
        <p className="mb-6 text-sm text-foreground">
          Are you sure you want to delete <strong>{policy.name}</strong>?
        </p>
        <div className="flex justify-end space-x-3">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
          >
            Delete Policy
          </button>
        </div>
      </div>
    </div>
  );
}

function PolicyModal({
  policy,
  teams,
  canEdit,
  canSetDefault,
  onSave,
  onClose,
}: {
  policy: PolicyModel | null;
  teams: TeamRef[];
  canEdit: boolean;
  canSetDefault: boolean;
  onSave: (next: PolicyModel) => Promise<void> | void;
  onClose: () => void;
}) {
  const isNew = !policy?.id;
  const [activeSection, setActiveSection] = useState<ModalSection>("targets");
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [form, setForm] = useState<PolicyModel>(() => {
    const base = policy ? { ...policy } : createEmptyPolicy();
    return {
      ...base,
      appliedTeamIds: [...base.appliedTeamIds],
      appliedTo: [...base.appliedTo],
      breachNotify: [...base.breachNotify],
      targets: cloneTargets(base.targets),
    };
  });
  const dialogRef = useRef<HTMLDivElement>(null);
  const teamScopeLocked = !canSetDefault;

  useModalFocusTrap({
    open: true,
    containerRef: dialogRef,
    onClose,
  });

  useEffect(() => {
    if (!teamScopeLocked || teams.length === 0) return;
    const scopedTeam = teams[0];
    setForm((prev) => ({
      ...prev,
      appliedTeamIds: [scopedTeam.id],
      appliedTo: [scopedTeam.name],
    }));
  }, [teamScopeLocked, teams]);

  const sections: Array<{ id: ModalSection; label: string }> = [
    { id: "targets", label: "SLA Targets" },
    { id: "teams", label: "Teams & Scope" },
    { id: "escalation", label: "Escalation" },
  ];

  function updateTarget(
    priority: PriorityKey,
    field: "firstResponse" | "resolution",
    value: string,
  ) {
    const numeric = Number(value) || 0;
    setForm((prev) => ({
      ...prev,
      targets: {
        ...prev.targets,
        [priority]: {
          ...prev.targets[priority],
          [field]: numeric,
        },
      },
    }));
  }

  function toggleTeam(teamId: string, teamName: string) {
    setForm((prev) => {
      if (teamScopeLocked) {
        return {
          ...prev,
          appliedTeamIds: [teamId],
          appliedTo: [teamName],
        };
      }
      const hasTeam = prev.appliedTeamIds.includes(teamId);
      const nextTeamIds = hasTeam
        ? prev.appliedTeamIds.filter((item) => item !== teamId)
        : [...prev.appliedTeamIds, teamId];
      const nextNames = hasTeam
        ? prev.appliedTo.filter((item) => item !== teamName)
        : [...prev.appliedTo, teamName];
      return {
        ...prev,
        appliedTeamIds: nextTeamIds,
        appliedTo: nextNames,
      };
    });
  }

  function toggleNotify(value: NotifyValue) {
    setForm((prev) => ({
      ...prev,
      breachNotify: prev.breachNotify.includes(value)
        ? prev.breachNotify.filter((item) => item !== value)
        : [...prev.breachNotify, value],
    }));
  }

  function validate(): boolean {
    const nextErrors: Record<string, string> = {};
    if (!form.name.trim()) {
      nextErrors.name = "Policy name is required";
    }
    PRIORITIES.forEach((priority) => {
      if (form.targets[priority].firstResponse <= 0) {
        nextErrors[`${priority}_fr`] = "Must be > 0";
      }
      if (
        form.targets[priority].resolution <=
        form.targets[priority].firstResponse
      ) {
        nextErrors[`${priority}_res`] = "Must be > first response";
      }
    });
    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  }

  async function handleSubmit() {
    if (!validate() || !canEdit) return;
    setSaving(true);
    try {
      await onSave(form);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={isNew ? "Create SLA policy" : "Edit SLA policy"}
        tabIndex={-1}
        className="flex max-h-[calc(92vh/var(--ui-zoom))] w-full max-w-2xl flex-col rounded-lg bg-card shadow-xl"
      >
        <div className="sticky top-0 flex items-center justify-between rounded-t-lg border-b border-border bg-card px-6 py-4">
          <div>
            <h2 className="text-base font-semibold text-foreground">
              {isNew ? "Create SLA Policy" : "Edit SLA Policy"}
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {isNew
                ? "Configure response and resolution targets"
                : `Editing "${form.name || "Untitled policy"}"`}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-muted-foreground"
          >
            <svg
              className="h-5 w-5"
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

        <div className="flex-1 space-y-6 overflow-y-auto p-6">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2 sm:col-span-1">
              <label className="mb-1 block text-sm font-medium text-foreground">
                Policy Name *
              </label>
              <input
                value={form.name}
                disabled={!canEdit}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, name: event.target.value }))
                }
                placeholder="e.g. Enterprise SLA"
                className={`w-full rounded-lg border px-3 py-2 text-sm focus:border-transparent focus:ring-2 focus:ring-ring ${
                  errors.name ? "border-red-400" : "border-border"
                } ${!canEdit ? "cursor-not-allowed bg-accent" : ""}`}
              />
              {errors.name && (
                <p className="mt-1 text-xs text-red-500">{errors.name}</p>
              )}
            </div>
            <div className="col-span-2 sm:col-span-1">
              <label className="mb-1 block text-sm font-medium text-foreground">
                Description
              </label>
              <input
                value={form.description}
                disabled={!canEdit}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    description: event.target.value,
                  }))
                }
                placeholder="Brief description..."
                className={`w-full rounded-lg border border-border px-3 py-2 text-sm focus:border-transparent focus:ring-2 focus:ring-ring ${
                  !canEdit ? "cursor-not-allowed bg-accent" : ""
                }`}
              />
            </div>
          </div>

          <div className="border-b border-border">
            <div className="flex space-x-6">
              {sections.map((section) => (
                <button
                  key={section.id}
                  type="button"
                  onClick={() => setActiveSection(section.id)}
                  className={`pb-3 text-sm font-medium ${
                    activeSection === section.id
                      ? "border-b-2 border-blue-600 text-primary"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {section.label}
                </button>
              ))}
            </div>
          </div>

          {activeSection === "targets" && (
            <div>
              <div className="mb-3 flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  Set first response and resolution time targets per priority
                  level.
                </p>
                <div className="flex items-center space-x-2">
                  <ToggleSwitch
                    checked={form.businessHours}
                    disabled={!canEdit}
                    onChange={(next) =>
                      setForm((prev) => ({ ...prev, businessHours: next }))
                    }
                  />
                  <span className="text-sm text-foreground">
                    Business hours only
                  </span>
                </div>
              </div>
              <div className="overflow-hidden rounded-xl border border-border bg-muted">
                <table className="w-full text-sm">
                  <thead className="border-b border-border bg-accent">
                    <tr>
                      <th className="w-28 px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Priority
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        First Response (hours)
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Resolution (hours)
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {PRIORITIES.map((priority) => (
                      <tr key={priority} className="bg-card">
                        <td className="px-4 py-3">
                          <span
                            className={`rounded-lg px-2 py-1 text-xs font-medium ${PRIORITY_META[priority].color}`}
                          >
                            {PRIORITY_META[priority].label}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center space-x-2">
                            <input
                              type="number"
                              min={0.5}
                              step={0.5}
                              disabled={!canEdit}
                              value={form.targets[priority].firstResponse}
                              onChange={(event) =>
                                updateTarget(
                                  priority,
                                  "firstResponse",
                                  event.target.value,
                                )
                              }
                              className={`w-24 rounded-lg border px-2 py-1.5 text-sm focus:border-transparent focus:ring-2 focus:ring-ring ${
                                errors[`${priority}_fr`]
                                  ? "border-red-400"
                                  : "border-border"
                              } ${!canEdit ? "cursor-not-allowed bg-accent" : ""}`}
                            />
                            <span className="text-xs text-muted-foreground">
                              = {fmtHours(form.targets[priority].firstResponse)}
                            </span>
                          </div>
                          {errors[`${priority}_fr`] && (
                            <p className="mt-1 text-xs text-red-500">
                              {errors[`${priority}_fr`]}
                            </p>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center space-x-2">
                            <input
                              type="number"
                              min={1}
                              step={1}
                              disabled={!canEdit}
                              value={form.targets[priority].resolution}
                              onChange={(event) =>
                                updateTarget(
                                  priority,
                                  "resolution",
                                  event.target.value,
                                )
                              }
                              className={`w-24 rounded-lg border px-2 py-1.5 text-sm focus:border-transparent focus:ring-2 focus:ring-ring ${
                                errors[`${priority}_res`]
                                  ? "border-red-400"
                                  : "border-border"
                              } ${!canEdit ? "cursor-not-allowed bg-accent" : ""}`}
                            />
                            <span className="text-xs text-muted-foreground">
                              = {fmtHours(form.targets[priority].resolution)}
                            </span>
                          </div>
                          {errors[`${priority}_res`] && (
                            <p className="mt-1 text-xs text-red-500">
                              {errors[`${priority}_res`]}
                            </p>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {form.businessHours && (
                <p className="mt-2 flex items-center space-x-1 text-xs text-muted-foreground">
                  <svg
                    className="h-3.5 w-3.5 text-blue-500"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                  <span>
                    Times are counted within configured business hours from the
                    Business Hours tab.
                  </span>
                </p>
              )}
            </div>
          )}

          {activeSection === "teams" && (
            <div className="space-y-5">
              <div>
                <p className="mb-2 text-sm font-medium text-foreground">
                  Apply to Teams
                </p>
                <p className="mb-3 text-xs text-muted-foreground">
                  Select which teams this SLA policy governs. A team can only
                  have one active policy.
                </p>
                {teamScopeLocked && (
                  <p className="mb-3 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-700">
                    Your role is scoped to one team. Team assignment is locked
                    to your primary team.
                  </p>
                )}
                <div
                  className={`grid gap-3 ${teamScopeLocked ? "grid-cols-1" : "grid-cols-2"}`}
                >
                  {teams.map((team) => (
                    <label
                      key={team.id}
                      className={`flex cursor-pointer items-center space-x-3 rounded-lg border p-3 transition-all ${
                        form.appliedTeamIds.includes(team.id)
                          ? "border-primary bg-blue-50"
                          : "border-border bg-card hover:border-border"
                      } ${!canEdit || teamScopeLocked ? "cursor-not-allowed opacity-60" : ""}`}
                    >
                      <input
                        type="checkbox"
                        disabled={!canEdit || teamScopeLocked}
                        checked={form.appliedTeamIds.includes(team.id)}
                        onChange={() => toggleTeam(team.id, team.name)}
                        className="h-4 w-4 rounded text-primary"
                      />
                      <span className="text-sm font-medium text-foreground">
                        {team.name}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
              <div className="flex items-center justify-between rounded-xl border border-border bg-muted p-4">
                <div>
                  <p className="text-sm font-medium text-foreground">
                    Set as Default Policy
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Applied to teams with no explicit policy assigned.
                  </p>
                </div>
                <ToggleSwitch
                  checked={form.isDefault}
                  disabled={!canSetDefault}
                  onChange={(next) =>
                    setForm((prev) => ({ ...prev, isDefault: next }))
                  }
                />
              </div>
              <div className="flex items-center justify-between rounded-xl border border-border bg-muted p-4">
                <div>
                  <p className="text-sm font-medium text-foreground">
                    Policy Status
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Disabled policies are not enforced on any tickets.
                  </p>
                </div>
                <div className="flex items-center space-x-2">
                  <span
                    className={`text-sm font-medium ${form.enabled ? "text-green-600" : "text-muted-foreground"}`}
                  >
                    {form.enabled ? "Enabled" : "Disabled"}
                  </span>
                  <ToggleSwitch
                    checked={form.enabled}
                    disabled={!canEdit}
                    onChange={(next) =>
                      setForm((prev) => ({ ...prev, enabled: next }))
                    }
                  />
                </div>
              </div>
            </div>
          )}

          {activeSection === "escalation" && (
            <div className="space-y-5">
              <div className="flex items-center justify-between rounded-xl border border-border bg-muted p-4">
                <div>
                  <p className="text-sm font-medium text-foreground">
                    Enable Escalation
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Automatically escalate tickets approaching SLA breach.
                  </p>
                </div>
                <ToggleSwitch
                  checked={form.escalation}
                  disabled={!canEdit}
                  onChange={(next) =>
                    setForm((prev) => ({ ...prev, escalation: next }))
                  }
                />
              </div>

              {form.escalation && (
                <div className="rounded-xl border border-border bg-card p-4">
                  <label className="mb-1 block text-sm font-medium text-foreground">
                    Escalate when SLA is{" "}
                    <strong>{form.escalationAfter}%</strong> elapsed
                  </label>
                  <div className="mt-2 flex items-center space-x-4">
                    <input
                      type="range"
                      min={50}
                      max={95}
                      step={5}
                      disabled={!canEdit}
                      value={form.escalationAfter}
                      onChange={(event) =>
                        setForm((prev) => ({
                          ...prev,
                          escalationAfter: Number(event.target.value),
                        }))
                      }
                      className={`h-2 flex-1 cursor-pointer appearance-none rounded-lg bg-accent accent-blue-600 ${
                        !canEdit ? "cursor-not-allowed opacity-70" : ""
                      }`}
                    />
                    <span className="w-10 text-right text-sm font-semibold text-primary">
                      {form.escalationAfter}%
                    </span>
                  </div>
                  <div className="mt-1 flex justify-between text-xs text-muted-foreground">
                    <span>50% (early)</span>
                    <span>95% (late)</span>
                  </div>
                </div>
              )}

              <div className="rounded-xl border border-border bg-card p-4">
                <p className="mb-3 text-sm font-medium text-foreground">
                  Breach Notifications
                </p>
                <p className="mb-3 text-xs text-muted-foreground">
                  Notify these roles when an SLA is breached or at risk.
                </p>
                <div className="space-y-2">
                  {NOTIFY_OPTIONS.map((option) => (
                    <label
                      key={option.value}
                      className={`flex items-center space-x-3 ${!canEdit ? "cursor-not-allowed opacity-70" : "cursor-pointer"}`}
                    >
                      <input
                        type="checkbox"
                        disabled={!canEdit}
                        checked={form.breachNotify.includes(option.value)}
                        onChange={() => toggleNotify(option.value)}
                        className="h-4 w-4 rounded text-primary"
                      />
                      <span className="text-sm text-foreground">
                        {option.label}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="sticky bottom-0 flex items-center justify-between rounded-b-lg border-t border-border bg-muted px-6 py-4">
          <p className="text-xs text-muted-foreground">* Required fields</p>
          <div className="flex space-x-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-accent"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!canEdit || saving}
              className="flex items-center space-x-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 disabled:cursor-not-allowed disabled:bg-muted"
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
                  d="M5 13l4 4L19 7"
                />
              </svg>
              <span>
                {saving
                  ? "Saving..."
                  : isNew
                    ? "Create Policy"
                    : "Save Changes"}
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function BusinessHoursEditor({
  disabled,
  hours,
  onToggleDay,
  onUpdateTime,
}: {
  disabled: boolean;
  hours: BusinessHoursModel;
  onToggleDay: (day: DayName) => void;
  onUpdateTime: (day: DayName, key: "start" | "end", value: string) => void;
}) {
  return (
    <div className="space-y-2">
      {DAY_ORDER.map((day) => {
        const value = hours[day];
        const [startH, startM] = value.start.split(":").map(Number);
        const [endH, endM] = value.end.split(":").map(Number);
        const totalMinutes = Math.max(
          0,
          endH * 60 + endM - (startH * 60 + startM),
        );
        const duration =
          `${Math.floor(totalMinutes / 60)}h ${totalMinutes % 60 > 0 ? `${totalMinutes % 60}m` : ""}`.trim();

        return (
          <div
            key={day}
            className={`flex min-w-0 flex-wrap items-center gap-2 rounded-lg border p-3 transition-all sm:flex-nowrap sm:gap-4 ${
              value.enabled
                ? "border-border bg-card"
                : "border-border bg-muted opacity-60"
            }`}
          >
            <ToggleSwitch
              checked={value.enabled}
              disabled={disabled}
              onChange={() => onToggleDay(day)}
            />
            <span className="w-24 flex-shrink-0 text-sm font-medium text-foreground">
              {day}
            </span>
            {value.enabled ? (
              <div className="flex min-w-0 flex-wrap items-center gap-2 sm:flex-nowrap sm:gap-2">
                <input
                  type="time"
                  disabled={disabled}
                  value={value.start}
                  onChange={(event) =>
                    onUpdateTime(day, "start", event.target.value)
                  }
                  className={`min-w-0 rounded-lg border border-border px-2 py-1 text-sm focus:border-transparent focus:ring-2 focus:ring-ring ${
                    disabled ? "cursor-not-allowed bg-accent" : ""
                  }`}
                />
                <span className="text-sm text-muted-foreground">to</span>
                <input
                  type="time"
                  disabled={disabled}
                  value={value.end}
                  onChange={(event) =>
                    onUpdateTime(day, "end", event.target.value)
                  }
                  className={`min-w-0 rounded-lg border border-border px-2 py-1 text-sm focus:border-transparent focus:ring-2 focus:ring-ring ${
                    disabled ? "cursor-not-allowed bg-accent" : ""
                  }`}
                />
                <span className="text-xs text-muted-foreground">({duration})</span>
              </div>
            ) : (
              <span className="text-sm italic text-muted-foreground">Closed</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function HolidayManager({
  disabled,
  holidays,
  onAddHoliday,
  onRemoveHoliday,
}: {
  disabled: boolean;
  holidays: Array<{ name: string; date: string }>;
  onAddHoliday: (holiday: { name: string; date: string }) => void;
  onRemoveHoliday: (holiday: { name: string; date: string }) => void;
}) {
  const [newName, setNewName] = useState("");
  const [newDate, setNewDate] = useState("");

  function addHoliday() {
    if (!newName.trim() || !newDate || disabled) return;
    onAddHoliday({ name: newName.trim(), date: newDate });
    setNewName("");
    setNewDate("");
  }

  function removeHoliday(holiday: { name: string; date: string }) {
    if (disabled) return;
    onRemoveHoliday(holiday);
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        On holidays, SLA timers are paused (treated as non-business time).
      </p>
      <div className="space-y-2">
        {holidays.map((holiday) => (
          <div
            key={`${holiday.date}-${holiday.name}`}
            className="flex items-center justify-between rounded-lg bg-muted px-3 py-2 transition hover:bg-accent"
          >
            <div className="flex items-center space-x-3">
              <span className="text-lg">H</span>
              <div>
                <p className="text-sm font-medium text-foreground">
                  {holiday.name}
                </p>
                <p className="text-xs text-muted-foreground">
                  {new Date(`${holiday.date}T00:00:00`).toLocaleDateString(
                    "en-US",
                    {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    },
                  )}
                </p>
              </div>
            </div>
            <button
              type="button"
              disabled={disabled}
              onClick={() => removeHoliday(holiday)}
              className="rounded p-1 text-muted-foreground hover:text-red-500 disabled:cursor-not-allowed disabled:opacity-40"
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
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-2 border-t border-border pt-2">
        <input
          value={newName}
          disabled={disabled}
          onChange={(event) => setNewName(event.target.value)}
          placeholder="Holiday name"
          className={`min-w-0 flex-1 rounded-lg border border-border px-3 py-1.5 text-sm focus:border-transparent focus:ring-2 focus:ring-ring ${
            disabled ? "cursor-not-allowed bg-accent" : ""
          }`}
        />
        <input
          type="date"
          value={newDate}
          disabled={disabled}
          onChange={(event) => setNewDate(event.target.value)}
          className={`min-w-0 rounded-lg border border-border px-3 py-1.5 text-sm focus:border-transparent focus:ring-2 focus:ring-ring ${
            disabled ? "cursor-not-allowed bg-accent" : ""
          }`}
        />
        <button
          type="button"
          disabled={disabled || !newName.trim() || !newDate}
          onClick={addHoliday}
          className="flex-shrink-0 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary/90 disabled:cursor-not-allowed disabled:bg-muted"
        >
          Add
        </button>
      </div>
    </div>
  );
}

export function SlaSettingsPage({
  teamsList,
  role,
}: {
  teamsList: TeamRef[];
  role: Role;
}) {
  const headerCtx = useHeaderContext();
  const toast = useToast();
  const canEdit = role === "TEAM_ADMIN" || role === "OWNER";
  const isReadOnly = role === "LEAD";

  const [activeTab, setActiveTab] = useState<TabKey>("policies");
  const [searchQuery, setSearchQuery] = useState("");
  const [livePolicies, setLivePolicies] = useState<PolicyModel[]>([]);
  const [selectedPolicyId, setSelectedPolicyId] = useState<string | null>(null);
  const [loadingLive, setLoadingLive] = useState(false);
  const [liveError, setLiveError] = useState<string | null>(null);

  const [overviewData, setOverviewData] = useState<
    SlaComplianceResponse["data"] | null
  >(null);
  const [priorityOverviewData, setPriorityOverviewData] = useState<
    SlaComplianceByPriorityResponse["data"]
  >([]);
  const [teamOverviewData, setTeamOverviewData] = useState<
    SlaComplianceByTeamResponse["data"]
  >([]);
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [overviewError, setOverviewError] = useState<string | null>(null);

  const [businessTimezone, setBusinessTimezone] = useState("UTC");
  const [businessHours, setBusinessHours] = useState<BusinessHoursModel>(
    DEFAULT_BUSINESS_HOURS,
  );
  const [holidays, setHolidays] = useState<
    Array<{ name: string; date: string }>
  >([]);
  const [businessLoading, setBusinessLoading] = useState(false);
  const [businessSaving, setBusinessSaving] = useState(false);
  const [businessError, setBusinessError] = useState<string | null>(null);

  const [showEditor, setShowEditor] = useState(false);
  const [editingPolicy, setEditingPolicy] = useState<PolicyModel | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PolicyModel | null>(null);

  const today = useMemo(() => new Date(), []);
  const fromDate = useMemo(() => {
    const next = new Date(today);
    next.setDate(next.getDate() - 30);
    return next;
  }, [today]);

  useEffect(() => {
    void loadLivePolicies();
    void loadOverview();
    void loadBusinessSettings();
  }, [teamsList]);

  useEffect(() => {
    const handleAdminChanged = (event: Event) => {
      const payload = (event as CustomEvent<RealtimeAdminChangedEventPayload>)
        .detail;
      const scope = payload?.scope;
      if (scope !== "sla_policy" && scope !== "sla_business_hours") {
        return;
      }
      void loadLivePolicies();
      void loadOverview();
      void loadBusinessSettings();
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
  }, [teamsList, fromDate, today]);

  const policies = useMemo(() => livePolicies, [livePolicies]);

  const filteredPolicies = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return policies;
    return policies.filter((policy) => {
      return (
        policy.name.toLowerCase().includes(q) ||
        policy.description.toLowerCase().includes(q)
      );
    });
  }, [policies, searchQuery]);

  useEffect(() => {
    // Drop the selection only if the policy it points at no longer exists
    // (e.g. deleted). The drawer opens on explicit click, never auto-opens.
    if (
      selectedPolicyId &&
      !policies.some((policy) => policy.id === selectedPolicyId)
    ) {
      setSelectedPolicyId(null);
    }
  }, [policies, selectedPolicyId]);

  const selectedPolicy = useMemo(
    () => policies.find((policy) => policy.id === selectedPolicyId) ?? null,
    [policies, selectedPolicyId],
  );

  const overallCompliance = useMemo(() => {
    if (overviewData?.total && overviewData.total > 0) {
      return Math.round((overviewData.met / overviewData.total) * 100);
    }
    const enabled = policies.filter(
      (policy) => policy.enabled && policy.compliance > 0,
    );
    if (enabled.length === 0) return 0;
    const total = enabled.reduce((sum, policy) => sum + policy.compliance, 0);
    return Math.round(total / enabled.length);
  }, [overviewData, policies]);

  const coveredTeams = useMemo(() => {
    const all = new Set<string>();
    policies.forEach((policy) => {
      policy.appliedTo.forEach((team) => all.add(team));
    });
    return all.size;
  }, [policies]);

  const teamAssignment = useMemo(() => {
    const defaultPolicy =
      policies.find((policy) => policy.isDefault && policy.enabled) ?? null;
    return teamsList.map((team) => {
      const assigned = policies.find(
        (policy) => policy.enabled && policy.appliedTeamIds.includes(team.id),
      );
      return { team, policy: assigned ?? defaultPolicy };
    });
  }, [policies, teamsList]);

  const policyEditorTeams = useMemo(() => {
    if (role === "OWNER") return teamsList;
    const preferredTeamId =
      editingPolicy?.appliedTeamIds[0] ?? teamsList[0]?.id;
    if (!preferredTeamId) return [];
    const scopedTeam = teamsList.find((team) => team.id === preferredTeamId);
    return scopedTeam ? [scopedTeam] : [];
  }, [editingPolicy, role, teamsList]);

  async function loadLivePolicies() {
    setLoadingLive(true);
    setLiveError(null);
    try {
      const response = await fetchSlaPolicyConfigs();
      const records = response.data ?? [];
      const teamIds = [
        ...new Set(records.flatMap((record) => record.appliedTeamIds)),
      ];
      const from = ymd(fromDate);
      const to = ymd(today);

      const complianceEntries = await Promise.all(
        teamIds.map(async (teamId) => {
          try {
            const res = await fetchReportSlaCompliance({ teamId, from, to });
            return [
              teamId,
              { met: res.data.met, total: res.data.total },
            ] as const;
          } catch {
            return [teamId, { met: 0, total: 0 }] as const;
          }
        }),
      );
      const teamCompliance = new Map(complianceEntries);

      const loaded = records.map((record) => {
        const totals = record.appliedTeamIds.reduce(
          (acc, teamId) => {
            const team = teamCompliance.get(teamId);
            if (!team) return acc;
            return {
              met: acc.met + team.met,
              total: acc.total + team.total,
            };
          },
          { met: 0, total: 0 },
        );
        const compliance =
          totals.total > 0 ? Math.round((totals.met / totals.total) * 100) : 0;
        return policyFromRecord(record, compliance);
      });

      setLivePolicies(loaded);
    } catch {
      setLivePolicies([]);
      setLiveError("Unable to load SLA policies from backend.");
    } finally {
      setLoadingLive(false);
    }
  }

  async function loadOverview() {
    setOverviewLoading(true);
    setOverviewError(null);
    try {
      const [response, priorityResponse, teamResponse] = await Promise.all([
        fetchReportSlaCompliance({
          from: ymd(fromDate),
          to: ymd(today),
        }),
        fetchReportSlaComplianceByPriority({
          from: ymd(fromDate),
          to: ymd(today),
        }),
        fetchReportSlaComplianceByTeam({
          from: ymd(fromDate),
          to: ymd(today),
        }),
      ]);
      setOverviewData(response.data);
      setPriorityOverviewData(priorityResponse.data);
      setTeamOverviewData(teamResponse.data);
    } catch {
      setOverviewData(null);
      setPriorityOverviewData([]);
      setTeamOverviewData([]);
      setOverviewError("Unable to load SLA compliance overview from backend.");
    } finally {
      setOverviewLoading(false);
    }
  }

  async function loadBusinessSettings() {
    setBusinessLoading(true);
    setBusinessError(null);
    try {
      const response = await fetchSlaBusinessHoursSettings();
      setBusinessTimezone(response.data.timezone);
      setBusinessHours(businessHoursFromApi(response.data.schedule));
      setHolidays(response.data.holidays);
    } catch {
      setBusinessError("Unable to load business hours settings from backend.");
    } finally {
      setBusinessLoading(false);
    }
  }

  function handleCreate() {
    if (!canEdit) return;
    const next = createEmptyPolicy();
    if (role !== "OWNER" && teamsList.length > 0) {
      next.appliedTeamIds = [teamsList[0].id];
      next.appliedTo = [teamsList[0].name];
    }
    setEditingPolicy(next);
    setShowEditor(true);
  }

  function handleEdit(policy: PolicyModel) {
    if (!canEdit) return;
    setEditingPolicy(policy);
    setShowEditor(true);
  }

  async function handleSave(next: PolicyModel) {
    if (!canEdit) return;
    const scopedTeamId =
      role === "OWNER"
        ? null
        : (next.appliedTeamIds[0] ??
          policyEditorTeams[0]?.id ??
          teamsList[0]?.id ??
          null);
    if (role !== "OWNER" && !scopedTeamId) {
      toast.error("Unable to determine scoped team for this policy.");
      return;
    }

    try {
      const breachNotifyRoles = next.breachNotify.length
        ? next.breachNotify.map((value) => NOTIFY_TO_API[value])
        : [NOTIFY_TO_API.agent];
      const payload = {
        name: next.name.trim(),
        description: next.description.trim() || undefined,
        isDefault: role === "OWNER" ? next.isDefault : false,
        enabled: next.enabled,
        businessHoursOnly: next.businessHours,
        escalationEnabled: next.escalation,
        escalationAfterPercent: next.escalationAfter,
        breachNotifyRoles,
        appliedTeamIds:
          role === "OWNER" ? next.appliedTeamIds : [scopedTeamId as string],
        targets: toApiPolicies(next.targets),
      };
      if (next.id) {
        await updateSlaPolicyConfig(next.id, payload);
      } else {
        await createSlaPolicyConfig(payload);
      }
      await loadLivePolicies();
      toast.success("SLA policy saved.");
    } catch {
      toast.error("Unable to save SLA policy.");
      throw new Error("save_failed");
    }
    setShowEditor(false);
    setEditingPolicy(null);
  }

  function handleDelete(policy: PolicyModel) {
    if (!canEdit) return;
    setDeleteTarget(policy);
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    try {
      await deleteSlaPolicyConfig(deleteTarget.id);
      await loadLivePolicies();
      if (selectedPolicyId === deleteTarget.id) {
        setSelectedPolicyId(null);
      }
      toast.success(`"${deleteTarget.name}" deleted.`);
    } catch {
      toast.error("Unable to delete SLA policy.");
    }
    setDeleteTarget(null);
  }

  async function handleSaveBusinessHours() {
    if (!canEdit) return;
    setBusinessSaving(true);
    setBusinessError(null);
    try {
      const response = await updateSlaBusinessHoursSettings({
        timezone: businessTimezone,
        schedule: businessHoursToApi(businessHours),
        holidays,
      });
      setBusinessTimezone(response.data.timezone);
      setBusinessHours(businessHoursFromApi(response.data.schedule));
      setHolidays(response.data.holidays);
      toast.success("Business hours settings saved.");
    } catch {
      setBusinessError("Unable to save business hours settings.");
      toast.error("Unable to save business hours settings.");
    } finally {
      setBusinessSaving(false);
    }
  }

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
                  <div className="flex flex-wrap items-center gap-3">
                    <h1 className="text-xl font-semibold text-foreground">
                      SLA Settings
                    </h1>
                    {isReadOnly && (
                      <span className="rounded-lg bg-yellow-100 px-2 py-1 text-xs font-medium text-yellow-700">
                        Lead read-only
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    Manage response and resolution targets across all teams.
                  </p>
                </div>
              }
            />
          ) : (
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="text-xl font-semibold text-foreground">
                  SLA Settings
                </h1>
                {isReadOnly && (
                  <span className="rounded-lg bg-yellow-100 px-2 py-1 text-xs font-medium text-yellow-700">
                    Lead read-only
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-sm text-muted-foreground">
                Manage response and resolution targets across all teams.
              </p>
            </div>
          )}
        </div>

        <div className="border-t border-border bg-card">
          <div className="mx-auto max-w-none px-6 py-4">
            <div className="flex items-center justify-between">
              <PageTabs<TabKey>
                tabs={[
                  { id: "policies", label: "Policies", icon: ShieldCheck },
                  { id: "overview", label: "Coverage", icon: Users },
                  { id: "business-hours", label: "Business Hours", icon: Clock },
                ]}
                active={activeTab}
                onChange={setActiveTab}
              />
              {canEdit && (
                <button
                  type="button"
                  onClick={handleCreate}
                  className="flex items-center space-x-2 rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-foreground hover:bg-muted"
                >
                  <Plus className="h-4 w-4" />
                  <span>New Policy</span>
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-none p-6">
        {liveError && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {liveError}
          </div>
        )}

        {activeTab === "policies" && (
          <div>
            <div className="mb-5 rounded-xl border border-border bg-card p-4">
              <div className="flex items-start gap-3">
                <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-blue-50 text-primary dark:bg-blue-500/10">
                  <ShieldCheck className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <h2 className="text-sm font-semibold text-foreground">
                    Service-level agreements
                  </h2>
                  <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                    A policy defines the response and resolution time targets a
                    team commits to per priority. Select a policy to view or edit
                    its targets, business hours and escalation — or open{" "}
                    <span className="font-medium text-foreground">Coverage</span>{" "}
                    to see which teams each policy applies to.
                  </p>
                </div>
              </div>
            </div>

            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-foreground">
                All Policies{" "}
                <span className="ml-1 font-normal text-muted-foreground">
                  ({filteredPolicies.length})
                </span>
              </h3>
              <div className="relative">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Search policies..."
                  className="w-56 rounded-lg border border-border bg-card text-foreground py-1.5 pl-9 pr-3 text-sm placeholder:text-muted-foreground focus:border-transparent focus:ring-2 focus:ring-ring"
                />
                <svg
                  className="absolute left-3 top-2 h-4 w-4 text-muted-foreground"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                  />
                </svg>
              </div>
            </div>

            <div className="space-y-3">
                {loadingLive && (
                  <div className="space-y-3">
                    {Array.from({ length: 3 }).map((_, i) => (
                      <div
                        key={`policy-skel-${i}`}
                        className="rounded-xl border border-border bg-card p-5"
                      >
                        <div className="flex items-center justify-between">
                          <div className="space-y-2">
                            <div className="h-5 w-40 skeleton-shimmer rounded" />
                            <div className="h-3.5 w-56 skeleton-shimmer rounded" />
                          </div>
                          <div className="h-8 w-20 skeleton-shimmer rounded-lg" />
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {!loadingLive && filteredPolicies.length === 0 && (
                  <EmptyState
                    icon={<ShieldCheck className="h-6 w-6" />}
                    title={
                      searchQuery ? "No matching policies" : "No SLA policies yet"
                    }
                    description={
                      searchQuery
                        ? "Try a different search term."
                        : "Create your first policy to start tracking response and resolution targets."
                    }
                    action={
                      canEdit && !searchQuery ? (
                        <button
                          type="button"
                          onClick={handleCreate}
                          className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-white hover:bg-primary/90"
                        >
                          <Plus className="h-4 w-4" />
                          New Policy
                        </button>
                      ) : undefined
                    }
                  />
                )}

                {filteredPolicies.map((policy) => (
                  <div
                    key={policy.id}
                    onClick={() => setSelectedPolicyId(policy.id)}
                    className={`group flex cursor-pointer items-center gap-4 rounded-xl border bg-card px-4 py-3 transition-all hover:border-primary/40 hover:shadow-sm ${
                      selectedPolicyId === policy.id
                        ? "border-primary ring-1 ring-primary/30"
                        : "border-border"
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-sm font-semibold text-foreground">
                          {policy.name}
                        </span>
                        {policy.isDefault && (
                          <span className="rounded-md bg-blue-100 px-1.5 py-0.5 text-[11px] font-medium text-blue-700 dark:bg-blue-500/15 dark:text-blue-400">
                            Default
                          </span>
                        )}
                        {!policy.enabled && (
                          <span className="rounded-md bg-accent px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                            Disabled
                          </span>
                        )}
                        <span className="rounded-md bg-green-100 px-1.5 py-0.5 text-[11px] font-medium text-green-700 dark:bg-green-500/15 dark:text-green-400">
                          Live
                        </span>
                      </div>
                      {policy.description && (
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">
                          {policy.description}
                        </p>
                      )}
                      <div className="mt-1.5 flex items-center gap-3">
                        {policy.compliance > 0 && (
                          <div className="flex items-center gap-1.5">
                            <div className="h-1.5 w-16 rounded-full bg-accent">
                              <div
                                className={`h-1.5 rounded-full ${complianceBg(policy.compliance)}`}
                                style={{ width: `${policy.compliance}%` }}
                              />
                            </div>
                            <span
                              className={`text-xs font-medium ${complianceColor(policy.compliance)}`}
                            >
                              {policy.compliance}%
                            </span>
                          </div>
                        )}
                        <span className="text-xs text-muted-foreground">
                          {policy.appliedTo.length} team
                          {policy.appliedTo.length !== 1 ? "s" : ""}
                        </span>
                      </div>
                    </div>

                    <div className="hidden flex-shrink-0 items-center gap-4 border-l border-border pl-4 md:flex">
                      {PRIORITIES.map((priority) => (
                        <div key={priority} className="w-12 text-center">
                          <span
                            className={`mx-auto mb-1 block h-2 w-2 rounded-full ${PRIORITY_META[priority].dot}`}
                          />
                          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                            {PRIORITY_META[priority].label}
                          </p>
                          <p className="text-xs font-semibold text-foreground">
                            {fmtHours(policy.targets[priority].resolution)}
                          </p>
                        </div>
                      ))}
                    </div>

                    {canEdit && (
                      <div
                        className="flex flex-shrink-0 items-center gap-1"
                        onClick={(event) => event.stopPropagation()}
                      >
                        <button
                          type="button"
                          onClick={() => handleEdit(policy)}
                          aria-label="Edit policy"
                          className="rounded p-1.5 text-muted-foreground hover:bg-blue-50 hover:text-primary dark:hover:bg-blue-500/10"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          disabled={role !== "OWNER" && policy.isDefault}
                          onClick={() => handleDelete(policy)}
                          aria-label="Delete policy"
                          className="rounded p-1.5 text-muted-foreground hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-red-500/10"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>

            {selectedPolicy && (
              <Drawer
                open
                onClose={() => setSelectedPolicyId(null)}
                widthClassName="max-w-xl"
                icon={
                  <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-blue-100 dark:bg-blue-500/15">
                    <ShieldCheck className="h-4 w-4 text-primary" />
                  </div>
                }
                title={selectedPolicy.name}
                description={selectedPolicy.description}
                headerActions={
                  <>
                    <span className="rounded-lg bg-green-100 px-2 py-1 text-xs font-medium text-green-700 dark:bg-green-500/15 dark:text-green-400">
                      Live
                    </span>
                    {canEdit && (
                      <button
                        type="button"
                        onClick={() => handleEdit(selectedPolicy)}
                        className="rounded-lg border border-blue-200 px-3 py-1.5 text-xs font-medium text-primary hover:bg-blue-50 dark:border-blue-500/30 dark:hover:bg-blue-500/10"
                      >
                        Edit
                      </button>
                    )}
                  </>
                }
              >
                <div className="space-y-5">
                      {selectedPolicy.compliance > 0 && (
                        <div className="rounded-xl border border-border bg-muted p-4">
                          <div className="mb-2 flex items-center justify-between">
                            <span className="text-xs font-medium text-muted-foreground">
                              SLA Compliance (Last 30d)
                            </span>
                            <span
                              className={`text-lg font-bold ${complianceColor(selectedPolicy.compliance)}`}
                            >
                              {selectedPolicy.compliance}%
                            </span>
                          </div>
                          <div className="h-2 w-full rounded-full bg-accent">
                            <div
                              className={`h-2 rounded-full ${complianceBg(selectedPolicy.compliance)}`}
                              style={{ width: `${selectedPolicy.compliance}%` }}
                            />
                          </div>
                        </div>
                      )}

                      <div>
                        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-foreground">
                          SLA Targets
                        </p>
                        <div className="overflow-hidden rounded-xl border border-border bg-muted">
                          <table className="w-full text-sm">
                            <thead className="border-b border-border bg-accent">
                              <tr>
                                <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">
                                  Priority
                                </th>
                                <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">
                                  1st Response
                                </th>
                                <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">
                                  Resolution
                                </th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-border">
                              {PRIORITIES.map((priority) => (
                                <tr key={priority} className="bg-card">
                                  <td className="px-3 py-2">
                                    <div className="flex items-center space-x-2">
                                      <span
                                        className={`h-2 w-2 rounded-full ${PRIORITY_META[priority].dot}`}
                                      />
                                      <span className="text-xs font-medium text-foreground">
                                        {PRIORITY_META[priority].label}
                                      </span>
                                    </div>
                                  </td>
                                  <td className="px-3 py-2 text-xs font-medium text-foreground">
                                    {fmtHours(
                                      selectedPolicy.targets[priority]
                                        .firstResponse,
                                    )}
                                  </td>
                                  <td className="px-3 py-2 text-xs font-medium text-foreground">
                                    {fmtHours(
                                      selectedPolicy.targets[priority]
                                        .resolution,
                                    )}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>

                      <div>
                        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-foreground">
                          Configuration
                        </p>
                        <div className="flex flex-wrap gap-2">
                          <span
                            className={`rounded-lg px-2 py-1 text-xs font-medium ${selectedPolicy.businessHours ? "bg-indigo-500/10 text-indigo-400" : "bg-accent text-muted-foreground"}`}
                          >
                            {selectedPolicy.businessHours
                              ? "Business Hours"
                              : "24/7"}
                          </span>
                          <span
                            className={`rounded-lg px-2 py-1 text-xs font-medium ${selectedPolicy.escalation ? "bg-orange-500/10 text-orange-400" : "bg-accent text-muted-foreground"}`}
                          >
                            {selectedPolicy.escalation
                              ? `Escalate at ${selectedPolicy.escalationAfter}%`
                              : "No Escalation"}
                          </span>
                          {selectedPolicy.breachNotify.map((notify) => (
                            <span
                              key={notify}
                              className="rounded-lg bg-purple-500/10 px-2 py-1 text-xs font-medium text-purple-400"
                            >
                              {
                                NOTIFY_OPTIONS.find(
                                  (option) => option.value === notify,
                                )?.label
                              }
                            </span>
                          ))}
                        </div>
                      </div>

                      <div>
                        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-foreground">
                          Applied To
                        </p>
                        {selectedPolicy.appliedTo.length === 0 ? (
                          <p className="text-xs italic text-muted-foreground">
                            Not applied to any teams
                          </p>
                        ) : (
                          <div className="flex flex-wrap gap-1.5">
                            {selectedPolicy.appliedTo.map((team) => (
                              <span
                                key={team}
                                className="rounded-lg bg-green-100 px-2 py-1 text-xs font-medium text-green-700"
                              >
                                {team}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>

                      <p className="text-xs text-muted-foreground">
                        Created {selectedPolicy.createdAt}
                      </p>
                </div>
              </Drawer>
            )}

          </div>
        )}

        {activeTab === "overview" && (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <StatCard
                label="Total Policies"
                value={policies.length}
                icon={ShieldCheck}
                tone="blue"
              />
              <StatCard
                label="Active Policies"
                value={policies.filter((policy) => policy.enabled).length}
                icon={CheckCircle2}
                tone="green"
              />
              <StatCard
                label="Teams Covered"
                value={coveredTeams}
                icon={Users}
                tone="purple"
              />
              <StatCard
                label="Avg Compliance"
                value={`${overallCompliance}%`}
                icon={Gauge}
                tone={
                  overallCompliance >= 90
                    ? "green"
                    : overallCompliance >= 80
                      ? "amber"
                      : "red"
                }
              />
            </div>

            <div className="overflow-hidden rounded-xl border border-border bg-card">
              <div className="border-b border-border px-5 py-4">
                <h3 className="text-sm font-semibold text-foreground">
                  Team-Policy Assignment
                </h3>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Which SLA policy is currently active for each team.
                </p>
              </div>
              <div className="divide-y divide-border">
                {teamAssignment.map(({ team, policy }) => (
                  <div
                    key={team.id}
                    className="flex items-center justify-between px-5 py-3 hover:bg-muted"
                  >
                    <div className="flex items-center space-x-3">
                      <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent text-muted-foreground">
                        <Users className="h-4 w-4" />
                      </div>
                      <span className="text-sm font-medium text-foreground">
                        {team.name}
                      </span>
                    </div>
                    <div className="flex items-center space-x-3">
                      {policy ? (
                        <>
                          <span className="rounded-lg bg-green-100 px-2 py-1 text-xs font-medium text-green-700 dark:bg-green-500/15 dark:text-green-400">
                            {policy.name}
                          </span>
                          {policy.compliance > 0 && (
                            <span
                              className={`text-xs font-medium ${complianceColor(policy.compliance)}`}
                            >
                              {policy.compliance}% compliant
                            </span>
                          )}
                        </>
                      ) : (
                        <span className="rounded-lg bg-accent px-2 py-1 text-xs font-medium text-muted-foreground">
                          Using default policy
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="grid gap-5 lg:grid-cols-2">
              <div className="rounded-xl border border-border bg-card p-5">
                <div className="mb-4 flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-foreground">
                    SLA Outcome
                  </h3>
                  <span className="text-xs text-muted-foreground">
                    Last 30 days
                  </span>
                </div>
                {overviewLoading ? (
                  <p className="text-sm text-muted-foreground">Loading…</p>
                ) : (
                  <div className="space-y-4">
                    {[
                      {
                        key: "first-response",
                        label: "First Response",
                        met: overviewData?.firstResponseMet ?? 0,
                        breached: overviewData?.firstResponseBreached ?? 0,
                      },
                      {
                        key: "resolution",
                        label: "Resolution",
                        met: overviewData?.resolutionMet ?? 0,
                        breached: overviewData?.resolutionBreached ?? 0,
                      },
                    ].map((row) => {
                      const total = row.met + row.breached;
                      const pct =
                        total > 0 ? Math.round((row.met / total) * 100) : 0;
                      return (
                        <div key={row.key}>
                          <div className="mb-1 flex items-center justify-between text-xs">
                            <span className="font-medium text-foreground">
                              {row.label}
                            </span>
                            <span
                              className={`font-semibold ${complianceColor(pct)}`}
                            >
                              {pct}% met
                            </span>
                          </div>
                          <div className="h-2 w-full rounded-full bg-accent">
                            <div
                              className={`h-2 rounded-full ${complianceBg(pct)}`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <p className="mt-1 text-[11px] text-muted-foreground">
                            {row.met} met · {row.breached} breached
                          </p>
                        </div>
                      );
                    })}
                  </div>
                )}
                {overviewError && (
                  <p className="mt-3 text-xs text-red-600">{overviewError}</p>
                )}
              </div>

              <div className="rounded-xl border border-border bg-card p-5">
                <div className="mb-4 flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-foreground">
                    Compliance by Priority
                  </h3>
                  <span className="text-xs text-muted-foreground">
                    Last 30 days
                  </span>
                </div>
                {priorityOverviewData.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No priority SLA data available.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {priorityOverviewData.map((item) => {
                      const key = API_TO_UI_PRIORITY[item.priority] ?? "medium";
                      const pct =
                        item.total > 0
                          ? Math.round((item.met / item.total) * 100)
                          : 0;
                      return (
                        <div key={item.priority}>
                          <div className="mb-1 flex items-center justify-between text-xs">
                            <div className="flex items-center gap-2">
                              <span
                                className={`h-2.5 w-2.5 rounded-full ${PRIORITY_META[key].dot}`}
                              />
                              <span className="font-medium text-foreground">
                                {PRIORITY_META[key].label}
                              </span>
                            </div>
                            <span
                              className={`font-semibold ${complianceColor(pct)}`}
                            >
                              {pct}% met
                            </span>
                          </div>
                          <div className="h-2 w-full rounded-full bg-accent">
                            <div
                              className={`h-2 rounded-full ${complianceBg(pct)}`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <p className="mt-1 text-[11px] text-muted-foreground">
                            {item.met} met · {item.breached} breached
                          </p>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            <div className="overflow-hidden rounded-xl border border-border bg-card">
              <div className="flex items-center justify-between border-b border-border px-5 py-4">
                <div>
                  <h3 className="text-sm font-semibold text-foreground">
                    Compliance by Department
                  </h3>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Each team&apos;s own ticket compliance over the last 30 days.
                  </p>
                </div>
                {overviewError && (
                  <span className="text-xs text-red-600">Unavailable</span>
                )}
              </div>
              {overviewLoading ? (
                <p className="px-5 py-4 text-sm text-muted-foreground">
                  Loading…
                </p>
              ) : teamOverviewData.length === 0 ? (
                <p className="px-5 py-4 text-sm text-muted-foreground">
                  No SLA data for any department yet.
                </p>
              ) : (
                <div className="divide-y divide-border">
                  {teamOverviewData.map((team) => (
                    <div
                      key={team.teamId}
                      className="flex items-center gap-4 px-5 py-3 hover:bg-muted"
                    >
                      <div className="flex min-w-0 items-center gap-3 md:w-48">
                        <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-accent text-muted-foreground">
                          <Users className="h-4 w-4" />
                        </div>
                        <span className="truncate text-sm font-medium text-foreground">
                          {team.teamName}
                        </span>
                      </div>
                      <div className="hidden flex-1 items-center md:flex">
                        <div className="h-2 w-full rounded-full bg-accent">
                          <div
                            className={`h-2 rounded-full ${complianceBg(team.compliance)}`}
                            style={{ width: `${team.compliance}%` }}
                          />
                        </div>
                      </div>
                      <span
                        className={`w-12 flex-shrink-0 text-right text-sm font-semibold ${complianceColor(team.compliance)}`}
                      >
                        {team.compliance}%
                      </span>
                      <span className="hidden w-32 flex-shrink-0 text-right text-[11px] text-muted-foreground sm:block">
                        {team.met} met · {team.breached} breached
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

          </div>
        )}

        {activeTab === "business-hours" && (
          <div className="w-full min-w-0 space-y-5">
            {businessError && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {businessError}
              </div>
            )}
            {businessLoading && (
              <div className="rounded-xl border border-border bg-card p-5">
                <div className="space-y-4">
                  <div className="h-5 w-48 skeleton-shimmer rounded" />
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div
                      key={`bh-skel-${i}`}
                      className="flex items-center gap-4"
                    >
                      <div className="h-4 w-24 skeleton-shimmer rounded" />
                      <div className="h-8 w-20 skeleton-shimmer rounded-lg" />
                      <div className="h-4 w-4 skeleton-shimmer rounded" />
                      <div className="h-8 w-20 skeleton-shimmer rounded-lg" />
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="grid grid-cols-1 gap-5 sm:gap-6 md:gap-8 lg:gap-10 md:grid-cols-2">
              <div className="min-w-0 overflow-hidden rounded-xl border border-border bg-card">
                <div className="border-b border-border px-4 py-3 sm:px-5 sm:py-4">
                  <h3 className="text-sm font-semibold text-foreground">
                    Working Hours
                  </h3>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    SLA timers only tick during active hours on enabled days.
                  </p>
                </div>
                <div className="border-b border-border px-4 py-3 sm:px-5">
                  <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Timezone
                  </label>
                  <input
                    value={businessTimezone}
                    disabled={!canEdit}
                    onChange={(event) =>
                      setBusinessTimezone(event.target.value)
                    }
                    className={`mt-1 w-full rounded-lg border border-border px-3 py-1.5 text-sm focus:border-transparent focus:ring-2 focus:ring-ring ${
                      !canEdit ? "cursor-not-allowed bg-accent" : ""
                    }`}
                    placeholder="e.g. UTC"
                  />
                </div>
                <div className="min-w-0 p-4 sm:p-5">
                  <BusinessHoursEditor
                    disabled={!canEdit}
                    hours={businessHours}
                    onToggleDay={(day) =>
                      setBusinessHours((prev) => ({
                        ...prev,
                        [day]: { ...prev[day], enabled: !prev[day].enabled },
                      }))
                    }
                    onUpdateTime={(day, key, value) =>
                      setBusinessHours((prev) => ({
                        ...prev,
                        [day]: { ...prev[day], [key]: value },
                      }))
                    }
                  />
                </div>
              </div>

              <div className="min-w-0 rounded-xl border border-border bg-card p-4 sm:p-5">
                <h3 className="mb-4 text-sm font-semibold text-foreground">
                  Holidays
                </h3>
                <HolidayManager
                  disabled={!canEdit}
                  holidays={holidays}
                  onAddHoliday={(holiday) =>
                    setHolidays((prev) =>
                      [...prev, holiday].sort((a, b) =>
                        a.date.localeCompare(b.date),
                      ),
                    )
                  }
                  onRemoveHoliday={(holiday) =>
                    setHolidays((prev) =>
                      prev.filter(
                        (item) =>
                          !(
                            item.date === holiday.date &&
                            item.name === holiday.name
                          ),
                      ),
                    )
                  }
                />
              </div>
            </div>

            {canEdit && (
              <div className="flex justify-end">
                <button
                  type="button"
                  disabled={businessSaving}
                  onClick={handleSaveBusinessHours}
                  className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 disabled:cursor-not-allowed disabled:bg-muted"
                >
                  {businessSaving ? "Saving..." : "Save Business Hours"}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {showEditor && (
        <PolicyModal
          policy={editingPolicy}
          teams={policyEditorTeams}
          canEdit={canEdit}
          canSetDefault={role === "OWNER"}
          onSave={handleSave}
          onClose={() => {
            setShowEditor(false);
            setEditingPolicy(null);
          }}
        />
      )}

      {deleteTarget && (
        <DeleteModal
          policy={deleteTarget}
          onConfirm={confirmDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </section>
  );
}
