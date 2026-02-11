import { useEffect, useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import {
  fetchReportSlaCompliance,
  fetchSlaPolicies,
  resetSlaPolicies,
  updateSlaPolicies,
  type NotificationRecord,
  type SlaComplianceResponse,
  type SlaPolicy,
  type TeamRef
} from '../api/client';
import { TopBar } from '../components/TopBar';
import { useToast } from '../hooks/useToast';
import type { Role } from '../types';

type SlaHeaderProps = {
  title: string;
  subtitle: string;
  currentEmail: string;
  personas: { label: string; email: string }[];
  onEmailChange: (email: string) => void;
  onOpenSearch?: () => void;
  notificationProps?: {
    notifications: NotificationRecord[];
    unreadCount: number;
    loading: boolean;
    hasMore: boolean;
    onLoadMore: () => void;
    onMarkAsRead: (id: string) => void;
    onMarkAllAsRead: () => void;
    onRefresh: () => void;
  };
};

type TabKey = 'policies' | 'overview' | 'business-hours';
type ModalSection = 'targets' | 'teams' | 'escalation';
type PolicySource = 'live' | 'demo';
type NotifyValue = 'agent' | 'lead' | 'manager' | 'owner';
type PriorityKey = 'critical' | 'high' | 'medium' | 'low';

type PolicyTargets = Record<PriorityKey, { firstResponse: number; resolution: number }>;

type PolicyModel = {
  id: string;
  name: string;
  description: string;
  isDefault: boolean;
  enabled: boolean;
  appliedTo: string[];
  targets: PolicyTargets;
  businessHours: boolean;
  escalation: boolean;
  escalationAfter: number;
  breachNotify: NotifyValue[];
  createdAt: string;
  compliance: number;
  source: PolicySource;
  teamId?: string;
};

type LivePolicyMeta = Pick<
  PolicyModel,
  'name' | 'description' | 'isDefault' | 'enabled' | 'businessHours' | 'escalation' | 'escalationAfter' | 'breachNotify'
>;

const PRIORITIES: PriorityKey[] = ['critical', 'high', 'medium', 'low'];
const PRIORITY_META: Record<
  PriorityKey,
  { label: string; color: string; dot: string }
> = {
  critical: { label: 'Critical', color: 'bg-red-100 text-red-700', dot: 'bg-red-500' },
  high: { label: 'High', color: 'bg-orange-100 text-orange-700', dot: 'bg-orange-500' },
  medium: { label: 'Medium', color: 'bg-yellow-100 text-yellow-700', dot: 'bg-yellow-500' },
  low: { label: 'Low', color: 'bg-blue-100 text-blue-700', dot: 'bg-blue-500' }
};

const API_TO_UI_PRIORITY: Record<string, PriorityKey> = {
  P1: 'critical',
  P2: 'high',
  P3: 'medium',
  P4: 'low'
};

const UI_TO_API_PRIORITY: Record<PriorityKey, string> = {
  critical: 'P1',
  high: 'P2',
  medium: 'P3',
  low: 'P4'
};

const NOTIFY_OPTIONS: { value: NotifyValue; label: string }[] = [
  { value: 'agent', label: 'Assigned Agent' },
  { value: 'lead', label: 'Team Lead' },
  { value: 'manager', label: 'Manager' },
  { value: 'owner', label: 'Platform Owner' }
];

const BACKEND_TODO_ITEMS = [
  'Add backend API for named SLA policy CRUD (create/update/delete/default/enabled).',
  'Persist business hours and holiday calendars in backend settings APIs.',
  'Persist escalation + breach notification settings per policy.',
  'Add per-priority SLA compliance reporting endpoint for real Overview charts.'
];

const DEFAULT_TARGETS: PolicyTargets = {
  critical: { firstResponse: 1, resolution: 4 },
  high: { firstResponse: 4, resolution: 8 },
  medium: { firstResponse: 8, resolution: 24 },
  low: { firstResponse: 24, resolution: 72 }
};

const DEFAULT_DEMO_POLICIES: PolicyModel[] = [
  {
    id: 'demo-enterprise',
    name: 'Enterprise SLA',
    description: 'Strict SLA for enterprise/VIP clients',
    isDefault: false,
    enabled: true,
    appliedTo: ['Billing', 'Sales'],
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
    compliance: 97,
    source: 'demo'
  },
  {
    id: 'demo-internal',
    name: 'Internal IT SLA',
    description: 'Relaxed targets for internal IT requests',
    isDefault: false,
    enabled: false,
    appliedTo: [],
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
    compliance: 88,
    source: 'demo'
  }
];

function ymd(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function shortDate(date: Date): string {
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtHours(hours: number): string {
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  if (hours === 1) return '1h';
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  const remainder = hours % 24;
  return remainder === 0 ? `${days}d` : `${days}d ${remainder}h`;
}

function complianceColor(value: number): string {
  if (value >= 95) return 'text-green-600';
  if (value >= 85) return 'text-yellow-600';
  return 'text-red-600';
}

function complianceBg(value: number): string {
  if (value >= 95) return 'bg-green-500';
  if (value >= 85) return 'bg-yellow-500';
  return 'bg-red-500';
}

function cloneTargets(targets: PolicyTargets): PolicyTargets {
  return PRIORITIES.reduce((acc, key) => {
    acc[key] = {
      firstResponse: targets[key].firstResponse,
      resolution: targets[key].resolution
    };
    return acc;
  }, {} as PolicyTargets);
}

function createEmptyPolicy(): PolicyModel {
  return {
    id: '',
    name: '',
    description: '',
    isDefault: false,
    enabled: true,
    appliedTo: [],
    targets: cloneTargets(DEFAULT_TARGETS),
    businessHours: true,
    escalation: true,
    escalationAfter: 80,
    breachNotify: ['agent', 'lead'],
    createdAt: 'Demo',
    compliance: 0,
    source: 'demo'
  };
}

function targetsFromApi(policies: SlaPolicy[]): PolicyTargets {
  const next = cloneTargets(DEFAULT_TARGETS);
  policies.forEach((policy) => {
    const key = API_TO_UI_PRIORITY[policy.priority];
    if (!key) return;
    next[key] = {
      firstResponse: Number(policy.firstResponseHours) || 0,
      resolution: Number(policy.resolutionHours) || 0
    };
  });
  return next;
}

function toApiPolicies(targets: PolicyTargets): Array<Omit<SlaPolicy, 'source'>> {
  return PRIORITIES.map((priority) => ({
    priority: UI_TO_API_PRIORITY[priority],
    firstResponseHours: Number(targets[priority].firstResponse),
    resolutionHours: Number(targets[priority].resolution)
  }));
}

function ToggleSwitch({
  checked,
  onChange,
  disabled
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
        className={`absolute inset-0 rounded-full bg-slate-300 transition-colors peer-checked:bg-blue-600 ${
          disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
        }`}
      />
      <span
        className={`absolute left-[3px] h-[18px] w-[18px] rounded-full bg-white transition-transform peer-checked:translate-x-5 ${
          disabled ? 'cursor-not-allowed' : 'cursor-pointer'
        }`}
      />
    </label>
  );
}

function DeleteModal({
  policy,
  onConfirm,
  onCancel
}: {
  policy: PolicyModel;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-center space-x-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-100">
            <svg className="h-5 w-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.293 4.293a1 1 0 011.414 0L21 13.586V19a2 2 0 01-2 2H5a2 2 0 01-2-2v-5.414l9.293-9.293z" />
            </svg>
          </div>
          <div>
            <h3 className="text-base font-semibold text-slate-900">Delete SLA Policy</h3>
            <p className="text-sm text-slate-500">This action cannot be undone.</p>
          </div>
        </div>
        <p className="mb-6 text-sm text-slate-700">
          Are you sure you want to delete <strong>{policy.name}</strong>?
        </p>
        <div className="flex justify-end space-x-3">
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
  onSave,
  onClose
}: {
  policy: PolicyModel | null;
  teams: TeamRef[];
  canEdit: boolean;
  onSave: (next: PolicyModel) => Promise<void> | void;
  onClose: () => void;
}) {
  const isNew = !policy?.id;
  const [activeSection, setActiveSection] = useState<ModalSection>('targets');
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [form, setForm] = useState<PolicyModel>(() => {
    const base = policy ? { ...policy } : createEmptyPolicy();
    return {
      ...base,
      appliedTo: [...base.appliedTo],
      breachNotify: [...base.breachNotify],
      targets: cloneTargets(base.targets)
    };
  });

  const sections: Array<{ id: ModalSection; label: string }> = [
    { id: 'targets', label: 'SLA Targets' },
    { id: 'teams', label: 'Teams & Scope' },
    { id: 'escalation', label: 'Escalation' }
  ];

  function updateTarget(priority: PriorityKey, field: 'firstResponse' | 'resolution', value: string) {
    const numeric = Number(value) || 0;
    setForm((prev) => ({
      ...prev,
      targets: {
        ...prev.targets,
        [priority]: {
          ...prev.targets[priority],
          [field]: numeric
        }
      }
    }));
  }

  function toggleTeam(teamName: string) {
    setForm((prev) => ({
      ...prev,
      appliedTo: prev.appliedTo.includes(teamName)
        ? prev.appliedTo.filter((item) => item !== teamName)
        : [...prev.appliedTo, teamName]
    }));
  }

  function toggleNotify(value: NotifyValue) {
    setForm((prev) => ({
      ...prev,
      breachNotify: prev.breachNotify.includes(value)
        ? prev.breachNotify.filter((item) => item !== value)
        : [...prev.breachNotify, value]
    }));
  }

  function validate(): boolean {
    const nextErrors: Record<string, string> = {};
    if (!form.name.trim()) {
      nextErrors.name = 'Policy name is required';
    }
    PRIORITIES.forEach((priority) => {
      if (form.targets[priority].firstResponse <= 0) {
        nextErrors[`${priority}_fr`] = 'Must be > 0';
      }
      if (form.targets[priority].resolution <= form.targets[priority].firstResponse) {
        nextErrors[`${priority}_res`] = 'Must be > first response';
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[92vh] w-full max-w-2xl flex-col rounded-lg bg-white shadow-xl">
        <div className="sticky top-0 flex items-center justify-between rounded-t-lg border-b border-slate-200 bg-white px-6 py-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              {isNew ? 'Create SLA Policy' : 'Edit SLA Policy'}
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              {isNew ? 'Configure response and resolution targets' : `Editing "${form.name || 'Untitled policy'}"`}
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 space-y-6 overflow-y-auto p-6">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2 sm:col-span-1">
              <label className="mb-1 block text-sm font-medium text-slate-700">Policy Name *</label>
              <input
                value={form.name}
                disabled={!canEdit}
                onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
                placeholder="e.g. Enterprise SLA"
                className={`w-full rounded-lg border px-3 py-2 text-sm focus:border-transparent focus:ring-2 focus:ring-blue-500 ${
                  errors.name ? 'border-red-400' : 'border-slate-300'
                } ${!canEdit ? 'cursor-not-allowed bg-slate-100' : ''}`}
              />
              {errors.name && <p className="mt-1 text-xs text-red-500">{errors.name}</p>}
            </div>
            <div className="col-span-2 sm:col-span-1">
              <label className="mb-1 block text-sm font-medium text-slate-700">Description</label>
              <input
                value={form.description}
                disabled={!canEdit}
                onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))}
                placeholder="Brief description..."
                className={`w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-transparent focus:ring-2 focus:ring-blue-500 ${
                  !canEdit ? 'cursor-not-allowed bg-slate-100' : ''
                }`}
              />
            </div>
          </div>

          <div className="border-b border-slate-200">
            <div className="flex space-x-6">
              {sections.map((section) => (
                <button
                  key={section.id}
                  type="button"
                  onClick={() => setActiveSection(section.id)}
                  className={`pb-3 text-sm font-medium ${
                    activeSection === section.id
                      ? 'border-b-2 border-blue-600 text-blue-600'
                      : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  {section.label}
                </button>
              ))}
            </div>
          </div>

          {activeSection === 'targets' && (
            <div>
              <div className="mb-3 flex items-center justify-between">
                <p className="text-sm text-slate-600">
                  Set first response and resolution time targets per priority level.
                </p>
                <div className="flex items-center space-x-2">
                  <ToggleSwitch
                    checked={form.businessHours}
                    disabled={!canEdit}
                    onChange={(next) => setForm((prev) => ({ ...prev, businessHours: next }))}
                  />
                  <span className="text-sm text-slate-700">Business hours only</span>
                </div>
              </div>
              <div className="overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
                <table className="w-full text-sm">
                  <thead className="border-b border-slate-200 bg-slate-100">
                    <tr>
                      <th className="w-28 px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-600">Priority</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-600">First Response (hours)</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-600">Resolution (hours)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {PRIORITIES.map((priority) => (
                      <tr key={priority} className="bg-white">
                        <td className="px-4 py-3">
                          <span className={`rounded-lg px-2 py-1 text-xs font-medium ${PRIORITY_META[priority].color}`}>
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
                              onChange={(event) => updateTarget(priority, 'firstResponse', event.target.value)}
                              className={`w-24 rounded-lg border px-2 py-1.5 text-sm focus:border-transparent focus:ring-2 focus:ring-blue-500 ${
                                errors[`${priority}_fr`] ? 'border-red-400' : 'border-slate-300'
                              } ${!canEdit ? 'cursor-not-allowed bg-slate-100' : ''}`}
                            />
                            <span className="text-xs text-slate-400">= {fmtHours(form.targets[priority].firstResponse)}</span>
                          </div>
                          {errors[`${priority}_fr`] && <p className="mt-1 text-xs text-red-500">{errors[`${priority}_fr`]}</p>}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center space-x-2">
                            <input
                              type="number"
                              min={1}
                              step={1}
                              disabled={!canEdit}
                              value={form.targets[priority].resolution}
                              onChange={(event) => updateTarget(priority, 'resolution', event.target.value)}
                              className={`w-24 rounded-lg border px-2 py-1.5 text-sm focus:border-transparent focus:ring-2 focus:ring-blue-500 ${
                                errors[`${priority}_res`] ? 'border-red-400' : 'border-slate-300'
                              } ${!canEdit ? 'cursor-not-allowed bg-slate-100' : ''}`}
                            />
                            <span className="text-xs text-slate-400">= {fmtHours(form.targets[priority].resolution)}</span>
                          </div>
                          {errors[`${priority}_res`] && <p className="mt-1 text-xs text-red-500">{errors[`${priority}_res`]}</p>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {form.businessHours && (
                <p className="mt-2 flex items-center space-x-1 text-xs text-slate-500">
                  <svg className="h-3.5 w-3.5 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span>Times are counted within business hours (Mon-Fri, 9am-6pm).</span>
                </p>
              )}
            </div>
          )}

          {activeSection === 'teams' && (
            <div className="space-y-5">
              <div>
                <p className="mb-2 text-sm font-medium text-slate-700">Apply to Teams</p>
                <p className="mb-3 text-xs text-slate-500">
                  Select which teams this SLA policy governs. A team can only have one active policy.
                </p>
                <div className="grid grid-cols-2 gap-3">
                  {teams.map((team) => (
                    <label
                      key={team.id}
                      className={`flex cursor-pointer items-center space-x-3 rounded-lg border p-3 transition-all ${
                        form.appliedTo.includes(team.name)
                          ? 'border-blue-500 bg-blue-50'
                          : 'border-slate-200 bg-white hover:border-slate-300'
                      } ${!canEdit ? 'cursor-not-allowed opacity-60' : ''}`}
                    >
                      <input
                        type="checkbox"
                        disabled={!canEdit}
                        checked={form.appliedTo.includes(team.name)}
                        onChange={() => toggleTeam(team.name)}
                        className="h-4 w-4 rounded text-blue-600"
                      />
                      <span className="text-sm font-medium text-slate-700">{team.name}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 p-4">
                <div>
                  <p className="text-sm font-medium text-slate-700">Set as Default Policy</p>
                  <p className="mt-0.5 text-xs text-slate-500">Applied to teams with no explicit policy assigned.</p>
                </div>
                <ToggleSwitch
                  checked={form.isDefault}
                  disabled={!canEdit}
                  onChange={(next) => setForm((prev) => ({ ...prev, isDefault: next }))}
                />
              </div>
              <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 p-4">
                <div>
                  <p className="text-sm font-medium text-slate-700">Policy Status</p>
                  <p className="mt-0.5 text-xs text-slate-500">Disabled policies are not enforced on any tickets.</p>
                </div>
                <div className="flex items-center space-x-2">
                  <span className={`text-sm font-medium ${form.enabled ? 'text-green-600' : 'text-slate-400'}`}>
                    {form.enabled ? 'Enabled' : 'Disabled'}
                  </span>
                  <ToggleSwitch
                    checked={form.enabled}
                    disabled={!canEdit}
                    onChange={(next) => setForm((prev) => ({ ...prev, enabled: next }))}
                  />
                </div>
              </div>
            </div>
          )}

          {activeSection === 'escalation' && (
            <div className="space-y-5">
              <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 p-4">
                <div>
                  <p className="text-sm font-medium text-slate-700">Enable Escalation</p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    Automatically escalate tickets approaching SLA breach.
                  </p>
                </div>
                <ToggleSwitch
                  checked={form.escalation}
                  disabled={!canEdit}
                  onChange={(next) => setForm((prev) => ({ ...prev, escalation: next }))}
                />
              </div>

              {form.escalation && (
                <div className="rounded-xl border border-slate-200 bg-white p-4">
                  <label className="mb-1 block text-sm font-medium text-slate-700">
                    Escalate when SLA is <strong>{form.escalationAfter}%</strong> elapsed
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
                        setForm((prev) => ({ ...prev, escalationAfter: Number(event.target.value) }))
                      }
                      className={`h-2 flex-1 cursor-pointer appearance-none rounded-lg bg-slate-200 accent-blue-600 ${
                        !canEdit ? 'cursor-not-allowed opacity-70' : ''
                      }`}
                    />
                    <span className="w-10 text-right text-sm font-semibold text-blue-600">{form.escalationAfter}%</span>
                  </div>
                  <div className="mt-1 flex justify-between text-xs text-slate-400">
                    <span>50% (early)</span>
                    <span>95% (late)</span>
                  </div>
                </div>
              )}

              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <p className="mb-3 text-sm font-medium text-slate-700">Breach Notifications</p>
                <p className="mb-3 text-xs text-slate-500">Notify these roles when an SLA is breached or at risk.</p>
                <div className="space-y-2">
                  {NOTIFY_OPTIONS.map((option) => (
                    <label key={option.value} className={`flex items-center space-x-3 ${!canEdit ? 'cursor-not-allowed opacity-70' : 'cursor-pointer'}`}>
                      <input
                        type="checkbox"
                        disabled={!canEdit}
                        checked={form.breachNotify.includes(option.value)}
                        onChange={() => toggleNotify(option.value)}
                        className="h-4 w-4 rounded text-blue-600"
                      />
                      <span className="text-sm text-slate-700">{option.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="sticky bottom-0 flex items-center justify-between rounded-b-lg border-t border-slate-200 bg-slate-50 px-6 py-4">
          <p className="text-xs text-slate-400">
            * Required fields
            {form.source === 'live' ? ' • Live policy: targets save to backend, other settings are demo for now.' : ''}
          </p>
          <div className="flex space-x-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!canEdit || saving}
              className="flex items-center space-x-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <span>{saving ? 'Saving...' : isNew ? 'Create Policy' : 'Save Changes'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function BusinessHoursEditor({
  disabled
}: {
  disabled: boolean;
}) {
  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;
  const [hours, setHours] = useState<
    Record<(typeof days)[number], { enabled: boolean; start: string; end: string }>
  >({
    Monday: { enabled: true, start: '09:00', end: '18:00' },
    Tuesday: { enabled: true, start: '09:00', end: '18:00' },
    Wednesday: { enabled: true, start: '09:00', end: '18:00' },
    Thursday: { enabled: true, start: '09:00', end: '18:00' },
    Friday: { enabled: true, start: '09:00', end: '17:00' },
    Saturday: { enabled: false, start: '10:00', end: '14:00' },
    Sunday: { enabled: false, start: '10:00', end: '14:00' }
  });

  function toggleDay(day: (typeof days)[number]) {
    setHours((prev) => ({
      ...prev,
      [day]: { ...prev[day], enabled: !prev[day].enabled }
    }));
  }

  function updateTime(day: (typeof days)[number], key: 'start' | 'end', value: string) {
    setHours((prev) => ({
      ...prev,
      [day]: { ...prev[day], [key]: value }
    }));
  }

  return (
    <div className="space-y-2">
      {days.map((day) => {
        const value = hours[day];
        const [startH, startM] = value.start.split(':').map(Number);
        const [endH, endM] = value.end.split(':').map(Number);
        const totalMinutes = Math.max(0, endH * 60 + endM - (startH * 60 + startM));
        const duration = `${Math.floor(totalMinutes / 60)}h ${totalMinutes % 60 > 0 ? `${totalMinutes % 60}m` : ''}`.trim();

        return (
          <div
            key={day}
            className={`flex min-w-0 flex-wrap items-center gap-2 rounded-lg border p-3 transition-all sm:flex-nowrap sm:gap-4 ${
              value.enabled ? 'border-slate-200 bg-white' : 'border-slate-200 bg-slate-50 opacity-60'
            }`}
          >
            <ToggleSwitch checked={value.enabled} disabled={disabled} onChange={() => toggleDay(day)} />
            <span className="w-24 flex-shrink-0 text-sm font-medium text-slate-700">{day}</span>
            {value.enabled ? (
              <div className="flex min-w-0 flex-wrap items-center gap-2 sm:flex-nowrap sm:gap-2">
                <input
                  type="time"
                  disabled={disabled}
                  value={value.start}
                  onChange={(event) => updateTime(day, 'start', event.target.value)}
                  className={`min-w-0 rounded-lg border border-slate-300 px-2 py-1 text-sm focus:border-transparent focus:ring-2 focus:ring-blue-500 ${
                    disabled ? 'cursor-not-allowed bg-slate-100' : ''
                  }`}
                />
                <span className="text-sm text-slate-400">to</span>
                <input
                  type="time"
                  disabled={disabled}
                  value={value.end}
                  onChange={(event) => updateTime(day, 'end', event.target.value)}
                  className={`min-w-0 rounded-lg border border-slate-300 px-2 py-1 text-sm focus:border-transparent focus:ring-2 focus:ring-blue-500 ${
                    disabled ? 'cursor-not-allowed bg-slate-100' : ''
                  }`}
                />
                <span className="text-xs text-slate-400">({duration})</span>
              </div>
            ) : (
              <span className="text-sm italic text-slate-400">Closed</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function HolidayManager({
  disabled
}: {
  disabled: boolean;
}) {
  const [holidays, setHolidays] = useState<Array<{ id: number; name: string; date: string }>>([
    { id: 1, name: "New Year's Day", date: '2026-01-01' },
    { id: 2, name: 'Memorial Day', date: '2026-05-25' },
    { id: 3, name: 'Independence Day', date: '2026-07-04' },
    { id: 4, name: 'Thanksgiving Day', date: '2026-11-26' },
    { id: 5, name: 'Christmas Day', date: '2026-12-25' }
  ]);
  const [newName, setNewName] = useState('');
  const [newDate, setNewDate] = useState('');

  function addHoliday() {
    if (!newName.trim() || !newDate || disabled) return;
    setHolidays((prev) => [...prev, { id: Date.now(), name: newName.trim(), date: newDate }]);
    setNewName('');
    setNewDate('');
  }

  function removeHoliday(id: number) {
    if (disabled) return;
    setHolidays((prev) => prev.filter((item) => item.id !== id));
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-500">On holidays, SLA timers are paused (treated as non-business time).</p>
      <div className="space-y-2">
        {holidays.map((holiday) => (
          <div key={holiday.id} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 transition hover:bg-slate-100">
            <div className="flex items-center space-x-3">
              <span className="text-lg">🗓️</span>
              <div>
                <p className="text-sm font-medium text-slate-800">{holiday.name}</p>
                <p className="text-xs text-slate-500">
                  {new Date(`${holiday.date}T00:00:00`).toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric'
                  })}
                </p>
              </div>
            </div>
            <button
              type="button"
              disabled={disabled}
              onClick={() => removeHoliday(holiday.id)}
              className="rounded p-1 text-slate-400 hover:text-red-500 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        ))}
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-2 border-t border-slate-100 pt-2">
        <input
          value={newName}
          disabled={disabled}
          onChange={(event) => setNewName(event.target.value)}
          placeholder="Holiday name"
          className={`min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm focus:border-transparent focus:ring-2 focus:ring-blue-500 ${
            disabled ? 'cursor-not-allowed bg-slate-100' : ''
          }`}
        />
        <input
          type="date"
          value={newDate}
          disabled={disabled}
          onChange={(event) => setNewDate(event.target.value)}
          className={`min-w-0 rounded-lg border border-slate-300 px-3 py-1.5 text-sm focus:border-transparent focus:ring-2 focus:ring-blue-500 ${
            disabled ? 'cursor-not-allowed bg-slate-100' : ''
          }`}
        />
        <button
          type="button"
          disabled={disabled || !newName.trim() || !newDate}
          onClick={addHoliday}
          className="flex-shrink-0 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
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
  headerProps
}: {
  teamsList: TeamRef[];
  role: Role;
  headerProps?: SlaHeaderProps;
}) {
  const toast = useToast();
  const canEdit = role === 'TEAM_ADMIN' || role === 'OWNER';
  const isReadOnly = role === 'LEAD';

  const [activeTab, setActiveTab] = useState<TabKey>('policies');
  const [searchQuery, setSearchQuery] = useState('');
  const [livePolicies, setLivePolicies] = useState<PolicyModel[]>([]);
  const [demoPolicies, setDemoPolicies] = useState<PolicyModel[]>(DEFAULT_DEMO_POLICIES);
  const [liveMetaByTeamId, setLiveMetaByTeamId] = useState<Record<string, LivePolicyMeta>>({});
  const [selectedPolicyId, setSelectedPolicyId] = useState<string | null>(null);
  const [loadingLive, setLoadingLive] = useState(false);
  const [liveError, setLiveError] = useState<string | null>(null);

  const [overviewData, setOverviewData] = useState<SlaComplianceResponse['data'] | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [overviewError, setOverviewError] = useState<string | null>(null);

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
  }, [teamsList]);

  const policies = useMemo(() => {
    const mergedLive = livePolicies.map((policy) => {
      if (!policy.teamId) return policy;
      const meta = liveMetaByTeamId[policy.teamId];
      if (!meta) return policy;
      return { ...policy, ...meta };
    });
    return [...mergedLive, ...demoPolicies];
  }, [demoPolicies, liveMetaByTeamId, livePolicies]);

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
    if (selectedPolicyId && policies.some((policy) => policy.id === selectedPolicyId)) return;
    setSelectedPolicyId(policies[0]?.id ?? null);
  }, [policies, selectedPolicyId]);

  const selectedPolicy = useMemo(
    () => policies.find((policy) => policy.id === selectedPolicyId) ?? null,
    [policies, selectedPolicyId]
  );

  const overallCompliance = useMemo(() => {
    if (overviewData?.total && overviewData.total > 0) {
      return Math.round((overviewData.met / overviewData.total) * 100);
    }
    const enabled = policies.filter((policy) => policy.enabled && policy.compliance > 0);
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
    return teamsList.map((team) => {
      const assigned = policies.find(
        (policy) => policy.enabled && policy.appliedTo.includes(team.name)
      );
      return { team, policy: assigned ?? null };
    });
  }, [policies, teamsList]);

  async function loadLivePolicies() {
    if (teamsList.length === 0) {
      setLivePolicies([]);
      return;
    }
    setLoadingLive(true);
    setLiveError(null);
    const from = ymd(fromDate);
    const to = ymd(today);
    try {
      const loaded = await Promise.all(
        teamsList.map(async (team) => {
          try {
            const [slaResponse, complianceResponse] = await Promise.all([
              fetchSlaPolicies(team.id),
              fetchReportSlaCompliance({ teamId: team.id, from, to }).catch(() => null)
            ]);
            const compliance =
              complianceResponse?.data.total && complianceResponse.data.total > 0
                ? Math.round((complianceResponse.data.met / complianceResponse.data.total) * 100)
                : 0;
            return {
              id: `live-${team.id}`,
              teamId: team.id,
              name: `${team.name} SLA`,
              description: 'Live policy synced from backend team SLA.',
              isDefault: false,
              enabled: true,
              appliedTo: [team.name],
              targets: targetsFromApi(slaResponse.data),
              businessHours: true,
              escalation: true,
              escalationAfter: 80,
              breachNotify: ['agent', 'lead'] as NotifyValue[],
              createdAt: 'Live',
              compliance,
              source: 'live' as const
            };
          } catch {
            return {
              id: `live-fallback-${team.id}`,
              teamId: team.id,
              name: `${team.name} SLA (Demo fallback)`,
              description: 'Backend SLA data unavailable for this team.',
              isDefault: false,
              enabled: true,
              appliedTo: [team.name],
              targets: cloneTargets(DEFAULT_TARGETS),
              businessHours: true,
              escalation: true,
              escalationAfter: 80,
              breachNotify: ['agent', 'lead'] as NotifyValue[],
              createdAt: 'Demo',
              compliance: 0,
              source: 'demo' as const
            };
          }
        })
      );
      setLivePolicies(loaded);
    } catch {
      setLivePolicies([]);
      setLiveError('Unable to load live SLA policies from backend.');
    } finally {
      setLoadingLive(false);
    }
  }

  async function loadOverview() {
    setOverviewLoading(true);
    setOverviewError(null);
    try {
      const response = await fetchReportSlaCompliance({
        from: ymd(fromDate),
        to: ymd(today)
      });
      setOverviewData(response.data);
    } catch {
      setOverviewData(null);
      setOverviewError('Overview is using demo values until report data is available.');
    } finally {
      setOverviewLoading(false);
    }
  }

  async function handleResetLivePolicy(policy: PolicyModel) {
    if (!policy.teamId || !canEdit) return;
    try {
      const response = await resetSlaPolicies(policy.teamId);
      setLivePolicies((prev) =>
        prev.map((item) =>
          item.teamId === policy.teamId
            ? {
                ...item,
                targets: targetsFromApi(response.data)
              }
            : item
        )
      );
      toast.success('Live policy reset to backend defaults.');
    } catch {
      toast.error('Unable to reset live policy.');
    }
  }

  function handleCreate() {
    if (!canEdit) return;
    setEditingPolicy(null);
    setShowEditor(true);
  }

  function handleEdit(policy: PolicyModel) {
    if (!canEdit) return;
    setEditingPolicy(policy);
    setShowEditor(true);
  }

  async function handleSave(next: PolicyModel) {
    if (!canEdit) return;
    if (next.source === 'live' && next.teamId) {
      const meta: LivePolicyMeta = {
        name: next.name,
        description: next.description,
        isDefault: next.isDefault,
        enabled: next.enabled,
        businessHours: next.businessHours,
        escalation: next.escalation,
        escalationAfter: next.escalationAfter,
        breachNotify: [...next.breachNotify]
      };
      setLiveMetaByTeamId((prev) => ({ ...prev, [next.teamId!]: meta }));
      try {
        const response = await updateSlaPolicies(next.teamId, toApiPolicies(next.targets));
        setLivePolicies((prev) =>
          prev.map((item) =>
            item.teamId === next.teamId
              ? {
                  ...item,
                  targets: targetsFromApi(response.data)
                }
              : item
          )
        );
        toast.success('Live SLA targets saved. Advanced policy fields remain demo for now.');
      } catch {
        toast.error('Unable to save live SLA targets.');
        throw new Error('save_failed');
      }
    } else {
      if (next.id) {
        setDemoPolicies((prev) =>
          prev.map((item) => (item.id === next.id ? { ...next, source: 'demo' } : item))
        );
        toast.success(`"${next.name}" updated.`);
      } else {
        const created: PolicyModel = {
          ...next,
          id: `demo-${Date.now()}`,
          source: 'demo',
          createdAt: shortDate(new Date()),
          compliance: next.compliance || 0
        };
        setDemoPolicies((prev) => [...prev, created]);
        setSelectedPolicyId(created.id);
        toast.success(`"${created.name || 'New policy'}" created.`);
      }
    }
    setShowEditor(false);
    setEditingPolicy(null);
  }

  function handleDelete(policy: PolicyModel) {
    if (!canEdit || policy.source === 'live') return;
    setDeleteTarget(policy);
  }

  function confirmDelete() {
    if (!deleteTarget) return;
    setDemoPolicies((prev) => prev.filter((policy) => policy.id !== deleteTarget.id));
    if (selectedPolicyId === deleteTarget.id) {
      setSelectedPolicyId(null);
    }
    toast.success(`"${deleteTarget.name}" deleted.`);
    setDeleteTarget(null);
  }

  function applyLiveMeta(policy: PolicyModel, patch: Partial<LivePolicyMeta>) {
    if (!policy.teamId) return;
    const defaults: LivePolicyMeta = {
      name: policy.name,
      description: policy.description,
      isDefault: policy.isDefault,
      enabled: policy.enabled,
      businessHours: policy.businessHours,
      escalation: policy.escalation,
      escalationAfter: policy.escalationAfter,
      breachNotify: [...policy.breachNotify]
    };
    setLiveMetaByTeamId((prev) => ({
      ...prev,
      [policy.teamId!]: {
        ...defaults,
        ...(prev[policy.teamId!] ?? {}),
        ...patch
      }
    }));
  }

  function toggleEnabled(policy: PolicyModel) {
    if (!canEdit) return;
    if (policy.source === 'live') {
      applyLiveMeta(policy, { enabled: !policy.enabled });
      toast.info('Live policy enabled/disabled is marked as demo until backend supports it.');
      return;
    }
    setDemoPolicies((prev) =>
      prev.map((item) =>
        item.id === policy.id ? { ...item, enabled: !item.enabled } : item
      )
    );
  }

  function setDefault(policy: PolicyModel) {
    if (!canEdit) return;
    setDemoPolicies((prev) => prev.map((item) => ({ ...item, isDefault: item.id === policy.id })));
    livePolicies.forEach((livePolicy) => {
      if (!livePolicy.teamId) return;
      applyLiveMeta(livePolicy, { isDefault: livePolicy.id === policy.id });
    });
    if (policy.source === 'live') {
      toast.info('Default selection is tracked in UI only until backend support is added.');
    } else {
      toast.success(`"${policy.name}" set as default.`);
    }
  }

  return (
    <section className="min-h-full bg-slate-50 animate-fade-in">
      <div className="sticky top-0 z-40 border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-[1600px] pl-6 pr-2 py-4">
          {headerProps ? (
            <TopBar
              title={headerProps.title}
              subtitle={headerProps.subtitle}
              currentEmail={headerProps.currentEmail}
              personas={headerProps.personas}
              onEmailChange={headerProps.onEmailChange}
              onOpenSearch={headerProps.onOpenSearch}
              notificationProps={headerProps.notificationProps}
              leftContent={
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-3">
                    <h1 className="text-xl font-semibold text-slate-900">SLA Settings</h1>
                    {isReadOnly && (
                      <span className="rounded-lg bg-yellow-100 px-2 py-1 text-xs font-medium text-yellow-700">
                        Lead read-only
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-sm text-slate-500">
                    Manage response and resolution targets across all teams.
                  </p>
                </div>
              }
            />
          ) : (
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="text-xl font-semibold text-slate-900">SLA Settings</h1>
                {isReadOnly && (
                  <span className="rounded-lg bg-yellow-100 px-2 py-1 text-xs font-medium text-yellow-700">
                    Lead read-only
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-sm text-slate-500">
                Manage response and resolution targets across all teams.
              </p>
            </div>
          )}
        </div>

        <div className="border-t border-slate-200 bg-white">
          <div className="mx-auto max-w-[1600px] px-6 py-4">
            <div className="flex items-center justify-between">
              <div className="flex space-x-6">
                {[
                  { id: 'policies', label: 'Policies', icon: 'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z' },
                  { id: 'overview', label: 'Overview', icon: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z' },
                  { id: 'business-hours', label: 'Business Hours', icon: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z' }
                ].map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveTab(tab.id as TabKey)}
                    className={`-mb-px flex items-center space-x-1.5 border-b-2 pb-3 text-sm font-medium transition-colors ${
                      activeTab === tab.id
                        ? 'border-blue-600 text-blue-600'
                        : 'border-transparent text-slate-500 hover:text-slate-700'
                    }`}
                  >
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={tab.icon} />
                    </svg>
                    <span>{tab.label}</span>
                  </button>
                ))}
              </div>
              {canEdit && (
                <button
                  type="button"
                  onClick={handleCreate}
                  className="flex items-center space-x-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700"
                >
                  <Plus className="h-4 w-4" />
                  <span>New Policy</span>
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-[1600px] p-6">
        {liveError && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {liveError}
          </div>
        )}

        {activeTab === 'policies' && (
          <div>
            <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-700">
              Live data: SLA targets + compliance are pulled from backend where available. Demo labels mark frontend-only placeholders.
            </div>

            <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
              {[
                {
                  label: 'Total Policies',
                  value: policies.length,
                  color: 'text-blue-600',
                  bg: 'bg-blue-50'
                },
                {
                  label: 'Active Policies',
                  value: policies.filter((policy) => policy.enabled).length,
                  color: 'text-green-600',
                  bg: 'bg-green-50'
                },
                {
                  label: 'Teams Covered',
                  value: coveredTeams,
                  color: 'text-purple-600',
                  bg: 'bg-purple-50'
                },
                {
                  label: 'Avg Compliance',
                  value: `${overallCompliance}%`,
                  color: overallCompliance >= 90 ? 'text-green-600' : overallCompliance >= 80 ? 'text-yellow-600' : 'text-red-600',
                  bg: overallCompliance >= 90 ? 'bg-green-50' : overallCompliance >= 80 ? 'bg-yellow-50' : 'bg-red-50'
                }
              ].map((kpi) => (
                <div key={kpi.label} className="card rounded-xl border border-slate-200 bg-white p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs font-medium text-slate-500">{kpi.label}</p>
                      <p className={`mt-0.5 text-2xl font-bold ${kpi.color}`}>{kpi.value}</p>
                    </div>
                    <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${kpi.bg}`}>
                      <svg className={`h-5 w-5 ${kpi.color}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                      </svg>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900">
                All Policies <span className="ml-1 font-normal text-slate-400">({filteredPolicies.length})</span>
              </h3>
              <div className="relative">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Search policies..."
                  className="w-56 rounded-lg border border-slate-300 py-1.5 pl-9 pr-3 text-sm focus:border-transparent focus:ring-2 focus:ring-blue-500"
                />
                <svg className="absolute left-3 top-2 h-4 w-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </div>
            </div>

            <div className="grid gap-5 lg:grid-cols-12">
              <div className="space-y-3 lg:col-span-5">
                {loadingLive && (
                  <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-500">
                    Loading live team SLA policies...
                  </div>
                )}

                {!loadingLive && filteredPolicies.length === 0 && (
                  <div className="rounded-xl border border-slate-200 bg-white py-12 text-center text-sm text-slate-400">
                    No policies match your search.
                  </div>
                )}

                {filteredPolicies.map((policy) => (
                  <div
                    key={policy.id}
                    onClick={() => setSelectedPolicyId(policy.id)}
                    className={`cursor-pointer rounded-lg border-2 bg-white p-4 transition-all hover:-translate-y-0.5 hover:shadow-sm ${
                      selectedPolicyId === policy.id ? 'border-blue-500 bg-blue-50/60' : 'border-slate-200'
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="truncate text-sm font-semibold text-slate-900">{policy.name}</span>
                          {policy.isDefault && <span className="rounded-lg bg-blue-100 px-2 py-1 text-xs font-medium text-blue-700">Default</span>}
                          {!policy.enabled && <span className="rounded-lg bg-slate-100 px-2 py-1 text-xs font-medium text-slate-500">Disabled</span>}
                          <span className={`rounded-lg px-2 py-1 text-xs font-medium ${policy.source === 'live' ? 'bg-green-100 text-green-700' : 'bg-purple-100 text-purple-700'}`}>
                            {policy.source === 'live' ? 'Live' : 'Demo'}
                          </span>
                        </div>
                        <p className="mt-0.5 truncate text-xs text-slate-500">{policy.description}</p>
                        <div className="mt-2 flex items-center space-x-3">
                          {policy.compliance > 0 && (
                            <div className="flex items-center space-x-1.5">
                              <div className="h-1.5 w-16 rounded-full bg-slate-200">
                                <div
                                  className={`h-1.5 rounded-full ${complianceBg(policy.compliance)}`}
                                  style={{ width: `${policy.compliance}%` }}
                                />
                              </div>
                              <span className={`text-xs font-medium ${complianceColor(policy.compliance)}`}>
                                {policy.compliance}%
                              </span>
                            </div>
                          )}
                          <span className="text-xs text-slate-400">
                            {policy.appliedTo.length} team{policy.appliedTo.length !== 1 ? 's' : ''}
                          </span>
                        </div>
                      </div>

                      {canEdit && (
                        <div className="ml-2 flex flex-shrink-0 items-center space-x-1" onClick={(event) => event.stopPropagation()}>
                          <button
                            type="button"
                            onClick={() => toggleEnabled(policy)}
                            className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                            title={policy.enabled ? 'Disable' : 'Enable'}
                          >
                            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={policy.enabled ? 'M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728L5.636 5.636' : 'M5 13l4 4L19 7'} />
                            </svg>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleEdit(policy)}
                            className="rounded p-1.5 text-slate-400 hover:bg-blue-50 hover:text-blue-600"
                          >
                            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                            </svg>
                          </button>
                          {policy.source !== 'live' && (
                            <button
                              type="button"
                              onClick={() => handleDelete(policy)}
                              className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                            >
                              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                              </svg>
                            </button>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="mt-3 grid grid-cols-4 gap-1 border-t border-slate-100 pt-3">
                      {PRIORITIES.map((priority) => (
                        <div key={priority} className="text-center">
                          <span className={`mb-1 inline-block h-2 w-2 rounded-full ${PRIORITY_META[priority].dot}`} />
                          <p className="text-xs text-slate-500">{PRIORITY_META[priority].label}</p>
                          <p className="text-xs font-semibold text-slate-700">{fmtHours(policy.targets[priority].resolution)}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}

                {canEdit && (
                  <button
                    type="button"
                    onClick={handleCreate}
                    className="flex w-full items-center justify-center space-x-2 rounded-xl border-2 border-dashed border-slate-300 p-4 text-sm text-slate-400 transition-colors hover:border-blue-400 hover:text-blue-500"
                  >
                    <Plus className="h-4 w-4" />
                    <span>Add New Policy</span>
                  </button>
                )}
              </div>

              <div className="lg:col-span-7">
                {selectedPolicy ? (
                  <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                    <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
                      <div className="flex items-center space-x-3">
                        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-100">
                          <svg className="h-4 w-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                          </svg>
                        </div>
                        <div>
                          <h3 className="text-sm font-semibold text-slate-900">{selectedPolicy.name}</h3>
                          <p className="text-xs text-slate-500">{selectedPolicy.description}</p>
                        </div>
                      </div>
                      <div className="flex items-center space-x-2">
                        <span className={`rounded-lg px-2 py-1 text-xs font-medium ${selectedPolicy.source === 'live' ? 'bg-green-100 text-green-700' : 'bg-purple-100 text-purple-700'}`}>
                          {selectedPolicy.source === 'live' ? 'Live' : 'Demo'}
                        </span>
                        {canEdit && (
                          <>
                            {selectedPolicy.source === 'live' && (
                              <button
                                type="button"
                                onClick={() => handleResetLivePolicy(selectedPolicy)}
                                className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                              >
                                Reset Targets
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => handleEdit(selectedPolicy)}
                              className="rounded-lg border border-blue-200 px-3 py-1.5 text-xs font-medium text-blue-600 hover:bg-blue-50"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => setDefault(selectedPolicy)}
                              className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                            >
                              Set Default
                            </button>
                          </>
                        )}
                      </div>
                    </div>

                    <div className="space-y-5 p-5">
                      {selectedPolicy.compliance > 0 && (
                        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                          <div className="mb-2 flex items-center justify-between">
                            <span className="text-xs font-medium text-slate-600">SLA Compliance (Last 30d)</span>
                            <span className={`text-lg font-bold ${complianceColor(selectedPolicy.compliance)}`}>
                              {selectedPolicy.compliance}%
                            </span>
                          </div>
                          <div className="h-2 w-full rounded-full bg-slate-200">
                            <div className={`h-2 rounded-full ${complianceBg(selectedPolicy.compliance)}`} style={{ width: `${selectedPolicy.compliance}%` }} />
                          </div>
                        </div>
                      )}

                      <div>
                        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-700">SLA Targets</p>
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
                              {PRIORITIES.map((priority) => (
                                <tr key={priority} className="bg-white">
                                  <td className="px-3 py-2">
                                    <div className="flex items-center space-x-2">
                                      <span className={`h-2 w-2 rounded-full ${PRIORITY_META[priority].dot}`} />
                                      <span className="text-xs font-medium text-slate-700">{PRIORITY_META[priority].label}</span>
                                    </div>
                                  </td>
                                  <td className="px-3 py-2 text-xs font-medium text-slate-700">{fmtHours(selectedPolicy.targets[priority].firstResponse)}</td>
                                  <td className="px-3 py-2 text-xs font-medium text-slate-700">{fmtHours(selectedPolicy.targets[priority].resolution)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>

                      <div>
                        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-700">Configuration</p>
                        <div className="flex flex-wrap gap-2">
                          <span className={`rounded-lg px-2 py-1 text-xs font-medium ${selectedPolicy.businessHours ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-600'}`}>
                            {selectedPolicy.businessHours ? 'Business Hours' : '24/7'}
                          </span>
                          <span className={`rounded-lg px-2 py-1 text-xs font-medium ${selectedPolicy.escalation ? 'bg-orange-100 text-orange-700' : 'bg-slate-100 text-slate-600'}`}>
                            {selectedPolicy.escalation ? `Escalate at ${selectedPolicy.escalationAfter}%` : 'No Escalation'}
                          </span>
                          {selectedPolicy.breachNotify.map((notify) => (
                            <span key={notify} className="rounded-lg bg-purple-100 px-2 py-1 text-xs font-medium text-purple-700">
                              {NOTIFY_OPTIONS.find((option) => option.value === notify)?.label}
                            </span>
                          ))}
                        </div>
                      </div>

                      <div>
                        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-700">Applied To</p>
                        {selectedPolicy.appliedTo.length === 0 ? (
                          <p className="text-xs italic text-slate-400">Not applied to any teams</p>
                        ) : (
                          <div className="flex flex-wrap gap-1.5">
                            {selectedPolicy.appliedTo.map((team) => (
                              <span key={team} className="rounded-lg bg-green-100 px-2 py-1 text-xs font-medium text-green-700">
                                {team}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>

                      <p className="text-xs text-slate-400">Created {selectedPolicy.createdAt}</p>
                    </div>
                  </div>
                ) : (
                  <div className="flex min-h-64 flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-200 bg-white p-8 text-center">
                    <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-slate-100">
                      <svg className="h-6 w-6 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                      </svg>
                    </div>
                    <p className="text-sm font-medium text-slate-600">Select a policy to view details</p>
                    <p className="mt-1 text-xs text-slate-400">Click any policy card on the left to inspect its configuration.</p>
                  </div>
                )}
              </div>
            </div>

            <div className="mt-6 overflow-hidden rounded-xl border border-slate-200 bg-white">
              <div className="border-b border-slate-200 px-5 py-4">
                <h3 className="text-sm font-semibold text-slate-900">Team-Policy Assignment</h3>
                <p className="mt-0.5 text-xs text-slate-500">
                  Overview of which SLA policy is active for each team.
                </p>
              </div>
              <div className="divide-y divide-slate-100">
                {teamAssignment.map(({ team, policy }) => (
                  <div key={team.id} className="flex items-center justify-between px-5 py-3 hover:bg-slate-50">
                    <div className="flex items-center space-x-3">
                      <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-100">
                        <svg className="h-4 w-4 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                        </svg>
                      </div>
                      <span className="text-sm font-medium text-slate-900">{team.name}</span>
                    </div>
                    <div className="flex items-center space-x-3">
                      {policy ? (
                        <>
                          <span className="rounded-lg bg-green-100 px-2 py-1 text-xs font-medium text-green-700">
                            {policy.name}
                          </span>
                          {policy.compliance > 0 && (
                            <span className={`text-xs font-medium ${complianceColor(policy.compliance)}`}>
                              {policy.compliance}% compliant
                            </span>
                          )}
                          {policy.source === 'demo' && (
                            <span className="rounded-lg bg-purple-100 px-2 py-1 text-xs font-medium text-purple-700">
                              Demo
                            </span>
                          )}
                        </>
                      ) : (
                        <span className="rounded-lg bg-slate-100 px-2 py-1 text-xs font-medium text-slate-500">
                          Using default policy
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-4">
              <h3 className="text-sm font-semibold text-amber-900">Backend TODO (tracked)</h3>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-amber-800">
                {BACKEND_TODO_ITEMS.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {activeTab === 'overview' && (
          <div className="space-y-5">
            <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-700">
              Compliance totals are live from backend reports when available. Per-priority chart values are currently demo.
            </div>

            <div className="grid gap-5 md:grid-cols-3">
              <div className="rounded-xl border border-slate-200 bg-white p-5 md:col-span-2">
                <h3 className="mb-4 text-sm font-semibold text-slate-900">SLA Compliance by Priority - Last 30 days</h3>
                <div className="mb-3 inline-flex rounded-lg bg-purple-100 px-2 py-1 text-xs font-medium text-purple-700">
                  Demo data
                </div>
                <div className="space-y-4">
                  {[
                    { priority: 'critical' as PriorityKey, achieved: 91, target: 95 },
                    { priority: 'high' as PriorityKey, achieved: 94, target: 95 },
                    { priority: 'medium' as PriorityKey, achieved: 97, target: 90 },
                    { priority: 'low' as PriorityKey, achieved: 99, target: 85 }
                  ].map((row) => (
                    <div key={row.priority}>
                      <div className="mb-1 flex items-center justify-between text-xs">
                        <div className="flex items-center space-x-2">
                          <span className={`h-2.5 w-2.5 rounded-full ${PRIORITY_META[row.priority].dot}`} />
                          <span className="font-medium text-slate-700">{PRIORITY_META[row.priority].label}</span>
                        </div>
                        <div className="flex items-center space-x-3">
                          <span className="text-slate-400">Target: {row.target}%</span>
                          <span className={`font-semibold ${row.achieved >= row.target ? 'text-green-600' : 'text-red-600'}`}>
                            {row.achieved}% {row.achieved >= row.target ? '✓' : '✗'}
                          </span>
                        </div>
                      </div>
                      <div className="relative h-3 w-full rounded-full bg-slate-100">
                        <div
                          className={`h-3 rounded-full ${row.achieved >= row.target ? 'bg-green-500' : 'bg-red-500'}`}
                          style={{ width: `${row.achieved}%` }}
                        />
                        <div className="absolute top-0 h-3 w-0.5 rounded bg-slate-500/50" style={{ left: `${row.target}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-5">
                <h3 className="mb-4 text-sm font-semibold text-slate-900">Breach Summary</h3>
                {overviewLoading && <p className="text-sm text-slate-500">Loading report data...</p>}
                {!overviewLoading && (
                  <div className="space-y-3">
                    {[
                      {
                        label: 'Breached (First Response)',
                        value: overviewData?.firstResponseBreached ?? 0,
                        color: 'text-red-600',
                        bg: 'bg-red-50'
                      },
                      {
                        label: 'Breached (Resolution)',
                        value: overviewData?.resolutionBreached ?? 0,
                        color: 'text-red-600',
                        bg: 'bg-red-50'
                      },
                      {
                        label: 'At Risk (>80%)',
                        value: Math.max(0, Math.round((overviewData?.total ?? 0) * 0.05)),
                        color: 'text-yellow-600',
                        bg: 'bg-yellow-50'
                      },
                      {
                        label: 'Compliant',
                        value: overviewData?.met ?? 0,
                        color: 'text-green-600',
                        bg: 'bg-green-50'
                      }
                    ].map((item) => (
                      <div key={item.label} className={`flex items-center justify-between rounded-lg p-3 ${item.bg}`}>
                        <span className="text-xs text-slate-700">{item.label}</span>
                        <span className={`text-base font-bold ${item.color}`}>{item.value}</span>
                      </div>
                    ))}
                  </div>
                )}

                <div className="mt-4 border-t border-slate-100 pt-4">
                  <div className="flex justify-between text-xs text-slate-500">
                    <span>Overall</span>
                    <span className={`font-semibold ${complianceColor(overallCompliance)}`}>{overallCompliance}% compliant</span>
                  </div>
                  <div className="mt-1.5 h-2 w-full rounded-full bg-slate-100">
                    <div className={`h-2 rounded-full ${complianceBg(overallCompliance)}`} style={{ width: `${overallCompliance}%` }} />
                  </div>
                  {overviewError && <p className="mt-2 text-xs text-purple-700">{overviewError}</p>}
                </div>
              </div>
            </div>

            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
              <div className="border-b border-slate-200 px-5 py-4">
                <h3 className="text-sm font-semibold text-slate-900">Policy Performance</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-slate-200 bg-slate-50">
                    <tr>
                      {['Policy', 'Status', 'Teams', 'Compliance', 'Breaches (30d)', 'Avg Response', 'Avg Resolution'].map((heading) => (
                        <th key={heading} className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-600">
                          {heading}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {policies.map((policy) => (
                      <tr key={policy.id} className="hover:bg-slate-50">
                        <td className="px-5 py-3">
                          <div className="flex items-center space-x-2">
                            <span className="text-sm font-medium text-slate-900">{policy.name}</span>
                            {policy.isDefault && <span className="rounded-lg bg-blue-100 px-2 py-1 text-xs font-medium text-blue-700">Default</span>}
                            <span className={`rounded-lg px-2 py-1 text-xs font-medium ${policy.source === 'live' ? 'bg-green-100 text-green-700' : 'bg-purple-100 text-purple-700'}`}>
                              {policy.source === 'live' ? 'Live' : 'Demo'}
                            </span>
                          </div>
                          <p className="mt-0.5 text-xs text-slate-400">{policy.description}</p>
                        </td>
                        <td className="px-5 py-3">
                          <span className={`rounded-lg px-2 py-1 text-xs font-medium ${policy.enabled ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
                            {policy.enabled ? 'Active' : 'Disabled'}
                          </span>
                        </td>
                        <td className="px-5 py-3 text-sm text-slate-700">
                          {policy.appliedTo.length === 0 ? <span className="italic text-slate-400">None</span> : policy.appliedTo.join(', ')}
                        </td>
                        <td className="px-5 py-3">
                          {policy.compliance > 0 ? (
                            <div className="flex items-center space-x-2">
                              <div className="h-1.5 w-16 rounded-full bg-slate-200">
                                <div className={`h-1.5 rounded-full ${complianceBg(policy.compliance)}`} style={{ width: `${policy.compliance}%` }} />
                              </div>
                              <span className={`text-sm font-semibold ${complianceColor(policy.compliance)}`}>{policy.compliance}%</span>
                            </div>
                          ) : (
                            <span className="text-xs text-slate-400">-</span>
                          )}
                        </td>
                        <td className="px-5 py-3 text-sm font-medium text-slate-700">
                          {policy.enabled && policy.compliance > 0 ? `${Math.max(0, Math.round((100 - policy.compliance) / 5))}` : '-'}
                        </td>
                        <td className="px-5 py-3 text-sm text-slate-700">
                          {policy.enabled ? fmtHours(policy.targets.medium.firstResponse) : '-'}
                        </td>
                        <td className="px-5 py-3 text-sm text-slate-700">
                          {policy.enabled ? fmtHours(policy.targets.medium.resolution) : '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'business-hours' && (
          <div className="w-full min-w-0 space-y-5">
            <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-700">
              Business hours and holidays are demo UI for now. Backend persistence is listed in the TODO card.
            </div>
            <div className="grid grid-cols-1 gap-5 sm:gap-6 md:gap-8 lg:gap-10 md:grid-cols-2">
              <div className="min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white">
                <div className="border-b border-slate-200 px-4 py-3 sm:px-5 sm:py-4">
                  <h3 className="text-sm font-semibold text-slate-900">Working Hours</h3>
                  <p className="mt-0.5 text-xs text-slate-500">
                    SLA timers only tick during active hours on enabled days.
                  </p>
                </div>
                <div className="min-w-0 p-4 sm:p-5">
                  <BusinessHoursEditor disabled={!canEdit} />
                </div>
              </div>

              <div className="min-w-0 rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
                <h3 className="mb-4 text-sm font-semibold text-slate-900">Holidays</h3>
                <HolidayManager disabled={!canEdit} />
              </div>
            </div>

            {canEdit && (
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => toast.success('Business hours changes saved locally (demo).')}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
                >
                  Save Business Hours
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {showEditor && (
        <PolicyModal
          policy={editingPolicy}
          teams={teamsList}
          canEdit={canEdit}
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

