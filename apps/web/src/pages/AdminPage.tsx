/**
 * @deprecated Legacy composite admin page kept only for reference.
 * Active routing uses dedicated admin pages:
 * `/sla-settings`, `/routing`, `/automation`, `/custom-fields`, `/audit-log`, `/reports`.
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  ArrowRightLeft,
  Bot,
  ChevronRight,
  FileText,
  Filter,
  GripHorizontal,
  Plus,
  Search,
  Settings2,
  Shield,
  Trash2,
  Wrench,
  type LucideIcon
} from 'lucide-react';
import {
  ApiError,
  createAutomationRule,
  createCustomField,
  createRoutingRule,
  deleteAutomationRule,
  deleteCustomField,
  deleteRoutingRule,
  fetchAuditLog,
  fetchAuditLogExport,
  fetchAutomationRuleExecutions,
  fetchAutomationRules,
  fetchCustomFields,
  fetchReportSlaCompliance,
  fetchRoutingRules,
  fetchSlaPolicies,
  fetchTeams,
  fetchUsers,
  updateAutomationRule,
  updateCustomField,
  updateRoutingRule,
  updateSlaPolicies,
  type AuditLogEntry,
  type AutomationAction,
  type AutomationCondition,
  type AutomationRule,
  type CustomFieldRecord,
  type RoutingRule,
  type SlaPolicy,
  type TeamRef,
  type UserRef
} from '../api/client';
import { useToast } from '../hooks/useToast';
import type { Role } from '../types';

function cn(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ');
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    try {
      const parsed = JSON.parse(error.message) as { message?: string };
      if (typeof parsed?.message === 'string' && parsed.message.length > 0) {
        return parsed.message;
      }
    } catch {
      // keep raw ApiError message
    }
    return error.message || fallback;
  }
  if (error instanceof Error) {
    return error.message || fallback;
  }
  return fallback;
}

function formatRelativeTime(iso: string): string {
  const value = Date.parse(iso);
  if (Number.isNaN(value)) return 'Unknown';
  const diffMs = Date.now() - value;
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diffMs < minute) return 'Just now';
  if (diffMs < hour) return `${Math.max(1, Math.floor(diffMs / minute))}m ago`;
  if (diffMs < day) return `${Math.max(1, Math.floor(diffMs / hour))}h ago`;
  return `${Math.max(1, Math.floor(diffMs / day))}d ago`;
}

function titleCase(value: string): string {
  return value
    .toLowerCase()
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
    .join(' ');
}

function hoursLabel(hours: number): string {
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  const rem = hours % 24;
  return rem === 0 ? `${days}d` : `${days}d ${rem}h`;
}

function complianceTextClass(value: number): string {
  if (value >= 95) return 'text-green-600';
  if (value >= 85) return 'text-yellow-600';
  return 'text-red-600';
}

function complianceBarClass(value: number): string {
  if (value >= 95) return 'bg-green-500';
  if (value >= 85) return 'bg-yellow-500';
  return 'bg-red-500';
}

function ToggleSwitch({
  checked,
  onChange,
  disabled = false
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
        className={cn(
          'absolute inset-0 rounded-full transition-colors',
          checked ? 'bg-blue-600' : 'bg-slate-300',
          disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
        )}
      />
      <span
        className={cn(
          'absolute left-[3px] h-[18px] w-[18px] rounded-full bg-white transition-transform',
          checked && 'translate-x-5',
          disabled ? 'cursor-not-allowed' : 'cursor-pointer'
        )}
      />
    </label>
  );
}

function ModalShell({
  title,
  subtitle,
  onClose,
  children,
  footer
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
        <div className="flex items-start justify-between border-b border-slate-200 px-6 py-4">
          <div>
            <h3 className="text-base font-semibold text-slate-900">{title}</h3>
            {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
        {footer && <div className="border-t border-slate-200 bg-slate-50 px-6 py-4">{footer}</div>}
      </div>
    </div>
  );
}

function ConfirmModal({
  title,
  body,
  onConfirm,
  onCancel,
  danger = true
}: {
  title: string;
  body: string;
  onConfirm: () => void;
  onCancel: () => void;
  danger?: boolean;
}) {
  return (
    <ModalShell title={title} onClose={onCancel}>
      <p className="text-sm text-slate-600">{body}</p>
      <div className="mt-5 flex justify-end gap-3">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onConfirm}
          className={cn(
            'rounded-lg px-4 py-2 text-sm font-medium text-white',
            danger ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700'
          )}
        >
          {danger ? 'Delete' : 'Confirm'}
        </button>
      </div>
    </ModalShell>
  );
}

function TodoCard({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
      <p className="text-sm font-semibold text-amber-900">{title}</p>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-amber-800">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

type SettingsSectionKey = 'sla' | 'routing' | 'automation' | 'fields' | 'audit';

const SECTION_ITEMS: Array<{
  id: SettingsSectionKey;
  label: string;
  description: string;
  icon: LucideIcon;
}> = [
  {
    id: 'sla',
    label: 'SLA Policies',
    description: 'Targets, business hours, escalation',
    icon: Shield
  },
  {
    id: 'routing',
    label: 'Routing Rules',
    description: 'Auto-assign teams & priority',
    icon: ArrowRightLeft
  },
  {
    id: 'automation',
    label: 'Automation Rules',
    description: 'Triggers, conditions, actions',
    icon: Bot
  },
  {
    id: 'fields',
    label: 'Custom Fields',
    description: 'Ticket form fields and visibility',
    icon: Wrench
  },
  {
    id: 'audit',
    label: 'Audit Logs',
    description: 'Track every configuration change',
    icon: FileText
  }
];

const GLOBAL_TODOS = [
  'Create a unified backend settings summary endpoint to avoid loading each section separately.',
  'Expose section-level permissions endpoint so UI capabilities are server-driven.'
];

// -------------------------------------
// SLA section
// -------------------------------------

type SlaPriority = 'critical' | 'high' | 'medium' | 'low';
type SlaNotifyRole = 'agent' | 'lead' | 'manager' | 'owner';
type SlaPolicySource = 'live' | 'demo';
type SlaSectionTab = 'policies' | 'overview' | 'hours';
type SlaModalTab = 'targets' | 'teams' | 'escalation';

type SlaTargets = Record<SlaPriority, { firstResponse: number; resolution: number }>;

type SlaPolicyView = {
  id: string;
  name: string;
  description: string;
  source: SlaPolicySource;
  isDefault: boolean;
  enabled: boolean;
  teamIds: string[];
  targets: SlaTargets;
  businessHours: boolean;
  escalation: boolean;
  escalationAfter: number;
  breachNotify: SlaNotifyRole[];
  createdAt: string;
  compliance: number;
  liveTeamId?: string;
};

const SLA_PRIORITIES: SlaPriority[] = ['critical', 'high', 'medium', 'low'];

const SLA_PRIORITY_META: Record<
  SlaPriority,
  { label: string; dot: string; badge: string }
> = {
  critical: { label: 'Critical', dot: 'bg-red-500', badge: 'bg-red-100 text-red-700' },
  high: { label: 'High', dot: 'bg-orange-500', badge: 'bg-orange-100 text-orange-700' },
  medium: { label: 'Medium', dot: 'bg-yellow-500', badge: 'bg-yellow-100 text-yellow-700' },
  low: { label: 'Low', dot: 'bg-blue-500', badge: 'bg-blue-100 text-blue-700' }
};

const SLA_API_TO_UI_PRIORITY: Record<string, SlaPriority> = {
  P1: 'critical',
  P2: 'high',
  P3: 'medium',
  P4: 'low'
};

const SLA_UI_TO_API_PRIORITY: Record<SlaPriority, string> = {
  critical: 'P1',
  high: 'P2',
  medium: 'P3',
  low: 'P4'
};

const SLA_NOTIFY_OPTIONS: Array<{ value: SlaNotifyRole; label: string }> = [
  { value: 'agent', label: 'Assigned Agent' },
  { value: 'lead', label: 'Team Lead' },
  { value: 'manager', label: 'Manager' },
  { value: 'owner', label: 'Platform Owner' }
];

const DEFAULT_SLA_TARGETS: SlaTargets = {
  critical: { firstResponse: 1, resolution: 4 },
  high: { firstResponse: 4, resolution: 8 },
  medium: { firstResponse: 8, resolution: 24 },
  low: { firstResponse: 24, resolution: 72 }
};

const DEMO_SLA_POLICIES: SlaPolicyView[] = [
  {
    id: 'demo-enterprise',
    name: 'Enterprise SLA',
    description: 'Strict SLA for enterprise/VIP clients',
    source: 'demo',
    isDefault: false,
    enabled: true,
    teamIds: [],
    targets: {
      critical: { firstResponse: 0.5, resolution: 2 },
      high: { firstResponse: 2, resolution: 4 },
      medium: { firstResponse: 4, resolution: 12 },
      low: { firstResponse: 8, resolution: 24 }
    },
    businessHours: false,
    escalation: true,
    escalationAfter: 70,
    breachNotify: ['agent', 'lead', 'manager'],
    createdAt: 'Demo',
    compliance: 97
  },
  {
    id: 'demo-internal',
    name: 'Internal IT SLA',
    description: 'Relaxed targets for internal support requests',
    source: 'demo',
    isDefault: false,
    enabled: false,
    teamIds: [],
    targets: {
      critical: { firstResponse: 2, resolution: 8 },
      high: { firstResponse: 8, resolution: 24 },
      medium: { firstResponse: 24, resolution: 72 },
      low: { firstResponse: 48, resolution: 120 }
    },
    businessHours: true,
    escalation: false,
    escalationAfter: 90,
    breachNotify: ['agent'],
    createdAt: 'Demo',
    compliance: 88
  }
];

const SLA_BACKEND_TODOS = [
  'Named SLA policy CRUD is not available in backend yet (create/update/delete metadata is currently UI-local).',
  'Business hours and holidays persistence endpoints are missing.',
  'Escalation and breach notification settings are not yet persisted server-side.'
];

function cloneSlaTargets(targets: SlaTargets): SlaTargets {
  return {
    critical: { ...targets.critical },
    high: { ...targets.high },
    medium: { ...targets.medium },
    low: { ...targets.low }
  };
}

function ensureSingleDefaultPolicy(policies: SlaPolicyView[]): SlaPolicyView[] {
  if (policies.length === 0) return policies;
  const defaultId = policies.find((policy) => policy.isDefault)?.id ?? policies[0].id;
  return policies.map((policy) => ({ ...policy, isDefault: policy.id === defaultId }));
}

function createEmptyDemoPolicy(): SlaPolicyView {
  return {
    id: '',
    name: '',
    description: '',
    source: 'demo',
    isDefault: false,
    enabled: true,
    teamIds: [],
    targets: cloneSlaTargets(DEFAULT_SLA_TARGETS),
    businessHours: true,
    escalation: true,
    escalationAfter: 80,
    breachNotify: ['agent', 'lead'],
    createdAt: 'Demo',
    compliance: 0
  };
}

function targetsFromApi(policies: SlaPolicy[]): SlaTargets {
  const next = cloneSlaTargets(DEFAULT_SLA_TARGETS);
  policies.forEach((policy) => {
    const priority = SLA_API_TO_UI_PRIORITY[policy.priority];
    if (!priority) return;
    next[priority] = {
      firstResponse: Number(policy.firstResponseHours) || 0,
      resolution: Number(policy.resolutionHours) || 0
    };
  });
  return next;
}

function targetsToApiPolicies(targets: SlaTargets): Array<Omit<SlaPolicy, 'source'>> {
  return SLA_PRIORITIES.map((priority) => ({
    priority: SLA_UI_TO_API_PRIORITY[priority],
    firstResponseHours: Number(targets[priority].firstResponse),
    resolutionHours: Number(targets[priority].resolution)
  }));
}

function SlaPolicyEditorModal({
  policy,
  teams,
  canEdit,
  onSave,
  onClose
}: {
  policy: SlaPolicyView | null;
  teams: TeamRef[];
  canEdit: boolean;
  onSave: (next: SlaPolicyView) => Promise<void>;
  onClose: () => void;
}) {
  const isNew = !policy?.id;
  const [form, setForm] = useState<SlaPolicyView>(() =>
    policy
      ? {
          ...policy,
          teamIds: [...policy.teamIds],
          breachNotify: [...policy.breachNotify],
          targets: cloneSlaTargets(policy.targets)
        }
      : createEmptyDemoPolicy()
  );
  const [tab, setTab] = useState<SlaModalTab>('targets');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const modalTabs: Array<{ id: SlaModalTab; label: string }> = [
    { id: 'targets', label: 'SLA Targets' },
    { id: 'teams', label: 'Teams & Scope' },
    { id: 'escalation', label: 'Escalation' }
  ];

  function updateTarget(priority: SlaPriority, key: 'firstResponse' | 'resolution', raw: string) {
    const value = Number(raw) || 0;
    setForm((prev) => ({
      ...prev,
      targets: {
        ...prev.targets,
        [priority]: {
          ...prev.targets[priority],
          [key]: value
        }
      }
    }));
  }

  function toggleTeam(teamId: string) {
    setForm((prev) => ({
      ...prev,
      teamIds: prev.teamIds.includes(teamId)
        ? prev.teamIds.filter((item) => item !== teamId)
        : [...prev.teamIds, teamId]
    }));
  }

  function toggleNotify(role: SlaNotifyRole) {
    setForm((prev) => ({
      ...prev,
      breachNotify: prev.breachNotify.includes(role)
        ? prev.breachNotify.filter((item) => item !== role)
        : [...prev.breachNotify, role]
    }));
  }

  function validate(): boolean {
    const nextErrors: Record<string, string> = {};
    if (!form.name.trim()) nextErrors.name = 'Policy name is required';
    SLA_PRIORITIES.forEach((priority) => {
      if (form.targets[priority].firstResponse <= 0) {
        nextErrors[`${priority}-fr`] = 'Must be > 0';
      }
      if (form.targets[priority].resolution <= form.targets[priority].firstResponse) {
        nextErrors[`${priority}-res`] = 'Must be > first response';
      }
    });
    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  }

  async function handleSubmit() {
    if (!canEdit) return;
    if (!validate()) return;
    setSaving(true);
    try {
      await onSave(form);
    } finally {
      setSaving(false);
    }
  }

  return (
    <ModalShell
      title={isNew ? 'Create SLA Policy' : 'Edit SLA Policy'}
      subtitle={
        isNew
          ? 'Configure response and resolution targets'
          : `Editing "${policy?.name ?? 'Policy'}"`
      }
      onClose={onClose}
      footer={
        <div className="flex items-center justify-between">
          <span className="text-xs text-slate-400">* Required fields</span>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-white"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!canEdit || saving}
              onClick={handleSubmit}
              className={cn(
                'rounded-lg px-4 py-2 text-sm font-medium text-white',
                !canEdit || saving ? 'cursor-not-allowed bg-slate-300' : 'bg-blue-600 hover:bg-blue-700'
              )}
            >
              {saving ? 'Saving...' : isNew ? 'Create Policy' : 'Save Changes'}
            </button>
          </div>
        </div>
      }
    >
      <div className="space-y-5">
        {form.source === 'live' && (
          <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-700">
            Live policy targets are persisted. Other settings are currently local UI state until backend endpoints are added.
          </div>
        )}

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700">Policy Name *</label>
            <input
              value={form.name}
              disabled={!canEdit}
              onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
              className={cn(
                'w-full rounded-lg border px-3 py-2 text-sm focus:border-transparent focus:ring-2 focus:ring-blue-500',
                errors.name ? 'border-red-400' : 'border-slate-300',
                !canEdit && 'cursor-not-allowed bg-slate-100'
              )}
            />
            {errors.name && <p className="mt-1 text-xs text-red-500">{errors.name}</p>}
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700">Description</label>
            <input
              value={form.description}
              disabled={!canEdit}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, description: event.target.value }))
              }
              className={cn(
                'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-transparent focus:ring-2 focus:ring-blue-500',
                !canEdit && 'cursor-not-allowed bg-slate-100'
              )}
            />
          </div>
        </div>

        <div className="border-b border-slate-200">
          <div className="flex gap-5">
            {modalTabs.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                className={cn(
                  'pb-2.5 text-sm font-medium',
                  tab === item.id
                    ? 'border-b-2 border-blue-600 text-blue-600'
                    : 'text-slate-500 hover:text-slate-700'
                )}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        {tab === 'targets' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs text-slate-500">
                Set first response and resolution targets by priority.
              </p>
              <div className="flex items-center gap-2">
                <ToggleSwitch
                  checked={form.businessHours}
                  disabled={!canEdit}
                  onChange={(next) => setForm((prev) => ({ ...prev, businessHours: next }))}
                />
                <span className="text-xs text-slate-600">Business hours only</span>
              </div>
            </div>
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
              <table className="w-full text-sm">
                <thead className="border-b border-slate-200 bg-slate-100">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                      Priority
                    </th>
                    <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                      First Response (h)
                    </th>
                    <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                      Resolution (h)
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {SLA_PRIORITIES.map((priority) => (
                    <tr key={priority} className="bg-white">
                      <td className="px-3 py-2">
                        <span className={cn('rounded-md px-2 py-1 text-xs font-medium', SLA_PRIORITY_META[priority].badge)}>
                          {SLA_PRIORITY_META[priority].label}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            min={0.5}
                            step={0.5}
                            disabled={!canEdit}
                            value={form.targets[priority].firstResponse}
                            onChange={(event) => updateTarget(priority, 'firstResponse', event.target.value)}
                            className={cn(
                              'w-20 rounded-lg border px-2 py-1 text-sm focus:border-transparent focus:ring-2 focus:ring-blue-500',
                              errors[`${priority}-fr`] ? 'border-red-400' : 'border-slate-300',
                              !canEdit && 'cursor-not-allowed bg-slate-100'
                            )}
                          />
                          <span className="text-xs text-slate-400">
                            = {hoursLabel(form.targets[priority].firstResponse)}
                          </span>
                        </div>
                        {errors[`${priority}-fr`] && (
                          <p className="mt-1 text-xs text-red-500">{errors[`${priority}-fr`]}</p>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            min={1}
                            step={1}
                            disabled={!canEdit}
                            value={form.targets[priority].resolution}
                            onChange={(event) => updateTarget(priority, 'resolution', event.target.value)}
                            className={cn(
                              'w-20 rounded-lg border px-2 py-1 text-sm focus:border-transparent focus:ring-2 focus:ring-blue-500',
                              errors[`${priority}-res`] ? 'border-red-400' : 'border-slate-300',
                              !canEdit && 'cursor-not-allowed bg-slate-100'
                            )}
                          />
                          <span className="text-xs text-slate-400">
                            = {hoursLabel(form.targets[priority].resolution)}
                          </span>
                        </div>
                        {errors[`${priority}-res`] && (
                          <p className="mt-1 text-xs text-red-500">{errors[`${priority}-res`]}</p>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {tab === 'teams' && (
          <div className="space-y-4">
            <div>
              <p className="mb-2 text-xs font-medium text-slate-700">Apply to Teams</p>
              <div className="grid grid-cols-2 gap-2">
                {teams.map((team) => (
                  <label
                    key={team.id}
                    className={cn(
                      'flex cursor-pointer items-center gap-2 rounded-lg border p-2 text-xs',
                      form.teamIds.includes(team.id)
                        ? 'border-blue-500 bg-blue-50'
                        : 'border-slate-200 hover:border-slate-300'
                    )}
                  >
                    <input
                      type="checkbox"
                      disabled={!canEdit}
                      checked={form.teamIds.includes(team.id)}
                      onChange={() => toggleTeam(team.id)}
                      className="h-3.5 w-3.5 rounded text-blue-600"
                    />
                    <span className="font-medium text-slate-700">{team.name}</span>
                  </label>
                ))}
              </div>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div>
                <p className="text-sm font-medium text-slate-700">Set as default</p>
                <p className="text-xs text-slate-500">
                  Applied when team-specific policy is not available.
                </p>
              </div>
              <ToggleSwitch
                checked={form.isDefault}
                disabled={!canEdit}
                onChange={(next) => setForm((prev) => ({ ...prev, isDefault: next }))}
              />
            </div>
            <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div>
                <p className="text-sm font-medium text-slate-700">Policy status</p>
                <p className="text-xs text-slate-500">Disabled policies are ignored by runtime checks.</p>
              </div>
              <ToggleSwitch
                checked={form.enabled}
                disabled={!canEdit}
                onChange={(next) => setForm((prev) => ({ ...prev, enabled: next }))}
              />
            </div>
          </div>
        )}

        {tab === 'escalation' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div>
                <p className="text-sm font-medium text-slate-700">Enable escalation</p>
                <p className="text-xs text-slate-500">Escalate tickets approaching SLA breach.</p>
              </div>
              <ToggleSwitch
                checked={form.escalation}
                disabled={!canEdit}
                onChange={(next) => setForm((prev) => ({ ...prev, escalation: next }))}
              />
            </div>

            {form.escalation && (
              <div className="rounded-lg border border-slate-200 bg-white p-3">
                <p className="mb-2 text-xs font-medium text-slate-700">
                  Escalate when{' '}
                  <span className="font-semibold text-blue-600">{form.escalationAfter}%</span> of SLA time has elapsed
                </p>
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min={50}
                    max={95}
                    step={5}
                    disabled={!canEdit}
                    value={form.escalationAfter}
                    onChange={(event) =>
                      setForm((prev) => ({ ...prev, escalationAfter: Number(event.target.value) }))
                    }
                    className="flex-1 accent-blue-600"
                  />
                  <span className="w-10 text-right text-sm font-semibold text-blue-600">
                    {form.escalationAfter}%
                  </span>
                </div>
              </div>
            )}

            <div className="rounded-lg border border-slate-200 bg-white p-3">
              <p className="mb-2 text-xs font-medium text-slate-700">Notify on breach</p>
              <div className="space-y-1.5">
                {SLA_NOTIFY_OPTIONS.map((option) => (
                  <label key={option.value} className="flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      disabled={!canEdit}
                      checked={form.breachNotify.includes(option.value)}
                      onChange={() => toggleNotify(option.value)}
                      className="h-4 w-4 rounded text-blue-600"
                    />
                    <span>{option.label}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </ModalShell>
  );
}

function SlaSection({ teams, canEdit }: { teams: TeamRef[]; canEdit: boolean }) {
  const toast = useToast();
  const [tab, setTab] = useState<SlaSectionTab>('policies');
  const [policies, setPolicies] = useState<SlaPolicyView[]>([]);
  const [selectedPolicyId, setSelectedPolicyId] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editorPolicy, setEditorPolicy] = useState<SlaPolicyView | null>(null);
  const [showEditor, setShowEditor] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<SlaPolicyView | null>(null);
  const [overview, setOverview] = useState<{
    met: number;
    breached: number;
    total: number;
    firstResponseMet: number;
    firstResponseBreached: number;
    resolutionMet: number;
    resolutionBreached: number;
  } | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [overviewError, setOverviewError] = useState<string | null>(null);
  const [holidayName, setHolidayName] = useState('');
  const [holidayDate, setHolidayDate] = useState('');
  const [businessHours, setBusinessHours] = useState<
    Record<
      string,
      {
        enabled: boolean;
        start: string;
        end: string;
      }
    >
  >({
    Monday: { enabled: true, start: '09:00', end: '18:00' },
    Tuesday: { enabled: true, start: '09:00', end: '18:00' },
    Wednesday: { enabled: true, start: '09:00', end: '18:00' },
    Thursday: { enabled: true, start: '09:00', end: '18:00' },
    Friday: { enabled: true, start: '09:00', end: '17:00' },
    Saturday: { enabled: false, start: '10:00', end: '14:00' },
    Sunday: { enabled: false, start: '10:00', end: '14:00' }
  });
  const [holidays, setHolidays] = useState<Array<{ id: string; name: string; date: string }>>([
    { id: 'h1', name: "New Year's Day", date: '2026-01-01' },
    { id: 'h2', name: 'Memorial Day', date: '2026-05-25' },
    { id: 'h3', name: 'Independence Day', date: '2026-07-04' }
  ]);

  const teamNameById = useMemo(() => {
    return new Map(teams.map((team) => [team.id, team.name]));
  }, [teams]);

  const loadPolicies = useCallback(async () => {
    if (teams.length === 0) {
      setPolicies(ensureSingleDefaultPolicy([...DEMO_SLA_POLICIES]));
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const livePolicies = await Promise.all(
        teams.map(async (team) => {
          let targets = cloneSlaTargets(DEFAULT_SLA_TARGETS);
          let compliance = 0;
          try {
            const response = await fetchSlaPolicies(team.id);
            targets = targetsFromApi(response.data);
          } catch {
            // fallback to defaults for that team
          }
          try {
            const complianceResponse = await fetchReportSlaCompliance({ teamId: team.id });
            const total = complianceResponse.data.total;
            compliance = total > 0 ? Math.round((complianceResponse.data.met / total) * 100) : 0;
          } catch {
            // keep 0 when unavailable
          }

          return {
            id: `live-${team.id}`,
            name: `${team.name} SLA`,
            description: 'Live backend SLA targets for this team',
            source: 'live' as const,
            isDefault: false,
            enabled: true,
            teamIds: [team.id],
            targets,
            businessHours: true,
            escalation: true,
            escalationAfter: 80,
            breachNotify: ['agent', 'lead'] as SlaNotifyRole[],
            createdAt: 'Live',
            compliance,
            liveTeamId: team.id
          };
        })
      );

      setPolicies((prev) => {
        const previousMap = new Map(prev.map((policy) => [policy.id, policy]));
        const demoPolicies =
          prev.filter((policy) => policy.source === 'demo').length > 0
            ? prev.filter((policy) => policy.source === 'demo')
            : [...DEMO_SLA_POLICIES];

        const mergedLive = livePolicies.map((policy) => {
          const previous = previousMap.get(policy.id);
          if (!previous) return policy;
          return {
            ...policy,
            name: previous.name,
            description: previous.description,
            isDefault: previous.isDefault,
            enabled: previous.enabled,
            businessHours: previous.businessHours,
            escalation: previous.escalation,
            escalationAfter: previous.escalationAfter,
            breachNotify: previous.breachNotify
          };
        });

        return ensureSingleDefaultPolicy([...mergedLive, ...demoPolicies]);
      });
    } catch (loadError) {
      setError(getErrorMessage(loadError, 'Unable to load SLA settings.'));
      setPolicies((prev) => (prev.length > 0 ? prev : ensureSingleDefaultPolicy([...DEMO_SLA_POLICIES])));
    } finally {
      setLoading(false);
    }
  }, [teams]);

  const loadOverview = useCallback(async () => {
    setOverviewLoading(true);
    setOverviewError(null);
    try {
      const response = await fetchReportSlaCompliance({});
      setOverview(response.data);
    } catch (loadError) {
      setOverviewError(
        `${getErrorMessage(loadError, 'Overview metrics unavailable.')} Showing fallback values where needed.`
      );
      setOverview(null);
    } finally {
      setOverviewLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPolicies();
  }, [loadPolicies]);

  useEffect(() => {
    if (tab !== 'overview') return;
    void loadOverview();
  }, [tab, loadOverview]);

  useEffect(() => {
    if (policies.length === 0) {
      setSelectedPolicyId('');
      return;
    }
    if (!policies.some((policy) => policy.id === selectedPolicyId)) {
      setSelectedPolicyId(policies[0].id);
    }
  }, [policies, selectedPolicyId]);

  const filteredPolicies = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return policies;
    return policies.filter((policy) => {
      const teamNames = policy.teamIds.map((teamId) => teamNameById.get(teamId) ?? teamId).join(' ');
      return (
        policy.name.toLowerCase().includes(query) ||
        policy.description.toLowerCase().includes(query) ||
        teamNames.toLowerCase().includes(query)
      );
    });
  }, [policies, search, teamNameById]);

  const selectedPolicy = useMemo(
    () => policies.find((policy) => policy.id === selectedPolicyId) ?? null,
    [policies, selectedPolicyId]
  );

  const overallCompliance = useMemo(() => {
    const eligible = policies.filter((policy) => policy.enabled && policy.compliance > 0);
    if (eligible.length === 0) return 0;
    const sum = eligible.reduce((acc, policy) => acc + policy.compliance, 0);
    return Math.round(sum / eligible.length);
  }, [policies]);

  const activePolicies = policies.filter((policy) => policy.enabled).length;
  const teamsCovered = new Set(policies.flatMap((policy) => policy.teamIds)).size;

  const teamAssignment = teams.map((team) => {
    const policy = policies.find((item) => item.enabled && item.teamIds.includes(team.id));
    return { team, policy };
  });

  function toTeamNames(teamIds: string[]): string[] {
    if (teamIds.length === 0) return [];
    return teamIds.map((teamId) => teamNameById.get(teamId) ?? teamId);
  }

  async function handleSavePolicy(next: SlaPolicyView) {
    const existing = next.id ? policies.find((policy) => policy.id === next.id) ?? null : null;
    const isLive = next.source === 'live' && Boolean(next.liveTeamId);

    if (isLive && next.liveTeamId) {
      await updateSlaPolicies(next.liveTeamId, targetsToApiPolicies(next.targets));
      setPolicies((prev) =>
        ensureSingleDefaultPolicy(prev.map((policy) => (policy.id === next.id ? next : policy)))
      );
      toast.success('Live SLA targets saved.');

      if (
        existing &&
        (existing.name !== next.name ||
          existing.description !== next.description ||
          existing.businessHours !== next.businessHours ||
          existing.escalation !== next.escalation ||
          existing.escalationAfter !== next.escalationAfter ||
          existing.enabled !== next.enabled ||
          existing.isDefault !== next.isDefault)
      ) {
        toast.info('Some non-target settings are currently local UI only.');
      }
    } else if (next.id) {
      setPolicies((prev) =>
        ensureSingleDefaultPolicy(prev.map((policy) => (policy.id === next.id ? next : policy)))
      );
      toast.success('Policy updated.');
    } else {
      const created: SlaPolicyView = {
        ...next,
        id: `demo-${Date.now()}`,
        source: 'demo',
        createdAt: 'Demo',
        compliance: 0
      };
      setPolicies((prev) => ensureSingleDefaultPolicy([...prev, created]));
      toast.success('Demo policy created.');
    }

    setShowEditor(false);
    setEditorPolicy(null);
  }

  function handleToggleEnabled(policy: SlaPolicyView) {
    if (!canEdit) return;
    setPolicies((prev) =>
      prev.map((item) =>
        item.id === policy.id
          ? {
              ...item,
              enabled: !item.enabled
            }
          : item
      )
    );
    if (policy.source === 'live') {
      toast.info('Policy enabled/disabled is local UI state until backend metadata endpoints are added.');
    } else {
      toast.success(policy.enabled ? 'Policy disabled.' : 'Policy enabled.');
    }
  }

  function handleSetDefault(policyId: string) {
    if (!canEdit) return;
    setPolicies((prev) =>
      prev.map((policy) => ({
        ...policy,
        isDefault: policy.id === policyId
      }))
    );
    toast.success('Default policy updated.');
  }

  function handleDeletePolicy() {
    if (!deleteTarget) return;
    if (deleteTarget.source === 'live') {
      toast.warning('Deleting live backend SLA policies is not yet supported.');
      setDeleteTarget(null);
      return;
    }
    setPolicies((prev) =>
      ensureSingleDefaultPolicy(prev.filter((policy) => policy.id !== deleteTarget.id))
    );
    setDeleteTarget(null);
    toast.success('Policy deleted.');
  }

  function addHoliday() {
    if (!holidayName.trim() || !holidayDate) return;
    setHolidays((prev) => [
      ...prev,
      { id: `holiday-${Date.now()}`, name: holidayName.trim(), date: holidayDate }
    ]);
    setHolidayName('');
    setHolidayDate('');
    toast.success('Holiday added (demo).');
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-lg bg-slate-100 p-1">
          {[
            { id: 'policies' as const, label: 'Policies' },
            { id: 'overview' as const, label: 'Overview' },
            { id: 'hours' as const, label: 'Business Hours' }
          ].map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              className={cn(
                'rounded-md px-4 py-1.5 text-sm font-medium',
                tab === item.id
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700'
              )}
            >
              {item.label}
            </button>
          ))}
        </div>

        {canEdit && tab === 'policies' && (
          <button
            type="button"
            onClick={() => {
              setEditorPolicy(null);
              setShowEditor(true);
            }}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            <Plus className="h-4 w-4" />
            <span>New Policy</span>
          </button>
        )}
      </div>

      {tab === 'policies' && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            {[
              { label: 'Total Policies', value: policies.length, color: 'text-blue-600' },
              { label: 'Active Policies', value: activePolicies, color: 'text-green-600' },
              { label: 'Teams Covered', value: teamsCovered, color: 'text-purple-600' },
              {
                label: 'Avg Compliance',
                value: `${overallCompliance}%`,
                color: complianceTextClass(overallCompliance)
              }
            ].map((kpi) => (
              <div key={kpi.label} className="rounded-xl border border-slate-200 bg-white p-4">
                <p className="text-xs font-medium text-slate-500">{kpi.label}</p>
                <p className={cn('mt-1 text-2xl font-bold', kpi.color)}>{kpi.value}</p>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <h4 className="text-sm font-semibold text-slate-900">
              Policies <span className="ml-1 font-normal text-slate-400">({filteredPolicies.length})</span>
            </h4>
            <div className="relative">
              <input
                type="text"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search policies..."
                className="w-64 rounded-lg border border-slate-300 pl-9 pr-3 py-2 text-sm focus:border-transparent focus:ring-2 focus:ring-blue-500"
              />
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            </div>
          </div>

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}

          <div className="grid gap-5 lg:grid-cols-12">
            <div className="space-y-3 lg:col-span-5">
              {loading && (
                <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-500">
                  Loading policies...
                </div>
              )}

              {!loading &&
                filteredPolicies.map((policy) => (
                  <div
                    key={policy.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => setSelectedPolicyId(policy.id)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') setSelectedPolicyId(policy.id);
                    }}
                    className={cn(
                      'cursor-pointer rounded-xl border-2 bg-white p-4 transition-all',
                      selectedPolicyId === policy.id
                        ? 'border-blue-500 bg-blue-50/40'
                        : 'border-slate-200 hover:border-slate-300'
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-semibold text-slate-900">{policy.name}</p>
                          {policy.isDefault && (
                            <span className="rounded-md bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
                              Default
                            </span>
                          )}
                          {!policy.enabled && (
                            <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">
                              Disabled
                            </span>
                          )}
                          <span
                            className={cn(
                              'rounded-md px-2 py-0.5 text-xs font-medium',
                              policy.source === 'live'
                                ? 'bg-green-100 text-green-700'
                                : 'bg-purple-100 text-purple-700'
                            )}
                          >
                            {policy.source === 'live' ? 'Live' : 'Demo'}
                          </span>
                        </div>
                        <p className="mt-0.5 text-xs text-slate-500">{policy.description}</p>
                        {policy.compliance > 0 && (
                          <div className="mt-2 flex items-center gap-2">
                            <div className="h-1.5 w-16 rounded-full bg-slate-200">
                              <div
                                className={cn('h-1.5 rounded-full', complianceBarClass(policy.compliance))}
                                style={{ width: `${policy.compliance}%` }}
                              />
                            </div>
                            <span className={cn('text-xs font-semibold', complianceTextClass(policy.compliance))}>
                              {policy.compliance}%
                            </span>
                          </div>
                        )}
                      </div>

                      <div className="flex items-center gap-1" onClick={(event) => event.stopPropagation()}>
                        {canEdit && (
                          <>
                            <button
                              type="button"
                              title={policy.enabled ? 'Disable' : 'Enable'}
                              onClick={() => handleToggleEnabled(policy)}
                              className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                            >
                              <Settings2 className="h-4 w-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setEditorPolicy(policy);
                                setShowEditor(true);
                              }}
                              className="rounded p-1.5 text-slate-400 hover:bg-blue-50 hover:text-blue-600"
                            >
                              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                              </svg>
                            </button>
                            {!policy.isDefault && (
                              <button
                                type="button"
                                onClick={() => setDeleteTarget(policy)}
                                className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </div>

                    <div className="mt-3 grid grid-cols-4 gap-1 border-t border-slate-100 pt-3">
                      {SLA_PRIORITIES.map((priority) => (
                        <div key={priority} className="text-center">
                          <span className={cn('mb-1 inline-block h-2 w-2 rounded-full', SLA_PRIORITY_META[priority].dot)} />
                          <p className="text-xs text-slate-400">{SLA_PRIORITY_META[priority].label}</p>
                          <p className="text-xs font-semibold text-slate-700">
                            {hoursLabel(policy.targets[priority].resolution)}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}

              {canEdit && !loading && (
                <button
                  type="button"
                  onClick={() => {
                    setEditorPolicy(null);
                    setShowEditor(true);
                  }}
                  className="w-full rounded-xl border-2 border-dashed border-slate-300 p-4 text-sm text-slate-400 transition-colors hover:border-blue-400 hover:text-blue-600"
                >
                  + Add New Policy
                </button>
              )}
            </div>

            <div className="lg:col-span-7">
              {selectedPolicy ? (
                <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                  <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">{selectedPolicy.name}</p>
                      <p className="text-xs text-slate-500">{selectedPolicy.description}</p>
                    </div>
                    {canEdit && (
                      <button
                        type="button"
                        onClick={() => handleSetDefault(selectedPolicy.id)}
                        className="rounded-lg border border-blue-200 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-50"
                      >
                        Set Default
                      </button>
                    )}
                  </div>
                  <div className="space-y-5 p-5">
                    {selectedPolicy.compliance > 0 && (
                      <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                        <div className="mb-2 flex items-center justify-between">
                          <span className="text-xs font-medium text-slate-600">SLA Compliance (30d)</span>
                          <span className={cn('text-xl font-bold', complianceTextClass(selectedPolicy.compliance))}>
                            {selectedPolicy.compliance}%
                          </span>
                        </div>
                        <div className="h-2 w-full rounded-full bg-slate-200">
                          <div
                            className={cn('h-2 rounded-full', complianceBarClass(selectedPolicy.compliance))}
                            style={{ width: `${selectedPolicy.compliance}%` }}
                          />
                        </div>
                      </div>
                    )}

                    <div>
                      <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">SLA Targets</p>
                      <div className="overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
                        <table className="w-full text-sm">
                          <thead className="border-b border-slate-200 bg-slate-100">
                            <tr>
                              <th className="px-3 py-2 text-left text-xs font-medium text-slate-500">Priority</th>
                              <th className="px-3 py-2 text-left text-xs font-medium text-slate-500">1st Response</th>
                              <th className="px-3 py-2 text-left text-xs font-medium text-slate-500">Resolution</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-200">
                            {SLA_PRIORITIES.map((priority) => (
                              <tr key={priority} className="bg-white">
                                <td className="px-3 py-2">
                                  <div className="flex items-center gap-2">
                                    <span className={cn('h-2 w-2 rounded-full', SLA_PRIORITY_META[priority].dot)} />
                                    <span className="text-xs font-medium text-slate-700">{SLA_PRIORITY_META[priority].label}</span>
                                  </div>
                                </td>
                                <td className="px-3 py-2 text-xs font-semibold text-slate-700">
                                  {hoursLabel(selectedPolicy.targets[priority].firstResponse)}
                                </td>
                                <td className="px-3 py-2 text-xs font-semibold text-slate-700">
                                  {hoursLabel(selectedPolicy.targets[priority].resolution)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    <div>
                      <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">Configuration</p>
                      <div className="flex flex-wrap gap-2">
                        <span
                          className={cn(
                            'rounded-md px-2 py-1 text-xs font-medium',
                            selectedPolicy.businessHours
                              ? 'bg-indigo-100 text-indigo-700'
                              : 'bg-slate-100 text-slate-600'
                          )}
                        >
                          {selectedPolicy.businessHours ? 'Business Hours' : '24/7'}
                        </span>
                        <span
                          className={cn(
                            'rounded-md px-2 py-1 text-xs font-medium',
                            selectedPolicy.escalation
                              ? 'bg-orange-100 text-orange-700'
                              : 'bg-slate-100 text-slate-600'
                          )}
                        >
                          {selectedPolicy.escalation
                            ? `Escalate at ${selectedPolicy.escalationAfter}%`
                            : 'No Escalation'}
                        </span>
                        {selectedPolicy.breachNotify.map((role) => (
                          <span key={role} className="rounded-md bg-purple-100 px-2 py-1 text-xs font-medium text-purple-700">
                            {SLA_NOTIFY_OPTIONS.find((item) => item.value === role)?.label ?? role}
                          </span>
                        ))}
                      </div>
                    </div>

                    <div>
                      <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">Applied To</p>
                      {selectedPolicy.teamIds.length === 0 ? (
                        <p className="text-xs italic text-slate-400">Not applied to any teams</p>
                      ) : (
                        <div className="flex flex-wrap gap-1.5">
                          {toTeamNames(selectedPolicy.teamIds).map((teamName) => (
                            <span key={teamName} className="rounded-md bg-green-100 px-2 py-1 text-xs font-medium text-green-700">
                              {teamName}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    <p className="text-xs text-slate-400">Created {selectedPolicy.createdAt}</p>
                  </div>
                </div>
              ) : (
                <div className="flex min-h-[260px] flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-200 bg-white p-8 text-center">
                  <p className="text-sm font-medium text-slate-600">Select a policy to view details</p>
                  <p className="mt-1 text-xs text-slate-400">Choose any policy from the left panel.</p>
                </div>
              )}
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <div className="border-b border-slate-200 px-5 py-4">
              <p className="text-sm font-semibold text-slate-900">Team-Policy Assignment</p>
              <p className="mt-0.5 text-xs text-slate-500">Active SLA policy per team.</p>
            </div>
            <div className="divide-y divide-slate-100">
              {teamAssignment.map(({ team, policy }) => (
                <div key={team.id} className="flex items-center justify-between px-5 py-3 hover:bg-slate-50">
                  <span className="text-sm font-medium text-slate-900">{team.name}</span>
                  {policy ? (
                    <div className="flex items-center gap-2">
                      <span className="rounded-md bg-green-100 px-2 py-1 text-xs font-medium text-green-700">
                        {policy.name}
                      </span>
                      {policy.compliance > 0 && (
                        <span className={cn('text-xs font-medium', complianceTextClass(policy.compliance))}>
                          {policy.compliance}% compliant
                        </span>
                      )}
                    </div>
                  ) : (
                    <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-medium text-slate-500">
                      Using default policy
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>

          <TodoCard title="Backend TODO (SLA)" items={SLA_BACKEND_TODOS} />
        </div>
      )}

      {tab === 'overview' && (
        <div className="space-y-5">
          <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-700">
            Compliance totals are loaded from backend reports when available. Per-priority bars are demo until dedicated breakdown endpoint is added.
          </div>

          <div className="grid gap-5 md:grid-cols-3">
            <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 md:col-span-2">
              <p className="text-sm font-semibold text-slate-900">Compliance by Priority (30d)</p>
              {[{ p: 'critical', v: 91, t: 95 }, { p: 'high', v: 94, t: 95 }, { p: 'medium', v: 97, t: 90 }, { p: 'low', v: 99, t: 85 }].map((row) => {
                const priority = row.p as SlaPriority;
                return (
                  <div key={row.p}>
                    <div className="mb-1 flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2">
                        <span className={cn('h-2.5 w-2.5 rounded-full', SLA_PRIORITY_META[priority].dot)} />
                        <span className="font-medium text-slate-700">{SLA_PRIORITY_META[priority].label}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-slate-400">Target: {row.t}%</span>
                        <span className={cn('font-semibold', row.v >= row.t ? 'text-green-600' : 'text-red-600')}>
                          {row.v}% {row.v >= row.t ? '✓' : '✗'}
                        </span>
                      </div>
                    </div>
                    <div className="relative h-3 w-full rounded-full bg-slate-100">
                      <div
                        className={cn('h-3 rounded-full', row.v >= row.t ? 'bg-green-500' : 'bg-red-500')}
                        style={{ width: `${row.v}%` }}
                      />
                      <div className="absolute top-0 h-3 w-0.5 bg-slate-500/40" style={{ left: `${row.t}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-5">
              <p className="mb-4 text-sm font-semibold text-slate-900">Breach Summary</p>
              {overviewLoading && <p className="text-sm text-slate-500">Loading...</p>}
              {!overviewLoading && (
                <div className="space-y-2">
                  {[
                    {
                      label: 'Breached (1st Response)',
                      value: overview?.firstResponseBreached ?? 0,
                      className: 'bg-red-50 text-red-600'
                    },
                    {
                      label: 'Breached (Resolution)',
                      value: overview?.resolutionBreached ?? 0,
                      className: 'bg-red-50 text-red-600'
                    },
                    {
                      label: 'At Risk (>80%)',
                      value: Math.max(0, Math.round((overview?.total ?? 0) * 0.05)),
                      className: 'bg-yellow-50 text-yellow-700'
                    },
                    {
                      label: 'Compliant',
                      value: overview?.met ?? 0,
                      className: 'bg-green-50 text-green-700'
                    }
                  ].map((item) => (
                    <div key={item.label} className={cn('flex items-center justify-between rounded-lg p-3', item.className)}>
                      <span className="text-xs text-slate-700">{item.label}</span>
                      <span className="text-base font-bold">{item.value}</span>
                    </div>
                  ))}
                </div>
              )}
              <div className="mt-4 border-t border-slate-100 pt-4">
                <div className="flex justify-between text-xs text-slate-500">
                  <span>Overall</span>
                  <span className={cn('font-semibold', complianceTextClass(overallCompliance))}>
                    {overallCompliance}% compliant
                  </span>
                </div>
                <div className="mt-1.5 h-2 w-full rounded-full bg-slate-100">
                  <div
                    className={cn('h-2 rounded-full', complianceBarClass(overallCompliance))}
                    style={{ width: `${overallCompliance}%` }}
                  />
                </div>
                {overviewError && <p className="mt-2 text-xs text-purple-700">{overviewError}</p>}
              </div>
            </div>
          </div>
        </div>
      )}

      {tab === 'hours' && (
        <div className="space-y-5">
          <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-700">
            Business hours and holidays are currently demo UI in Admin Settings. Persistence APIs are tracked in TODOs.
          </div>

          <div className="grid gap-5 md:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-white p-5">
              <p className="mb-3 text-sm font-semibold text-slate-900">Working Hours</p>
              <div className="space-y-2">
                {Object.keys(businessHours).map((day) => (
                  <div
                    key={day}
                    className={cn(
                      'flex items-center gap-3 rounded-lg border p-3',
                      businessHours[day].enabled
                        ? 'border-slate-200 bg-white'
                        : 'border-slate-200 bg-slate-50 opacity-70'
                    )}
                  >
                    <ToggleSwitch
                      checked={businessHours[day].enabled}
                      disabled={!canEdit}
                      onChange={(next) =>
                        setBusinessHours((prev) => ({
                          ...prev,
                          [day]: {
                            ...prev[day],
                            enabled: next
                          }
                        }))
                      }
                    />
                    <span className="w-24 text-sm font-medium text-slate-700">{day}</span>
                    {businessHours[day].enabled ? (
                      <div className="flex items-center gap-2">
                        <input
                          type="time"
                          value={businessHours[day].start}
                          disabled={!canEdit}
                          onChange={(event) =>
                            setBusinessHours((prev) => ({
                              ...prev,
                              [day]: {
                                ...prev[day],
                                start: event.target.value
                              }
                            }))
                          }
                          className="rounded-lg border border-slate-300 px-2 py-1 text-sm"
                        />
                        <span className="text-sm text-slate-400">to</span>
                        <input
                          type="time"
                          value={businessHours[day].end}
                          disabled={!canEdit}
                          onChange={(event) =>
                            setBusinessHours((prev) => ({
                              ...prev,
                              [day]: {
                                ...prev[day],
                                end: event.target.value
                              }
                            }))
                          }
                          className="rounded-lg border border-slate-300 px-2 py-1 text-sm"
                        />
                      </div>
                    ) : (
                      <span className="text-sm italic text-slate-400">Closed</span>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-5">
              <p className="mb-3 text-sm font-semibold text-slate-900">Holidays</p>
              <div className="space-y-2">
                {holidays.map((holiday) => (
                  <div key={holiday.id} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
                    <div>
                      <p className="text-sm font-medium text-slate-700">{holiday.name}</p>
                      <p className="text-xs text-slate-500">{holiday.date}</p>
                    </div>
                    {canEdit && (
                      <button
                        type="button"
                        onClick={() => {
                          setHolidays((prev) => prev.filter((item) => item.id !== holiday.id));
                          toast.success('Holiday removed (demo).');
                        }}
                        className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                ))}
              </div>

              {canEdit && (
                <div className="mt-3 flex items-center gap-2 border-t border-slate-100 pt-3">
                  <input
                    value={holidayName}
                    onChange={(event) => setHolidayName(event.target.value)}
                    placeholder="Holiday name"
                    className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-transparent focus:ring-2 focus:ring-blue-500"
                  />
                  <input
                    type="date"
                    value={holidayDate}
                    onChange={(event) => setHolidayDate(event.target.value)}
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-transparent focus:ring-2 focus:ring-blue-500"
                  />
                  <button
                    type="button"
                    onClick={addHoliday}
                    className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
                  >
                    Add
                  </button>
                </div>
              )}
            </div>
          </div>

          {canEdit && (
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => toast.success('Business hours saved locally (demo).')}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
              >
                Save Business Hours
              </button>
            </div>
          )}

          <TodoCard title="Backend TODO (Business Hours)" items={SLA_BACKEND_TODOS} />
        </div>
      )}

      {showEditor && (
        <SlaPolicyEditorModal
          policy={editorPolicy}
          teams={teams}
          canEdit={canEdit}
          onClose={() => {
            setShowEditor(false);
            setEditorPolicy(null);
          }}
          onSave={handleSavePolicy}
        />
      )}

      {deleteTarget && (
        <ConfirmModal
          title="Delete SLA Policy"
          body={`Delete "${deleteTarget.name}"? This action cannot be undone.`}
          onConfirm={handleDeletePolicy}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}

// -------------------------------------
// Routing section
// -------------------------------------

type RoutingEditorState = {
  id?: string;
  name: string;
  teamId: string;
  priority: number;
  isActive: boolean;
  keywords: string[];
};

const ROUTING_BACKEND_TODOS = [
  'Advanced condition trees and multi-action routing payloads are not yet available in backend.',
  'Rule drag-reorder endpoint is missing (priority must be edited manually).'
];

function RoutingRuleModal({
  rule,
  teams,
  canEdit,
  onSave,
  onClose
}: {
  rule: RoutingEditorState | null;
  teams: TeamRef[];
  canEdit: boolean;
  onSave: (next: RoutingEditorState) => Promise<void>;
  onClose: () => void;
}) {
  const isNew = !rule?.id;
  const [form, setForm] = useState<RoutingEditorState>(
    rule ?? {
      name: '',
      teamId: '',
      priority: 100,
      isActive: true,
      keywords: []
    }
  );
  const [keywordInput, setKeywordInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function addKeyword(raw: string) {
    const normalized = raw.trim().toLowerCase();
    if (!normalized) return;
    setForm((prev) => ({
      ...prev,
      keywords: prev.keywords.includes(normalized) ? prev.keywords : [...prev.keywords, normalized]
    }));
  }

  function handleKeywordKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter' || event.key === ',' || event.key === 'Tab') {
      event.preventDefault();
      addKeyword(keywordInput);
      setKeywordInput('');
    }
    if (event.key === 'Backspace' && keywordInput.length === 0 && form.keywords.length > 0) {
      setForm((prev) => ({ ...prev, keywords: prev.keywords.slice(0, -1) }));
    }
  }

  async function submit() {
    if (!canEdit) return;
    if (!form.name.trim() || !form.teamId || form.keywords.length === 0) {
      setError('Name, team, and at least one keyword are required.');
      return;
    }
    setError(null);
    setSaving(true);
    try {
      await onSave(form);
    } finally {
      setSaving(false);
    }
  }

  return (
    <ModalShell
      title={isNew ? 'Create Routing Rule' : 'Edit Routing Rule'}
      subtitle="Define keyword conditions and the resulting routing action."
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-white"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!canEdit || saving}
            onClick={submit}
            className={cn(
              'rounded-lg px-4 py-2 text-sm font-medium text-white',
              !canEdit || saving ? 'cursor-not-allowed bg-slate-300' : 'bg-blue-600 hover:bg-blue-700'
            )}
          >
            {saving ? 'Saving...' : isNew ? 'Create Rule' : 'Save Changes'}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700">Rule Name *</label>
            <input
              value={form.name}
              disabled={!canEdit}
              onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
              className={cn(
                'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-transparent focus:ring-2 focus:ring-blue-500',
                !canEdit && 'cursor-not-allowed bg-slate-100'
              )}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700">Target Team *</label>
            <select
              value={form.teamId}
              disabled={!canEdit}
              onChange={(event) => setForm((prev) => ({ ...prev, teamId: event.target.value }))}
              className={cn(
                'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-transparent focus:ring-2 focus:ring-blue-500',
                !canEdit && 'cursor-not-allowed bg-slate-100'
              )}
            >
              <option value="">Select team</option>
              {teams.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700">Priority Order</label>
            <input
              type="number"
              min={1}
              value={form.priority}
              disabled={!canEdit}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, priority: Number(event.target.value) || 1 }))
              }
              className={cn(
                'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-transparent focus:ring-2 focus:ring-blue-500',
                !canEdit && 'cursor-not-allowed bg-slate-100'
              )}
            />
          </div>
          <div className="flex items-end">
            <div className="flex items-center gap-2">
              <ToggleSwitch
                checked={form.isActive}
                disabled={!canEdit}
                onChange={(next) => setForm((prev) => ({ ...prev, isActive: next }))}
              />
              <span className="text-sm text-slate-700">Rule enabled</span>
            </div>
          </div>
        </div>

        <div>
          <p className="mb-1 text-xs font-medium text-slate-700">Keywords (subject contains)</p>
          <input
            value={keywordInput}
            disabled={!canEdit}
            onChange={(event) => setKeywordInput(event.target.value)}
            onKeyDown={handleKeywordKeyDown}
            placeholder="Type keyword and press Enter"
            className={cn(
              'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-transparent focus:ring-2 focus:ring-blue-500',
              !canEdit && 'cursor-not-allowed bg-slate-100'
            )}
          />
          <div className="mt-2 flex flex-wrap gap-2">
            {form.keywords.map((keyword) => (
              <span
                key={keyword}
                className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs text-slate-700"
              >
                {keyword}
                {canEdit && (
                  <button
                    type="button"
                    onClick={() =>
                      setForm((prev) => ({
                        ...prev,
                        keywords: prev.keywords.filter((item) => item !== keyword)
                      }))
                    }
                    className="rounded px-1 text-slate-500 hover:bg-slate-200"
                  >
                    x
                  </button>
                )}
              </span>
            ))}
          </div>
        </div>
      </div>
    </ModalShell>
  );
}

function RoutingSection({ teams, canEdit }: { teams: TeamRef[]; canEdit: boolean }) {
  const toast = useToast();
  const [rules, setRules] = useState<RoutingRule[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [editorRule, setEditorRule] = useState<RoutingEditorState | null>(null);
  const [showEditor, setShowEditor] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<RoutingRule | null>(null);

  const teamNameById = useMemo(() => new Map(teams.map((team) => [team.id, team.name])), [teams]);

  const loadRules = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetchRoutingRules();
      setRules(response.data);
    } catch (loadError) {
      setError(getErrorMessage(loadError, 'Unable to load routing rules.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadRules();
  }, [loadRules]);

  const filteredRules = useMemo(() => {
    const query = search.trim().toLowerCase();
    const sorted = [...rules].sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name));
    if (!query) return sorted;
    return sorted.filter((rule) => {
      const teamName = teamNameById.get(rule.teamId) ?? '';
      return (
        rule.name.toLowerCase().includes(query) ||
        teamName.toLowerCase().includes(query) ||
        rule.keywords.some((keyword) => keyword.toLowerCase().includes(query))
      );
    });
  }, [rules, search, teamNameById]);

  async function saveRule(next: RoutingEditorState) {
    if (next.id) {
      const updated = await updateRoutingRule(next.id, {
        name: next.name.trim(),
        keywords: next.keywords,
        teamId: next.teamId,
        priority: next.priority,
        isActive: next.isActive
      });
      setRules((prev) => prev.map((rule) => (rule.id === updated.id ? updated : rule)));
      toast.success('Routing rule updated.');
    } else {
      const created = await createRoutingRule({
        name: next.name.trim(),
        keywords: next.keywords,
        teamId: next.teamId,
        priority: next.priority,
        isActive: next.isActive
      });
      setRules((prev) => [...prev, created]);
      toast.success('Routing rule created.');
    }
    setShowEditor(false);
    setEditorRule(null);
  }

  async function deleteRule() {
    if (!deleteTarget) return;
    await deleteRoutingRule(deleteTarget.id);
    setRules((prev) => prev.filter((rule) => rule.id !== deleteTarget.id));
    setDeleteTarget(null);
    toast.success('Routing rule deleted.');
  }

  async function toggleRule(rule: RoutingRule) {
    const updated = await updateRoutingRule(rule.id, { isActive: !rule.isActive });
    setRules((prev) => prev.map((item) => (item.id === rule.id ? updated : item)));
    toast.success(updated.isActive ? 'Rule enabled.' : 'Rule disabled.');
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-600">
          Rules are evaluated in priority order. Current backend rule format supports keyword-based conditions.
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void loadRules()}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Refresh
          </button>
          {canEdit && (
            <button
              type="button"
              onClick={() => {
                setEditorRule(null);
                setShowEditor(true);
              }}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              <Plus className="h-4 w-4" />
              <span>New Rule</span>
            </button>
          )}
        </div>
      </div>

      <div className="relative max-w-sm">
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search routing rules..."
          className="w-full rounded-lg border border-slate-300 pl-9 pr-3 py-2 text-sm focus:border-transparent focus:ring-2 focus:ring-blue-500"
        />
        <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="space-y-3">
        {loading && (
          <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-500">
            Loading routing rules...
          </div>
        )}

        {!loading && filteredRules.length === 0 && (
          <div className="rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">
            No routing rules found.
          </div>
        )}

        {!loading &&
          filteredRules.map((rule, index) => (
            <div key={rule.id} className={cn('rounded-xl border border-slate-200 bg-white p-4', !rule.isActive && 'opacity-70')}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <div className="flex flex-col items-center pt-0.5">
                    <GripHorizontal className="h-4 w-4 text-slate-400" />
                    <span className="mt-1 text-xs text-slate-400">#{index + 1}</span>
                  </div>

                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold text-slate-900">{rule.name}</p>
                      {!rule.isActive && (
                        <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">
                          Disabled
                        </span>
                      )}
                    </div>

                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <span className="text-xs font-medium text-slate-400">IF</span>
                      {rule.keywords.map((keyword) => (
                        <span key={`${rule.id}-${keyword}`} className="rounded-md bg-slate-100 px-2 py-1 text-xs text-slate-700">
                          subject contains "{keyword}"
                        </span>
                      ))}
                    </div>

                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <span className="text-xs font-medium text-blue-500">THEN</span>
                      <span className="rounded-md bg-blue-100 px-2 py-1 text-xs font-medium text-blue-700">
                        assign team: {teamNameById.get(rule.teamId) ?? 'Unknown'}
                      </span>
                      <span className="rounded-md bg-blue-100 px-2 py-1 text-xs font-medium text-blue-700">
                        priority order: {rule.priority}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {canEdit && (
                    <>
                      <ToggleSwitch checked={rule.isActive} onChange={() => void toggleRule(rule)} />
                      <button
                        type="button"
                        onClick={() => {
                          setEditorRule({
                            id: rule.id,
                            name: rule.name,
                            teamId: rule.teamId,
                            priority: rule.priority,
                            isActive: rule.isActive,
                            keywords: [...rule.keywords]
                          });
                          setShowEditor(true);
                        }}
                        className="rounded p-1.5 text-slate-400 hover:bg-blue-50 hover:text-blue-600"
                      >
                        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleteTarget(rule)}
                        className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          ))}
      </div>

      <TodoCard title="Backend TODO (Routing)" items={ROUTING_BACKEND_TODOS} />

      {showEditor && (
        <RoutingRuleModal
          rule={editorRule}
          teams={teams}
          canEdit={canEdit}
          onClose={() => {
            setShowEditor(false);
            setEditorRule(null);
          }}
          onSave={saveRule}
        />
      )}

      {deleteTarget && (
        <ConfirmModal
          title="Delete Routing Rule"
          body={`Delete "${deleteTarget.name}"?`}
          onConfirm={() => void deleteRule()}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}

// -------------------------------------
// Automation section
// -------------------------------------

type AutomationConditionRow = {
  field: string;
  operator: string;
  value: string;
};

type AutomationActionRow = {
  type: string;
  value: string;
};

type AutomationEditorState = {
  id?: string;
  name: string;
  description: string;
  trigger: string;
  triggerDetail: string;
  conditions: AutomationConditionRow[];
  actions: AutomationActionRow[];
  isActive: boolean;
  priority: number;
  teamId: string;
};

const AUTOMATION_TRIGGER_OPTIONS = [
  { value: 'TICKET_CREATED', label: 'Ticket Created' },
  { value: 'TICKET_UPDATED', label: 'Ticket Updated' },
  { value: 'STATUS_CHANGED', label: 'Status Changed' },
  { value: 'SLA_BREACHED', label: 'SLA Breach' },
  { value: 'TIME_BASED', label: 'Time-based' }
] as const;

const AUTOMATION_FIELD_OPTIONS = [
  'subject',
  'status',
  'priority',
  'channel',
  'requester_tag',
  'last_reply_age',
  'team'
];

const AUTOMATION_OPERATOR_OPTIONS = ['is', 'is_not', 'contains', 'gt', 'lt'];

const AUTOMATION_ACTION_OPTIONS = [
  { value: 'set_status', label: 'Set Status' },
  { value: 'assign_team', label: 'Assign Team' },
  { value: 'assign_user', label: 'Assign User' },
  { value: 'add_tag', label: 'Add Tag' },
  { value: 'send_reply', label: 'Send Reply' },
  { value: 'notify_role', label: 'Notify Role' },
  { value: 'set_priority', label: 'Set Priority' }
] as const;

const AUTOMATION_BACKEND_TODOS = [
  'Rule trigger detail text is currently stored in UI metadata only (backend model has no dedicated field).',
  'Automation condition groups (AND/OR trees) are flattened in this UI until advanced condition builder endpoints are available.'
];

function stringifyUnknown(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return '';
  }
}

function flattenAutomationConditions(
  conditions: AutomationCondition[] | undefined
): AutomationConditionRow[] {
  if (!conditions || conditions.length === 0) return [];
  const rows: AutomationConditionRow[] = [];

  const visit = (condition: AutomationCondition) => {
    if (Array.isArray(condition.and) && condition.and.length > 0) {
      condition.and.forEach(visit);
    }
    if (Array.isArray(condition.or) && condition.or.length > 0) {
      condition.or.forEach(visit);
    }
    if (condition.field || condition.operator || condition.value !== undefined) {
      rows.push({
        field: condition.field ?? '',
        operator: condition.operator ?? 'is',
        value: stringifyUnknown(condition.value)
      });
    }
  };

  conditions.forEach(visit);
  return rows;
}

function automationConditionsToApi(conditions: AutomationConditionRow[]): AutomationCondition[] {
  return conditions
    .map((condition) => ({
      field: condition.field.trim(),
      operator: condition.operator.trim(),
      value: condition.value.trim()
    }))
    .filter((condition) => condition.field && condition.operator);
}

function automationActionValueFromApi(action: AutomationAction): string {
  if (typeof action.teamId === 'string') return action.teamId;
  if (typeof action.userId === 'string') return action.userId;
  if (typeof action.priority === 'string') return action.priority;
  if (typeof action.status === 'string') return action.status;
  if (typeof action.body === 'string') return action.body;
  return '';
}

function automationActionsFromApi(actions: AutomationAction[] | undefined): AutomationActionRow[] {
  if (!actions || actions.length === 0) return [];
  return actions.map((action) => ({
    type: action.type || '',
    value: automationActionValueFromApi(action)
  }));
}

function automationActionsToApi(actions: AutomationActionRow[]): AutomationAction[] {
  return actions
    .map((action) => {
      const type = action.type.trim();
      if (!type) return null;
      const value = action.value.trim();
      const lower = type.toLowerCase();
      const mapped: AutomationAction = { type };
      if (value.length === 0) return mapped;

      if (lower === 'assign_team') mapped.teamId = value;
      else if (lower === 'assign_user') mapped.userId = value;
      else if (lower === 'set_priority') mapped.priority = value;
      else if (lower === 'set_status') mapped.status = value;
      else mapped.body = value;
      return mapped;
    })
    .filter((action): action is AutomationAction => Boolean(action));
}

function automationTriggerLabel(trigger: string): string {
  return (
    AUTOMATION_TRIGGER_OPTIONS.find((item) => item.value === trigger)?.label ??
    titleCase(trigger)
  );
}

function automationTriggerVisual(trigger: string): { className: string; iconPath: string } {
  const normalized = trigger.toUpperCase();
  if (normalized.includes('SLA') || normalized.includes('BREACH')) {
    return {
      className: 'bg-red-100 text-red-600',
      iconPath:
        'M12 9v2m0 4h.01M10.293 4.293a1 1 0 011.414 0L21 13.586V19a2 2 0 01-2 2H5a2 2 0 01-2-2v-5.414l9.293-9.293z'
    };
  }
  if (normalized.includes('TIME')) {
    return {
      className: 'bg-purple-100 text-purple-600',
      iconPath: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z'
    };
  }
  return {
    className: 'bg-green-100 text-green-600',
    iconPath: 'M13 10V3L4 14h7v7l9-11h-7z'
  };
}

function automationActionLabel(actionType: string): string {
  return (
    AUTOMATION_ACTION_OPTIONS.find((item) => item.value === actionType)?.label ??
    titleCase(actionType)
  );
}

function summarizeAutomationAction(
  action: AutomationActionRow,
  teamNameById: Map<string, string>,
  userNameById: Map<string, string>
): string {
  if (!action.type) return 'Action';
  const label = automationActionLabel(action.type);
  if (!action.value) return label;
  const lower = action.type.toLowerCase();
  if (lower === 'assign_team') return `${label}: ${teamNameById.get(action.value) ?? action.value}`;
  if (lower === 'assign_user') return `${label}: ${userNameById.get(action.value) ?? action.value}`;
  return `${label}: ${action.value}`;
}

function createEmptyAutomationRule(): AutomationEditorState {
  return {
    name: '',
    description: '',
    trigger: AUTOMATION_TRIGGER_OPTIONS[0].value,
    triggerDetail: '',
    conditions: [{ field: 'subject', operator: 'contains', value: '' }],
    actions: [{ type: 'assign_team', value: '' }],
    isActive: true,
    priority: 100,
    teamId: ''
  };
}

function AutomationRuleModal({
  rule,
  teams,
  canEdit,
  onSave,
  onClose
}: {
  rule: AutomationEditorState | null;
  teams: TeamRef[];
  canEdit: boolean;
  onSave: (next: AutomationEditorState) => Promise<void>;
  onClose: () => void;
}) {
  const isNew = !rule?.id;
  const [form, setForm] = useState<AutomationEditorState>(rule ?? createEmptyAutomationRule());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function addCondition() {
    setForm((prev) => ({
      ...prev,
      conditions: [...prev.conditions, { field: 'subject', operator: 'contains', value: '' }]
    }));
  }

  function updateCondition(index: number, key: keyof AutomationConditionRow, value: string) {
    setForm((prev) => ({
      ...prev,
      conditions: prev.conditions.map((condition, cursor) =>
        cursor === index ? { ...condition, [key]: value } : condition
      )
    }));
  }

  function removeCondition(index: number) {
    setForm((prev) => ({
      ...prev,
      conditions: prev.conditions.filter((_, cursor) => cursor !== index)
    }));
  }

  function addAction() {
    setForm((prev) => ({
      ...prev,
      actions: [...prev.actions, { type: 'set_status', value: '' }]
    }));
  }

  function updateAction(index: number, key: keyof AutomationActionRow, value: string) {
    setForm((prev) => ({
      ...prev,
      actions: prev.actions.map((action, cursor) =>
        cursor === index ? { ...action, [key]: value } : action
      )
    }));
  }

  function removeAction(index: number) {
    setForm((prev) => ({
      ...prev,
      actions: prev.actions.filter((_, cursor) => cursor !== index)
    }));
  }

  async function submit() {
    if (!canEdit) return;
    if (!form.name.trim()) {
      setError('Automation name is required.');
      return;
    }
    if (form.actions.length === 0 || form.actions.every((action) => !action.type.trim())) {
      setError('Add at least one action.');
      return;
    }
    setError(null);
    setSaving(true);
    try {
      await onSave(form);
    } finally {
      setSaving(false);
    }
  }

  return (
    <ModalShell
      title={isNew ? 'Create Automation' : 'Edit Automation'}
      subtitle="Set trigger, conditions and actions"
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-white"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!canEdit || saving}
            onClick={() => void submit()}
            className={cn(
              'rounded-lg px-4 py-2 text-sm font-medium text-white',
              !canEdit || saving ? 'cursor-not-allowed bg-slate-300' : 'bg-blue-600 hover:bg-blue-700'
            )}
          >
            {saving ? 'Saving...' : isNew ? 'Create Automation' : 'Save Changes'}
          </button>
        </div>
      }
    >
      <div className="space-y-5">
        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700">Automation Name *</label>
            <input
              value={form.name}
              disabled={!canEdit}
              onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
              className={cn(
                'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-transparent focus:ring-2 focus:ring-blue-500',
                !canEdit && 'cursor-not-allowed bg-slate-100'
              )}
            />
          </div>
          <div className="flex items-end">
            <div className="mb-1 flex items-center gap-2">
              <ToggleSwitch
                checked={form.isActive}
                disabled={!canEdit}
                onChange={(next) => setForm((prev) => ({ ...prev, isActive: next }))}
              />
              <span className="text-sm text-slate-700">Enabled</span>
            </div>
          </div>
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-slate-700">Description</label>
          <input
            value={form.description}
            disabled={!canEdit}
            onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))}
            className={cn(
              'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-transparent focus:ring-2 focus:ring-blue-500',
              !canEdit && 'cursor-not-allowed bg-slate-100'
            )}
            placeholder="Optional description..."
          />
        </div>

        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <p className="mb-2 text-xs font-semibold text-amber-800">Trigger</p>
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">When</label>
              <select
                value={form.trigger}
                disabled={!canEdit}
                onChange={(event) => setForm((prev) => ({ ...prev, trigger: event.target.value }))}
                className={cn(
                  'w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm focus:border-transparent focus:ring-2 focus:ring-blue-500',
                  !canEdit && 'cursor-not-allowed bg-slate-100'
                )}
              >
                {AUTOMATION_TRIGGER_OPTIONS.map((trigger) => (
                  <option key={trigger.value} value={trigger.value}>
                    {trigger.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">Details (UI)</label>
              <input
                value={form.triggerDetail}
                disabled={!canEdit}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, triggerDetail: event.target.value }))
                }
                className={cn(
                  'w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm focus:border-transparent focus:ring-2 focus:ring-blue-500',
                  !canEdit && 'cursor-not-allowed bg-slate-100'
                )}
                placeholder="e.g. 24h after status=resolved"
              />
            </div>
          </div>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-semibold text-slate-800">
              Conditions <span className="text-xs font-normal text-slate-400">(optional)</span>
            </p>
          </div>
          <div className="space-y-2">
            {form.conditions.map((condition, index) => (
              <div
                key={`condition-${index}`}
                className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2.5"
              >
                <select
                  value={condition.field}
                  disabled={!canEdit}
                  onChange={(event) => updateCondition(index, 'field', event.target.value)}
                  className={cn(
                    'min-w-[150px] flex-1 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm focus:border-transparent focus:ring-2 focus:ring-blue-500',
                    !canEdit && 'cursor-not-allowed bg-slate-100'
                  )}
                >
                  <option value="">Field...</option>
                  {AUTOMATION_FIELD_OPTIONS.map((field) => (
                    <option key={field} value={field}>
                      {field.replaceAll('_', ' ')}
                    </option>
                  ))}
                </select>
                <select
                  value={condition.operator}
                  disabled={!canEdit}
                  onChange={(event) => updateCondition(index, 'operator', event.target.value)}
                  className={cn(
                    'min-w-[110px] rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm focus:border-transparent focus:ring-2 focus:ring-blue-500',
                    !canEdit && 'cursor-not-allowed bg-slate-100'
                  )}
                >
                  {AUTOMATION_OPERATOR_OPTIONS.map((operator) => (
                    <option key={operator} value={operator}>
                      {operator.replaceAll('_', ' ')}
                    </option>
                  ))}
                </select>
                <input
                  value={condition.value}
                  disabled={!canEdit}
                  onChange={(event) => updateCondition(index, 'value', event.target.value)}
                  className={cn(
                    'min-w-[150px] flex-1 rounded-lg border border-slate-300 px-2 py-1.5 text-sm focus:border-transparent focus:ring-2 focus:ring-blue-500',
                    !canEdit && 'cursor-not-allowed bg-slate-100'
                  )}
                  placeholder="value..."
                />
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => removeCondition(index)}
                    className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            ))}
            {canEdit && (
              <button
                type="button"
                onClick={addCondition}
                className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Add Condition</span>
              </button>
            )}
          </div>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-semibold text-slate-800">Actions</p>
          </div>
          <div className="space-y-2">
            {form.actions.map((action, index) => (
              <div
                key={`action-${index}`}
                className="flex flex-wrap items-center gap-2 rounded-lg border border-green-100 bg-green-50 p-2.5"
              >
                <select
                  value={action.type}
                  disabled={!canEdit}
                  onChange={(event) => updateAction(index, 'type', event.target.value)}
                  className={cn(
                    'min-w-[160px] flex-1 rounded-lg border border-green-200 bg-white px-2 py-1.5 text-sm focus:border-transparent focus:ring-2 focus:ring-blue-500',
                    !canEdit && 'cursor-not-allowed bg-slate-100'
                  )}
                >
                  {AUTOMATION_ACTION_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <input
                  value={action.value}
                  disabled={!canEdit}
                  onChange={(event) => updateAction(index, 'value', event.target.value)}
                  className={cn(
                    'min-w-[150px] flex-1 rounded-lg border border-green-200 bg-white px-2 py-1.5 text-sm focus:border-transparent focus:ring-2 focus:ring-blue-500',
                    !canEdit && 'cursor-not-allowed bg-slate-100'
                  )}
                  placeholder="value..."
                />
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => removeAction(index)}
                    className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            ))}
            {canEdit && (
              <button
                type="button"
                onClick={addAction}
                className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Add Action</span>
              </button>
            )}
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700">Priority order</label>
            <input
              type="number"
              min={1}
              disabled={!canEdit}
              value={form.priority}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, priority: Number(event.target.value) || 1 }))
              }
              className={cn(
                'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-transparent focus:ring-2 focus:ring-blue-500',
                !canEdit && 'cursor-not-allowed bg-slate-100'
              )}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700">Team Scope</label>
            <select
              value={form.teamId}
              disabled={!canEdit}
              onChange={(event) => setForm((prev) => ({ ...prev, teamId: event.target.value }))}
              className={cn(
                'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-transparent focus:ring-2 focus:ring-blue-500',
                !canEdit && 'cursor-not-allowed bg-slate-100'
              )}
            >
              <option value="">All teams</option>
              {teams.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>
    </ModalShell>
  );
}

function AutomationSection({
  teams,
  users,
  canEdit
}: {
  teams: TeamRef[];
  users: UserRef[];
  canEdit: boolean;
}) {
  const toast = useToast();
  const [rules, setRules] = useState<AutomationRule[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [editorRule, setEditorRule] = useState<AutomationEditorState | null>(null);
  const [showEditor, setShowEditor] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<AutomationRule | null>(null);
  const [triggerDetailByRuleId, setTriggerDetailByRuleId] = useState<Record<string, string>>({});
  const [runtimeStats, setRuntimeStats] = useState<
    Record<string, { runCount: number; lastRun: string }>
  >({});

  const teamNameById = useMemo(() => new Map(teams.map((team) => [team.id, team.name])), [teams]);
  const userNameById = useMemo(() => new Map(users.map((user) => [user.id, user.displayName])), [users]);

  const loadRules = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetchAutomationRules();
      const sorted = [...response.data].sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name));
      setRules(sorted);
    } catch (loadError) {
      setError(getErrorMessage(loadError, 'Unable to load automation rules.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadRules();
  }, [loadRules]);

  useEffect(() => {
    let active = true;
    async function loadStats() {
      if (rules.length === 0) {
        if (active) setRuntimeStats({});
        return;
      }
      const entries = await Promise.all(
        rules.map(async (rule) => {
          try {
            const executions = await fetchAutomationRuleExecutions(rule.id, 1, 1);
            const latest = executions.data[0];
            return [
              rule.id,
              {
                runCount: executions.meta.total,
                lastRun: latest ? formatRelativeTime(latest.executedAt) : 'Never'
              }
            ] as const;
          } catch {
            return [rule.id, { runCount: 0, lastRun: 'Unavailable' }] as const;
          }
        })
      );
      if (active) {
        setRuntimeStats(Object.fromEntries(entries));
      }
    }
    void loadStats();
    return () => {
      active = false;
    };
  }, [rules]);

  const filteredRules = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return rules;
    return rules.filter((rule) => {
      const teamName = rule.teamId ? teamNameById.get(rule.teamId) ?? '' : '';
      const conditionText = flattenAutomationConditions(rule.conditions)
        .map((condition) => `${condition.field} ${condition.operator} ${condition.value}`)
        .join(' ');
      const actionText = automationActionsFromApi(rule.actions)
        .map((action) => `${action.type} ${action.value}`)
        .join(' ');
      return (
        rule.name.toLowerCase().includes(query) ||
        automationTriggerLabel(rule.trigger).toLowerCase().includes(query) ||
        teamName.toLowerCase().includes(query) ||
        conditionText.toLowerCase().includes(query) ||
        actionText.toLowerCase().includes(query)
      );
    });
  }, [rules, search, teamNameById]);

  const totalRuns = useMemo(
    () => Object.values(runtimeStats).reduce((acc, item) => acc + item.runCount, 0),
    [runtimeStats]
  );

  async function saveRule(next: AutomationEditorState) {
    const payload = {
      name: next.name.trim(),
      description: next.description.trim() || undefined,
      trigger: next.trigger,
      conditions: automationConditionsToApi(next.conditions),
      actions: automationActionsToApi(next.actions),
      isActive: next.isActive,
      priority: next.priority,
      teamId: next.teamId || undefined
    };

    try {
      if (next.id) {
        const updated = await updateAutomationRule(next.id, payload);
        setRules((prev) =>
          prev
            .map((rule) => (rule.id === updated.id ? updated : rule))
            .sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name))
        );
        setTriggerDetailByRuleId((prev) => ({ ...prev, [updated.id]: next.triggerDetail.trim() }));
        toast.success('Automation updated.');
      } else {
        const created = await createAutomationRule(payload);
        setRules((prev) =>
          [...prev, created].sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name))
        );
        if (next.triggerDetail.trim()) {
          setTriggerDetailByRuleId((prev) => ({ ...prev, [created.id]: next.triggerDetail.trim() }));
        }
        toast.success('Automation created.');
      }
      if (next.triggerDetail.trim()) {
        toast.info('Trigger detail is currently stored as UI metadata only.');
      }
      setShowEditor(false);
      setEditorRule(null);
    } catch (saveError) {
      toast.error(getErrorMessage(saveError, 'Unable to save automation rule.'));
      throw saveError;
    }
  }

  async function deleteRule() {
    if (!deleteTarget) return;
    try {
      await deleteAutomationRule(deleteTarget.id);
      setRules((prev) => prev.filter((rule) => rule.id !== deleteTarget.id));
      setRuntimeStats((prev) => {
        const next = { ...prev };
        delete next[deleteTarget.id];
        return next;
      });
      setTriggerDetailByRuleId((prev) => {
        const next = { ...prev };
        delete next[deleteTarget.id];
        return next;
      });
      setDeleteTarget(null);
      toast.success('Automation deleted.');
    } catch (deleteError) {
      toast.error(getErrorMessage(deleteError, 'Unable to delete automation rule.'));
    }
  }

  async function toggleRule(rule: AutomationRule) {
    try {
      const updated = await updateAutomationRule(rule.id, { isActive: !rule.isActive });
      setRules((prev) => prev.map((item) => (item.id === rule.id ? updated : item)));
      toast.success(updated.isActive ? 'Automation enabled.' : 'Automation disabled.');
    } catch (toggleError) {
      toast.error(getErrorMessage(toggleError, 'Unable to update automation state.'));
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-600">
          Automations execute based on trigger and conditions. Runtime counts are loaded from execution history.
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void loadRules()}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Refresh
          </button>
          {canEdit && (
            <button
              type="button"
              onClick={() => {
                setEditorRule(null);
                setShowEditor(true);
              }}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              <Plus className="h-4 w-4" />
              <span>New Automation</span>
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Total Automations', value: rules.length, className: 'text-blue-600' },
          {
            label: 'Active',
            value: rules.filter((rule) => rule.isActive).length,
            className: 'text-green-600'
          },
          { label: 'Total Runs (30d)', value: totalRuns, className: 'text-purple-600' }
        ].map((kpi) => (
          <div key={kpi.label} className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-xs text-slate-500">{kpi.label}</p>
            <p className={cn('mt-1 text-2xl font-bold', kpi.className)}>{kpi.value}</p>
          </div>
        ))}
      </div>

      <div className="relative max-w-sm">
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search automations..."
          className="w-full rounded-lg border border-slate-300 pl-9 pr-3 py-2 text-sm focus:border-transparent focus:ring-2 focus:ring-blue-500"
        />
        <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="space-y-3">
        {loading && (
          <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-500">
            Loading automation rules...
          </div>
        )}

        {!loading && filteredRules.length === 0 && (
          <div className="rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">
            No automation rules found.
          </div>
        )}

        {!loading &&
          filteredRules.map((rule) => {
            const triggerVisual = automationTriggerVisual(rule.trigger);
            const actionRows = automationActionsFromApi(rule.actions);
            const conditionRows = flattenAutomationConditions(rule.conditions);
            const stats = runtimeStats[rule.id] ?? { runCount: 0, lastRun: 'Never' };
            return (
              <div
                key={rule.id}
                className={cn(
                  'rounded-xl border border-slate-200 bg-white p-5',
                  !rule.isActive && 'opacity-70'
                )}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex min-w-0 flex-1 items-start gap-4">
                    <div
                      className={cn(
                        'flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl',
                        triggerVisual.className
                      )}
                    >
                      <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d={triggerVisual.iconPath}
                        />
                      </svg>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-semibold text-slate-900">{rule.name}</p>
                        {!rule.isActive && (
                          <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">
                            Disabled
                          </span>
                        )}
                      </div>

                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <span className="rounded-md bg-amber-100 px-2 py-1 text-xs font-medium text-amber-700">
                          Trigger: {automationTriggerLabel(rule.trigger)}
                        </span>
                        {triggerDetailByRuleId[rule.id] && (
                          <span className="text-xs italic text-slate-500">
                            "{triggerDetailByRuleId[rule.id]}"
                          </span>
                        )}
                      </div>

                      {conditionRows.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          <span className="mt-0.5 text-xs text-slate-400">IF</span>
                          {conditionRows.map((condition, index) => (
                            <span
                              key={`${rule.id}-condition-${index}`}
                              className="rounded-md bg-slate-100 px-2 py-1 text-xs text-slate-700"
                            >
                              {condition.field || 'field'} {condition.operator || 'is'} "{condition.value}"
                            </span>
                          ))}
                        </div>
                      )}

                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <span className="mt-0.5 text-xs text-green-600">THEN</span>
                        {actionRows.map((action, index) => (
                          <span
                            key={`${rule.id}-action-${index}`}
                            className="rounded-md bg-green-100 px-2 py-1 text-xs font-medium text-green-700"
                          >
                            {summarizeAutomationAction(action, teamNameById, userNameById)}
                          </span>
                        ))}
                      </div>

                      <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-slate-500">
                        <span>
                          Team: {rule.teamId ? teamNameById.get(rule.teamId) ?? rule.teamId : 'All teams'}
                        </span>
                        <span>Priority: {rule.priority}</span>
                        <span>
                          Runs: <span className="font-semibold text-slate-700">{stats.runCount}</span>
                        </span>
                        <span>Last: {stats.lastRun}</span>
                      </div>
                    </div>
                  </div>

                  {canEdit && (
                    <div className="flex items-center gap-2">
                      <ToggleSwitch checked={rule.isActive} onChange={() => void toggleRule(rule)} />
                      <button
                        type="button"
                        onClick={() => {
                          setEditorRule({
                            id: rule.id,
                            name: rule.name,
                            description: rule.description ?? '',
                            trigger: rule.trigger,
                            triggerDetail: triggerDetailByRuleId[rule.id] ?? '',
                            conditions:
                              flattenAutomationConditions(rule.conditions).length > 0
                                ? flattenAutomationConditions(rule.conditions)
                                : [{ field: 'subject', operator: 'contains', value: '' }],
                            actions:
                              automationActionsFromApi(rule.actions).length > 0
                                ? automationActionsFromApi(rule.actions)
                                : [{ type: 'assign_team', value: '' }],
                            isActive: rule.isActive,
                            priority: rule.priority,
                            teamId: rule.teamId ?? ''
                          });
                          setShowEditor(true);
                        }}
                        className="rounded p-1.5 text-slate-400 hover:bg-blue-50 hover:text-blue-600"
                      >
                        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleteTarget(rule)}
                        className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
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

      <TodoCard title="Backend TODO (Automation)" items={AUTOMATION_BACKEND_TODOS} />

      {showEditor && (
        <AutomationRuleModal
          rule={editorRule}
          teams={teams}
          canEdit={canEdit}
          onClose={() => {
            setShowEditor(false);
            setEditorRule(null);
          }}
          onSave={saveRule}
        />
      )}

      {deleteTarget && (
        <ConfirmModal
          title="Delete Automation"
          body={`Delete "${deleteTarget.name}"?`}
          onConfirm={() => void deleteRule()}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}

// -------------------------------------
// Custom fields section
// -------------------------------------

type CustomFieldUiMeta = {
  showList: boolean;
  showDetail: boolean;
  placeholder: string;
};

type CustomFieldEditorState = {
  id?: string;
  label: string;
  fieldType: string;
  required: boolean;
  showList: boolean;
  showDetail: boolean;
  teamId: string;
  placeholder: string;
  options: string[];
  sortOrder: number;
};

const CUSTOM_FIELD_TYPE_OPTIONS = [
  { value: 'TEXT', label: 'Short Text', icon: 'M4 6h16M4 10h16M4 14h8' },
  { value: 'TEXTAREA', label: 'Long Text', icon: 'M4 6h16M4 10h16M4 14h16M4 18h8' },
  { value: 'NUMBER', label: 'Number', icon: 'M7 20l4-16m2 16l4-16M6 9h14M4 15h14' },
  { value: 'DROPDOWN', label: 'Dropdown', icon: 'M19 9l-7 7-7-7' },
  { value: 'MULTISELECT', label: 'Multi-select', icon: 'M5 13l4 4L19 7' },
  { value: 'DATE', label: 'Date', icon: 'M8 7V3m8 4V3m-9 8h10' },
  { value: 'CHECKBOX', label: 'Checkbox', icon: 'M5 13l4 4L19 7' },
  { value: 'USER', label: 'User Picker', icon: 'M16 7a4 4 0 11-8 0 4 4 0 018 0z' }
] as const;

const CUSTOM_FIELDS_BACKEND_TODOS = [
  'List/detail visibility and placeholder settings are local UI metadata only.',
  'Multi-team scope assignment for a single field is not yet supported by backend (current model is single teamId or global).'
];

function parseCustomFieldOptions(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      if (item && typeof item === 'object' && 'value' in item) {
        return String((item as { value?: unknown }).value ?? '');
      }
      return String(item ?? '');
    })
    .map((option) => option.trim())
    .filter((option) => option.length > 0);
}

function customFieldTypeLabel(fieldType: string): string {
  return CUSTOM_FIELD_TYPE_OPTIONS.find((item) => item.value === fieldType)?.label ?? fieldType;
}

function createCustomFieldEditorState(
  field: CustomFieldRecord | null,
  meta?: CustomFieldUiMeta
): CustomFieldEditorState {
  if (!field) {
    return {
      label: '',
      fieldType: 'TEXT',
      required: false,
      showList: false,
      showDetail: true,
      teamId: '',
      placeholder: '',
      options: [],
      sortOrder: 0
    };
  }

  return {
    id: field.id,
    label: field.name,
    fieldType: field.fieldType,
    required: field.isRequired,
    showList: meta?.showList ?? false,
    showDetail: meta?.showDetail ?? true,
    teamId: field.teamId ?? '',
    placeholder: meta?.placeholder ?? '',
    options: parseCustomFieldOptions(field.options),
    sortOrder: field.sortOrder
  };
}

function CustomFieldModal({
  field,
  teams,
  canEdit,
  onSave,
  onClose
}: {
  field: CustomFieldEditorState | null;
  teams: TeamRef[];
  canEdit: boolean;
  onSave: (next: CustomFieldEditorState) => Promise<void>;
  onClose: () => void;
}) {
  const isNew = !field?.id;
  const [form, setForm] = useState<CustomFieldEditorState>(
    field ?? createCustomFieldEditorState(null)
  );
  const [optionInput, setOptionInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const needsOptions = form.fieldType === 'DROPDOWN' || form.fieldType === 'MULTISELECT';

  function addOption(raw: string) {
    const normalized = raw.trim();
    if (!normalized) return;
    setForm((prev) => ({
      ...prev,
      options: prev.options.includes(normalized) ? prev.options : [...prev.options, normalized]
    }));
  }

  function removeOption(index: number) {
    setForm((prev) => ({ ...prev, options: prev.options.filter((_, cursor) => cursor !== index) }));
  }

  async function submit() {
    if (!canEdit) return;
    if (!form.label.trim()) {
      setError('Field label is required.');
      return;
    }
    if (needsOptions && form.options.length === 0) {
      setError('Add at least one option for dropdown or multi-select fields.');
      return;
    }
    setError(null);
    setSaving(true);
    try {
      await onSave(form);
    } finally {
      setSaving(false);
    }
  }

  return (
    <ModalShell
      title={isNew ? 'Create Custom Field' : 'Edit Custom Field'}
      subtitle="Configure field type and visibility."
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-white"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!canEdit || saving}
            onClick={() => void submit()}
            className={cn(
              'rounded-lg px-4 py-2 text-sm font-medium text-white',
              !canEdit || saving ? 'cursor-not-allowed bg-slate-300' : 'bg-blue-600 hover:bg-blue-700'
            )}
          >
            {saving ? 'Saving...' : isNew ? 'Create Field' : 'Save Changes'}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        <div>
          <label className="mb-1 block text-xs font-medium text-slate-700">Field Label *</label>
          <input
            value={form.label}
            disabled={!canEdit}
            onChange={(event) => setForm((prev) => ({ ...prev, label: event.target.value }))}
            className={cn(
              'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-transparent focus:ring-2 focus:ring-blue-500',
              !canEdit && 'cursor-not-allowed bg-slate-100'
            )}
          />
        </div>

        <div>
          <label className="mb-2 block text-xs font-medium text-slate-700">Field Type</label>
          <div className="grid grid-cols-3 gap-2">
            {CUSTOM_FIELD_TYPE_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                disabled={!canEdit}
                onClick={() =>
                  setForm((prev) => ({
                    ...prev,
                    fieldType: option.value,
                    options:
                      option.value === 'DROPDOWN' || option.value === 'MULTISELECT'
                        ? prev.options
                        : []
                  }))
                }
                className={cn(
                  'rounded-lg border p-3 text-xs font-medium',
                  form.fieldType === option.value
                    ? 'border-blue-500 bg-blue-50 text-blue-700'
                    : 'border-slate-200 text-slate-600 hover:border-slate-300',
                  !canEdit && 'cursor-not-allowed bg-slate-100 text-slate-400'
                )}
              >
                <svg className="mx-auto mb-1 h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={option.icon} />
                </svg>
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-slate-700">Placeholder (UI)</label>
          <input
            value={form.placeholder}
            disabled={!canEdit}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, placeholder: event.target.value }))
            }
            className={cn(
              'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-transparent focus:ring-2 focus:ring-blue-500',
              !canEdit && 'cursor-not-allowed bg-slate-100'
            )}
            placeholder="Hint shown in the form"
          />
        </div>

        {needsOptions && (
          <div>
            <label className="mb-2 block text-xs font-medium text-slate-700">Options</label>
            <div className="space-y-1.5">
              {form.options.map((option, index) => (
                <div
                  key={`${option}-${index}`}
                  className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5"
                >
                  <span className="text-sm text-slate-700">{option}</span>
                  {canEdit && (
                    <button
                      type="button"
                      onClick={() => removeOption(index)}
                      className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>
            {canEdit && (
              <div className="mt-2 flex items-center gap-2">
                <input
                  value={optionInput}
                  onChange={(event) => setOptionInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      addOption(optionInput);
                      setOptionInput('');
                    }
                  }}
                  className="flex-1 rounded-lg border border-slate-300 px-2 py-1.5 text-sm focus:border-transparent focus:ring-2 focus:ring-blue-500"
                  placeholder="Add option..."
                />
                <button
                  type="button"
                  onClick={() => {
                    addOption(optionInput);
                    setOptionInput('');
                  }}
                  className="rounded-lg bg-slate-100 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-200"
                >
                  Add
                </button>
              </div>
            )}
          </div>
        )}

        <div className="grid gap-2">
          <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 p-3">
            <div>
              <p className="text-sm font-medium text-slate-700">Required</p>
              <p className="text-xs text-slate-500">Must be filled before ticket submission</p>
            </div>
            <ToggleSwitch
              checked={form.required}
              disabled={!canEdit}
              onChange={(next) => setForm((prev) => ({ ...prev, required: next }))}
            />
          </div>
          <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 p-3">
            <div>
              <p className="text-sm font-medium text-slate-700">Show in Ticket List (UI)</p>
              <p className="text-xs text-slate-500">Displayed as table column in tickets view</p>
            </div>
            <ToggleSwitch
              checked={form.showList}
              disabled={!canEdit}
              onChange={(next) => setForm((prev) => ({ ...prev, showList: next }))}
            />
          </div>
          <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 p-3">
            <div>
              <p className="text-sm font-medium text-slate-700">Show in Ticket Detail (UI)</p>
              <p className="text-xs text-slate-500">Displayed inside ticket detail sidebar</p>
            </div>
            <ToggleSwitch
              checked={form.showDetail}
              disabled={!canEdit}
              onChange={(next) => setForm((prev) => ({ ...prev, showDetail: next }))}
            />
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700">Team Scope</label>
            <select
              value={form.teamId}
              disabled={!canEdit}
              onChange={(event) => setForm((prev) => ({ ...prev, teamId: event.target.value }))}
              className={cn(
                'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-transparent focus:ring-2 focus:ring-blue-500',
                !canEdit && 'cursor-not-allowed bg-slate-100'
              )}
            >
              <option value="">All teams</option>
              {teams.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700">Sort Order</label>
            <input
              type="number"
              min={0}
              disabled={!canEdit}
              value={form.sortOrder}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, sortOrder: Number(event.target.value) || 0 }))
              }
              className={cn(
                'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-transparent focus:ring-2 focus:ring-blue-500',
                !canEdit && 'cursor-not-allowed bg-slate-100'
              )}
            />
          </div>
        </div>
      </div>
    </ModalShell>
  );
}

function CustomFieldsSection({ teams, canEdit }: { teams: TeamRef[]; canEdit: boolean }) {
  const toast = useToast();
  const [fields, setFields] = useState<CustomFieldRecord[]>([]);
  const [metaByFieldId, setMetaByFieldId] = useState<Record<string, CustomFieldUiMeta>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [editorField, setEditorField] = useState<CustomFieldEditorState | null>(null);
  const [showEditor, setShowEditor] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<CustomFieldRecord | null>(null);

  const teamNameById = useMemo(() => new Map(teams.map((team) => [team.id, team.name])), [teams]);

  const loadFields = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetchCustomFields();
      setFields(response.data);
      setMetaByFieldId((prev) => {
        const next = { ...prev };
        response.data.forEach((field) => {
          if (!next[field.id]) {
            next[field.id] = {
              showList: false,
              showDetail: true,
              placeholder: ''
            };
          }
        });
        return next;
      });
    } catch (loadError) {
      setError(getErrorMessage(loadError, 'Unable to load custom fields.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadFields();
  }, [loadFields]);

  const filteredFields = useMemo(() => {
    const query = search.trim().toLowerCase();
    const sorted = [...fields].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
    if (!query) return sorted;
    return sorted.filter((field) => {
      const teamName = field.teamId ? teamNameById.get(field.teamId) ?? '' : 'all teams';
      return (
        field.name.toLowerCase().includes(query) ||
        field.fieldType.toLowerCase().includes(query) ||
        teamName.toLowerCase().includes(query)
      );
    });
  }, [fields, search, teamNameById]);

  async function saveField(next: CustomFieldEditorState) {
    const payload = {
      name: next.label.trim(),
      fieldType: next.fieldType,
      isRequired: next.required,
      teamId: next.teamId || undefined,
      sortOrder: next.sortOrder,
      options:
        next.fieldType === 'DROPDOWN' || next.fieldType === 'MULTISELECT'
          ? next.options
              .filter((option) => option.trim().length > 0)
              .map((option) => ({ value: option.trim(), label: option.trim() }))
          : undefined
    };

    try {
      if (next.id) {
        const updated = await updateCustomField(next.id, payload);
        setFields((prev) => prev.map((field) => (field.id === updated.id ? updated : field)));
        setMetaByFieldId((prev) => ({
          ...prev,
          [updated.id]: {
            showList: next.showList,
            showDetail: next.showDetail,
            placeholder: next.placeholder
          }
        }));
        toast.success('Custom field updated.');
      } else {
        const created = await createCustomField(payload);
        setFields((prev) => [...prev, created]);
        setMetaByFieldId((prev) => ({
          ...prev,
          [created.id]: {
            showList: next.showList,
            showDetail: next.showDetail,
            placeholder: next.placeholder
          }
        }));
        toast.success('Custom field created.');
      }

      if (next.showList || !next.showDetail || next.placeholder.trim().length > 0) {
        toast.info('Field visibility and placeholder are currently UI-only metadata.');
      }

      setShowEditor(false);
      setEditorField(null);
    } catch (saveError) {
      toast.error(getErrorMessage(saveError, 'Unable to save custom field.'));
      throw saveError;
    }
  }

  async function deleteField() {
    if (!deleteTarget) return;
    try {
      await deleteCustomField(deleteTarget.id);
      setFields((prev) => prev.filter((field) => field.id !== deleteTarget.id));
      setMetaByFieldId((prev) => {
        const next = { ...prev };
        delete next[deleteTarget.id];
        return next;
      });
      setDeleteTarget(null);
      toast.success('Custom field deleted.');
    } catch (deleteError) {
      toast.error(getErrorMessage(deleteError, 'Unable to delete custom field.'));
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-600">
          Custom fields are loaded from backend. Advanced visibility metadata follows the supplied design and is marked where backend is missing.
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void loadFields()}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Refresh
          </button>
          {canEdit && (
            <button
              type="button"
              onClick={() => {
                setEditorField(null);
                setShowEditor(true);
              }}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              <Plus className="h-4 w-4" />
              <span>New Field</span>
            </button>
          )}
        </div>
      </div>

      <div className="relative max-w-sm">
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search custom fields..."
          className="w-full rounded-lg border border-slate-300 pl-9 pr-3 py-2 text-sm focus:border-transparent focus:ring-2 focus:ring-blue-500"
        />
        <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-200 bg-slate-50">
            <tr>
              {['Field Label', 'Type', 'Required', 'In List', 'In Detail', 'Teams', 'Actions'].map(
                (header) => (
                  <th
                    key={header}
                    className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500"
                  >
                    {header}
                  </th>
                )
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading && (
              <tr>
                <td colSpan={7} className="px-4 py-5 text-sm text-slate-500">
                  Loading custom fields...
                </td>
              </tr>
            )}

            {!loading && filteredFields.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-sm text-slate-500">
                  No custom fields found.
                </td>
              </tr>
            )}

            {!loading &&
              filteredFields.map((field) => {
                const meta = metaByFieldId[field.id] ?? {
                  showList: false,
                  showDetail: true,
                  placeholder: ''
                };
                const options = parseCustomFieldOptions(field.options);

                return (
                  <tr key={field.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-purple-100">
                          <svg className="h-3.5 w-3.5 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d={
                                CUSTOM_FIELD_TYPE_OPTIONS.find((item) => item.value === field.fieldType)?.icon ??
                                'M4 6h16M4 10h16M4 14h8'
                              }
                            />
                          </svg>
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-slate-900">{field.name}</p>
                          {meta.placeholder && (
                            <p className="text-xs text-slate-400">{meta.placeholder}</p>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">
                        {customFieldTypeLabel(field.fieldType)}
                      </span>
                      {(field.fieldType === 'DROPDOWN' || field.fieldType === 'MULTISELECT') &&
                        options.length > 0 && (
                          <p className="mt-0.5 text-xs text-slate-400">{options.length} options</p>
                        )}
                    </td>
                    <td className="px-4 py-3">
                      {field.isRequired ? (
                        <span className="rounded-md bg-red-100 px-2 py-1 text-xs font-medium text-red-700">
                          Required
                        </span>
                      ) : (
                        <span className="text-xs text-slate-400">Optional</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {meta.showList ? (
                        <span className="text-green-600">✓</span>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {meta.showDetail ? (
                        <span className="text-green-600">✓</span>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {field.teamId ? (
                        <span className="rounded-md bg-indigo-100 px-2 py-1 text-xs font-medium text-indigo-700">
                          {teamNameById.get(field.teamId) ?? field.teamId}
                        </span>
                      ) : (
                        <span className="text-xs text-slate-400">All teams</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {canEdit && (
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => {
                              setEditorField(createCustomFieldEditorState(field, metaByFieldId[field.id]));
                              setShowEditor(true);
                            }}
                            className="rounded p-1.5 text-slate-400 hover:bg-blue-50 hover:text-blue-600"
                          >
                            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                            </svg>
                          </button>
                          <button
                            type="button"
                            onClick={() => setDeleteTarget(field)}
                            className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>

      <TodoCard title="Backend TODO (Custom Fields)" items={CUSTOM_FIELDS_BACKEND_TODOS} />

      {showEditor && (
        <CustomFieldModal
          field={editorField}
          teams={teams}
          canEdit={canEdit}
          onSave={saveField}
          onClose={() => {
            setShowEditor(false);
            setEditorField(null);
          }}
        />
      )}

      {deleteTarget && (
        <ConfirmModal
          title="Delete Custom Field"
          body={`Delete "${deleteTarget.name}"? Existing values on tickets may be removed.`}
          onConfirm={() => void deleteField()}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}

// -------------------------------------
// Audit section
// -------------------------------------

type AuditCategoryFilter = 'all' | 'sla' | 'routing' | 'automation' | 'custom_fields';

const AUDIT_CATEGORY_META: Record<
  Exclude<AuditCategoryFilter, 'all'>,
  { label: string; badge: string; iconPath: string; iconBg: string; iconColor: string }
> = {
  sla: {
    label: 'SLA',
    badge: 'bg-blue-100 text-blue-700',
    iconPath:
      'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z',
    iconBg: 'bg-blue-50',
    iconColor: 'text-blue-600'
  },
  routing: {
    label: 'Routing',
    badge: 'bg-green-100 text-green-700',
    iconPath: 'M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4',
    iconBg: 'bg-green-50',
    iconColor: 'text-green-600'
  },
  automation: {
    label: 'Automation',
    badge: 'bg-amber-100 text-amber-700',
    iconPath: 'M13 10V3L4 14h7v7l9-11h-7z',
    iconBg: 'bg-amber-50',
    iconColor: 'text-amber-600'
  },
  custom_fields: {
    label: 'Custom Fields',
    badge: 'bg-purple-100 text-purple-700',
    iconPath:
      'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2',
    iconBg: 'bg-purple-50',
    iconColor: 'text-purple-600'
  }
};

const AUDIT_BACKEND_TODOS = [
  'Audit stream currently reflects ticket-domain events; dedicated settings-domain action types should be added for cleaner category mapping.'
];

function inferAuditCategory(entryType: string): Exclude<AuditCategoryFilter, 'all'> {
  const normalized = entryType.toUpperCase();
  if (normalized.includes('ROUT')) return 'routing';
  if (normalized.includes('AUTO')) return 'automation';
  if (normalized.includes('CUSTOM') || normalized.includes('FIELD')) return 'custom_fields';
  return 'sla';
}

function summarizeAuditPayload(entry: AuditLogEntry): string {
  if (!entry.payload || Object.keys(entry.payload).length === 0) {
    return `Ticket ${entry.ticketDisplayId ?? `#${entry.ticketNumber}`}`;
  }
  const summary = Object.entries(entry.payload)
    .slice(0, 3)
    .map(([key, value]) => `${titleCase(key)}: ${stringifyUnknown(value)}`)
    .join(', ');
  if (summary.length <= 160) return summary;
  return `${summary.slice(0, 157)}...`;
}

function downloadCsvContent(content: string, fileName: string) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  window.URL.revokeObjectURL(url);
}

function AuditSection({ users }: { users: UserRef[] }) {
  const toast = useToast();
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<AuditCategoryFilter>('all');
  const [userFilter, setUserFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [meta, setMeta] = useState({ page: 1, pageSize: 50, total: 0, totalPages: 1 });
  const [exporting, setExporting] = useState(false);

  const loadLogs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetchAuditLog({
        page,
        pageSize: 50,
        userId: userFilter === 'all' ? undefined : userFilter,
        search: search.trim() || undefined
      });
      setLogs(response.data);
      setMeta(response.meta);
    } catch (loadError) {
      setError(getErrorMessage(loadError, 'Unable to load audit logs.'));
    } finally {
      setLoading(false);
    }
  }, [page, userFilter, search]);

  useEffect(() => {
    void loadLogs();
  }, [loadLogs]);

  const filteredLogs = useMemo(() => {
    if (categoryFilter === 'all') return logs;
    return logs.filter((log) => inferAuditCategory(log.type) === categoryFilter);
  }, [logs, categoryFilter]);

  const categoryCounts = useMemo(() => {
    const base: Record<Exclude<AuditCategoryFilter, 'all'>, number> = {
      sla: 0,
      routing: 0,
      automation: 0,
      custom_fields: 0
    };
    logs.forEach((log) => {
      const category = inferAuditCategory(log.type);
      base[category] += 1;
    });
    return base;
  }, [logs]);

  async function exportLogs() {
    setExporting(true);
    try {
      if (categoryFilter === 'all') {
        const csv = await fetchAuditLogExport({
          userId: userFilter === 'all' ? undefined : userFilter,
          search: search.trim() || undefined
        });
        downloadCsvContent(csv, 'audit-log-export.csv');
        toast.success('Audit log exported.');
      } else {
        const rows = [
          ['Timestamp', 'User', 'Category', 'Action', 'Details'],
          ...filteredLogs.map((log) => {
            const category = inferAuditCategory(log.type);
            return [
              log.createdAt,
              log.createdBy?.displayName ?? 'System',
              AUDIT_CATEGORY_META[category].label,
              titleCase(log.type),
              summarizeAuditPayload(log)
            ];
          })
        ];
        const csv = rows
          .map((row) =>
            row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(',')
          )
          .join('\n');
        downloadCsvContent(csv, `audit-log-${categoryFilter}.csv`);
        toast.info('Category-filtered export generated from current UI view.');
      }
    } catch (exportError) {
      toast.error(getErrorMessage(exportError, 'Unable to export audit logs.'));
    } finally {
      setExporting(false);
    }
  }

  const canShowPagination = categoryFilter === 'all' && meta.totalPages > 1;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[220px] flex-1">
          <input
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
            placeholder="Search logs..."
            className="w-full rounded-lg border border-slate-300 pl-9 pr-3 py-2 text-sm focus:border-transparent focus:ring-2 focus:ring-blue-500"
          />
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
        </div>

        <select
          value={userFilter}
          onChange={(event) => {
            setUserFilter(event.target.value);
            setPage(1);
          }}
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-transparent focus:ring-2 focus:ring-blue-500"
        >
          <option value="all">All Users</option>
          {users.map((user) => (
            <option key={user.id} value={user.id}>
              {user.displayName || user.email}
            </option>
          ))}
        </select>

        <button
          type="button"
          onClick={() => {
            setSearch('');
            setUserFilter('all');
            setCategoryFilter('all');
            setPage(1);
          }}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          <Filter className="h-4 w-4" />
          <span>Clear</span>
        </button>

        <button
          type="button"
          disabled={exporting}
          onClick={() => void exportLogs()}
          className={cn(
            'rounded-lg border border-blue-200 px-3 py-2 text-sm font-medium',
            exporting
              ? 'cursor-not-allowed bg-slate-100 text-slate-400'
              : 'bg-white text-blue-600 hover:bg-blue-50'
          )}
        >
          {exporting ? 'Exporting...' : 'Export'}
        </button>

        <span className="ml-auto text-xs text-slate-400">
          {filteredLogs.length} of {logs.length} entries
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {(
          Object.keys(AUDIT_CATEGORY_META) as Array<Exclude<AuditCategoryFilter, 'all'>>
        ).map((category) => {
          const metaInfo = AUDIT_CATEGORY_META[category];
          return (
            <button
              key={category}
              type="button"
              onClick={() => setCategoryFilter((prev) => (prev === category ? 'all' : category))}
              className={cn(
                'flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 text-left',
                categoryFilter === category && 'ring-2 ring-blue-500'
              )}
            >
              <div className={cn('flex h-8 w-8 items-center justify-center rounded-lg', metaInfo.iconBg)}>
                <svg className={cn('h-4 w-4', metaInfo.iconColor)} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={metaInfo.iconPath} />
                </svg>
              </div>
              <div>
                <p className="text-xs text-slate-500">{metaInfo.label}</p>
                <p className="text-sm font-bold text-slate-900">{categoryCounts[category]}</p>
              </div>
            </button>
          );
        })}
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="divide-y divide-slate-100">
          {loading && (
            <div className="px-5 py-6 text-sm text-slate-500">Loading audit logs...</div>
          )}

          {!loading && filteredLogs.length === 0 && (
            <div className="px-5 py-10 text-center text-sm text-slate-500">
              No matching audit entries.
            </div>
          )}

          {!loading &&
            filteredLogs.map((entry) => {
              const category = inferAuditCategory(entry.type);
              const categoryMeta = AUDIT_CATEGORY_META[category];
              const actorName = entry.createdBy?.displayName ?? 'System';
              const initials = actorName
                .split(' ')
                .filter(Boolean)
                .map((token) => token[0])
                .join('')
                .slice(0, 2)
                .toUpperCase();
              return (
                <div key={entry.id} className="px-5 py-4 hover:bg-slate-50">
                  <div className="flex items-start gap-4">
                    <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-slate-400 text-xs font-semibold text-white">
                      {actorName === 'System' ? 'SY' : initials || 'NA'}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-slate-900">
                            {titleCase(entry.type)}
                          </p>
                          <p className="mt-0.5 text-xs text-slate-500">
                            <span className="font-medium text-slate-700">{actorName}</span>
                            <span className="mx-1 text-slate-300">•</span>
                            <span>{formatRelativeTime(entry.createdAt)}</span>
                          </p>
                        </div>
                        <span className={cn('rounded-md px-2 py-1 text-xs font-medium', categoryMeta.badge)}>
                          {categoryMeta.label}
                        </span>
                      </div>

                      <p className="mt-2 text-sm text-slate-600">{summarizeAuditPayload(entry)}</p>

                      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-400">
                        <span className="rounded-md bg-slate-100 px-2 py-1 text-slate-700">
                          Event ID: {entry.id}
                        </span>
                        <span className="rounded-md bg-slate-100 px-2 py-1 text-slate-700">
                          Ticket:{' '}
                          {entry.ticketDisplayId ||
                            (entry.ticketNumber > 0 ? `#${entry.ticketNumber}` : 'N/A')}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
        </div>
      </div>

      {canShowPagination && (
        <div className="flex items-center justify-between text-sm text-slate-500">
          <span>
            Page {meta.page} of {meta.totalPages} ({meta.total} total)
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={meta.page <= 1}
              onClick={() => setPage((prev) => Math.max(1, prev - 1))}
              className="rounded border border-slate-300 px-3 py-1 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Previous
            </button>
            <button
              type="button"
              disabled={meta.page >= meta.totalPages}
              onClick={() => setPage((prev) => Math.min(meta.totalPages, prev + 1))}
              className="rounded border border-slate-300 px-3 py-1 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>
      )}

      <TodoCard title="Backend TODO (Audit)" items={AUDIT_BACKEND_TODOS} />
    </div>
  );
}

// -------------------------------------
// Admin page shell
// -------------------------------------

function roleLabel(role: Role): string {
  if (role === 'TEAM_ADMIN') return 'Team Admin';
  return titleCase(role);
}

function roleBadgeClass(role: Role): string {
  if (role === 'OWNER') return 'bg-purple-100 text-purple-700';
  if (role === 'TEAM_ADMIN' || role === 'ADMIN') return 'bg-blue-100 text-blue-700';
  if (role === 'LEAD') return 'bg-green-100 text-green-700';
  if (role === 'AGENT') return 'bg-amber-100 text-amber-700';
  return 'bg-slate-100 text-slate-600';
}

export function AdminPage({ role }: { role: Role }) {
  const [activeSection, setActiveSection] = useState<SettingsSectionKey>('sla');
  const [teams, setTeams] = useState<TeamRef[]>([]);
  const [users, setUsers] = useState<UserRef[]>([]);
  const [loadingMeta, setLoadingMeta] = useState(false);
  const [metaError, setMetaError] = useState<string | null>(null);

  const canEdit = role === 'TEAM_ADMIN' || role === 'OWNER' || role === 'ADMIN';
  const activeItem = SECTION_ITEMS.find((item) => item.id === activeSection) ?? SECTION_ITEMS[0];

  const loadMeta = useCallback(async () => {
    setLoadingMeta(true);
    setMetaError(null);
    try {
      const [teamsResponse, usersResponse] = await Promise.all([fetchTeams(), fetchUsers()]);
      setTeams(teamsResponse.data);
      setUsers(usersResponse.data);
    } catch (loadError) {
      setMetaError(
        `${getErrorMessage(loadError, 'Unable to load teams/users metadata.')} Falling back to demo-only state where needed.`
      );
      setTeams([]);
      setUsers([]);
    } finally {
      setLoadingMeta(false);
    }
  }, []);

  useEffect(() => {
    void loadMeta();
  }, [loadMeta]);

  function renderSection() {
    if (activeSection === 'sla') {
      return <SlaSection teams={teams} canEdit={canEdit} />;
    }
    if (activeSection === 'routing') {
      return <RoutingSection teams={teams} canEdit={canEdit} />;
    }
    if (activeSection === 'automation') {
      return <AutomationSection teams={teams} users={users} canEdit={canEdit} />;
    }
    if (activeSection === 'fields') {
      return <CustomFieldsSection teams={teams} canEdit={canEdit} />;
    }
    return <AuditSection users={users} />;
  }

  return (
    <section className="mt-8 space-y-6 animate-fade-in">
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600 shadow-sm">
              <Settings2 className="h-5 w-5 text-white" />
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-900">Settings</p>
              <p className="text-xs text-slate-500">Helpdesk configuration and governance</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className={cn('rounded-md px-2 py-1 text-xs font-medium', roleBadgeClass(role))}>
              {roleLabel(role)}
            </span>
            <span
              className={cn(
                'rounded-md px-2 py-1 text-xs font-medium',
                canEdit ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'
              )}
            >
              {canEdit ? 'Editable' : 'Read-only'}
            </span>
            <button
              type="button"
              onClick={() => void loadMeta()}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Refresh Metadata
            </button>
          </div>
        </div>
      </div>

      {metaError && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {metaError}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-12">
        <aside className="lg:col-span-3">
          <div className="sticky top-[88px] overflow-hidden rounded-xl border border-slate-200 bg-white">
            <div className="border-b border-slate-200 px-4 py-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Configuration
              </p>
              <p className="mt-1 text-sm font-semibold text-slate-900">Workspace Settings</p>
              <p className="mt-0.5 text-xs text-slate-500">Manage policies, rules and governance</p>
            </div>
            <nav className="py-2">
              {SECTION_ITEMS.map((item) => {
                const Icon = item.icon;
                const active = item.id === activeSection;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setActiveSection(item.id)}
                    className={cn(
                      'w-full px-4 py-3 text-left transition-colors',
                      active ? 'bg-blue-50 text-blue-700' : 'text-slate-700 hover:bg-slate-50'
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <div
                        className={cn(
                          'flex h-9 w-9 items-center justify-center rounded-lg',
                          active ? 'bg-blue-100 text-blue-600' : 'bg-slate-100 text-slate-500'
                        )}
                      >
                        <Icon className="h-5 w-5" />
                      </div>
                      <div className="min-w-0">
                        <p className={cn('text-sm font-semibold', active ? 'text-blue-700' : 'text-slate-900')}>
                          {item.label}
                        </p>
                        <p className="mt-0.5 truncate text-xs text-slate-500">{item.description}</p>
                      </div>
                    </div>
                  </button>
                );
              })}
            </nav>
            <div className="border-t border-slate-200 bg-slate-50 px-4 py-4">
              <p className="text-sm font-semibold text-slate-800">Governance</p>
              <p className="mt-0.5 text-xs text-slate-500">
                Configuration changes should be tracked in audit logs.
              </p>
              {!canEdit && (
                <p className="mt-2 inline-block rounded-lg border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-700">
                  Read-only role
                </p>
              )}
            </div>
          </div>
        </aside>

        <main className="space-y-5 lg:col-span-9">
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="mb-1 flex items-center gap-2 text-xs text-slate-500">
                  <span>Settings</span>
                  <ChevronRight className="h-3.5 w-3.5" />
                  <span className="font-medium text-slate-700">{activeItem.label}</span>
                </div>
                <p className="text-lg font-bold text-slate-900">{activeItem.label}</p>
                <p className="mt-1 text-sm text-slate-500">{activeItem.description}</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">
                  Workspace: Helpdesk
                </span>
                <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">
                  Teams loaded: {teams.length}
                </span>
                <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">
                  Users loaded: {users.length}
                </span>
              </div>
            </div>
            {loadingMeta && (
              <p className="mt-3 text-xs text-slate-400">Refreshing teams/users metadata...</p>
            )}
          </div>

          {renderSection()}

          <TodoCard title="Global Backend TODO" items={GLOBAL_TODOS} />
        </main>
      </div>
    </section>
  );
}
