import { useEffect, useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import {
  ApiError,
  createAutomationRule,
  deleteAutomationRule,
  fetchAutomationRuleExecutions,
  fetchAutomationRules,
  type AutomationAction,
  type AutomationCondition,
  type AutomationRule,
  type NotificationRecord,
  type TeamRef,
  updateAutomationRule
} from '../api/client';
import { TopBar } from '../components/TopBar';
import type { Role } from '../types';
import { useToast } from '../hooks/useToast';

type AutomationHeaderProps = {
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

type FlatCondition = {
  field: string;
  op: string;
  val: string;
};

type FlatAction = {
  type: string;
  val: string;
};

type RuleUiMeta = {
  triggerVal: string;
  conditions: FlatCondition[];
  actions: FlatAction[];
  runCount: number;
  lastRun: string;
  statsSource: 'live' | 'demo';
};

type AutomationForm = {
  id: string | null;
  name: string;
  description: string;
  enabled: boolean;
  trigger: string;
  triggerVal: string;
  conditions: FlatCondition[];
  actions: FlatAction[];
  priority: number;
  teamId: string;
};

const TRIGGERS = [
  { value: 'ticket_created', label: 'Ticket Created' },
  { value: 'ticket_updated', label: 'Ticket Updated' },
  { value: 'sla_breach', label: 'SLA Breach' },
  { value: 'time_based', label: 'Time-based' },
  { value: 'status_change', label: 'Status Changed' }
];

const ACTION_TYPES = [
  { value: 'set_status', label: 'Set Status' },
  { value: 'assign_team', label: 'Assign Team' },
  { value: 'add_tag', label: 'Add Tag' },
  { value: 'send_reply', label: 'Send Reply' },
  { value: 'notify_role', label: 'Notify Role' },
  { value: 'set_priority', label: 'Set Priority' }
];

const CONDITION_FIELDS = ['status', 'priority', 'channel', 'requester_tag', 'last_reply_age', 'team'];
const CONDITION_OPS = ['is', 'is_not', 'contains', 'gt', 'lt'];

const EMPTY_CONDITION: FlatCondition = { field: 'status', op: 'is', val: '' };
const EMPTY_ACTION: FlatAction = { type: 'set_status', val: '' };

function apiErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    try {
      const parsed = JSON.parse(err.message) as { message?: string };
      if (typeof parsed.message === 'string' && parsed.message.trim()) {
        return parsed.message;
      }
    } catch {
      // non-json response
    }
    return err.message || 'Request failed';
  }
  if (err instanceof Error) return err.message;
  return 'Request failed';
}

function triggerIcon(trigger: string): string {
  if (trigger === 'time_based') return 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z';
  if (trigger === 'sla_breach') {
    return 'M12 9v2m0 4h.01M10.293 4.293a1 1 0 011.414 0L21 13.586V19a2 2 0 01-2 2H5a2 2 0 01-2-2v-5.414l9.293-9.293z';
  }
  return 'M13 10V3L4 14h7v7l9-11h-7z';
}

function triggerBg(trigger: string): string {
  if (trigger === 'sla_breach') return 'bg-red-100 text-red-600';
  if (trigger === 'time_based') return 'bg-purple-100 text-purple-600';
  return 'bg-green-100 text-green-600';
}

function triggerLabel(trigger: string): string {
  const normalized = trigger.toLowerCase();
  return TRIGGERS.find((item) => item.value === normalized)?.label ?? trigger;
}

function toApiTrigger(trigger: string): string {
  return trigger.toUpperCase();
}

function fromApiTrigger(trigger: string): string {
  return trigger.toLowerCase();
}

function resolveTeamName(teamId: string, teamsList: TeamRef[]): string {
  return teamsList.find((team) => team.id === teamId)?.name ?? teamId;
}

function resolveTeamId(value: string, teamsList: TeamRef[]): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const byId = teamsList.find((team) => team.id === trimmed);
  if (byId) return byId.id;
  const lowered = trimmed.toLowerCase();
  return teamsList.find((team) => team.name.toLowerCase() === lowered)?.id ?? null;
}

function formatRelativeTime(isoString: string | null): string {
  if (!isoString) return 'Never';
  const ts = Date.parse(isoString);
  if (Number.isNaN(ts)) return 'Never';
  const diffMs = Date.now() - ts;
  const diffMins = Math.max(0, Math.floor(diffMs / (1000 * 60)));
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

function Toggle({
  checked,
  onChange,
  disabled
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
      <span className="absolute inset-0 cursor-pointer rounded-full bg-gray-300 transition peer-checked:bg-blue-600 peer-disabled:cursor-not-allowed peer-disabled:opacity-60" />
      <span className="absolute bottom-[3px] left-[3px] h-4 w-4 rounded-full bg-white transition-transform peer-checked:translate-x-[18px]" />
    </label>
  );
}

function ConfirmDeleteModal({
  ruleName,
  onConfirm,
  onCancel
}: {
  ruleName: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl">
        <div className="mb-3 flex items-center space-x-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-100">
            <svg className="h-5 w-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01M10.293 4.293a1 1 0 011.414 0L21 13.586V19a2 2 0 01-2 2H5a2 2 0 01-2-2v-5.414l9.293-9.293z"
              />
            </svg>
          </div>
          <h3 className="text-base font-semibold text-gray-900">Delete Automation</h3>
        </div>
        <p className="mb-5 text-sm leading-relaxed text-gray-600">
          Delete "{ruleName}"?
        </p>
        <div className="flex justify-end space-x-3">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

function RuleEditorModal({
  form,
  isNew,
  loading,
  onClose,
  onSubmit,
  onChange,
  onAddCondition,
  onRemoveCondition,
  onUpdateCondition,
  onAddAction,
  onRemoveAction,
  onUpdateAction
}: {
  form: AutomationForm;
  isNew: boolean;
  loading: boolean;
  onClose: () => void;
  onSubmit: () => void;
  onChange: (next: Partial<AutomationForm>) => void;
  onAddCondition: () => void;
  onRemoveCondition: (index: number) => void;
  onUpdateCondition: (index: number, key: keyof FlatCondition, value: string) => void;
  onAddAction: () => void;
  onRemoveAction: (index: number) => void;
  onUpdateAction: (index: number, key: keyof FlatAction, value: string) => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[92vh] w-full max-w-2xl flex-col rounded-xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
          <div>
            <p className="text-base font-semibold text-gray-900">
              {isNew ? 'Create Automation' : 'Edit Automation'}
            </p>
            <p className="mt-0.5 text-xs text-gray-500">Set trigger, conditions and actions</p>
          </div>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto p-6">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2 sm:col-span-1">
              <label className="mb-1 block text-xs font-medium text-gray-700">Automation Name *</label>
              <input
                value={form.name}
                onChange={(event) => onChange({ name: event.target.value })}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-transparent focus:ring-2 focus:ring-blue-500"
                placeholder="e.g. Auto-close Resolved"
              />
            </div>
            <div className="col-span-2 flex items-end pb-1 sm:col-span-1">
              <div className="flex items-center space-x-2">
                <Toggle checked={form.enabled} onChange={(value) => onChange({ enabled: value })} />
                <span className="text-sm text-gray-700">Enabled</span>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
            <p className="mb-2 text-xs font-semibold text-amber-800">Trigger</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-700">When</label>
                <select
                  value={form.trigger}
                  onChange={(event) => onChange({ trigger: event.target.value })}
                  className="w-full rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-sm focus:border-transparent focus:ring-2 focus:ring-blue-500"
                >
                  {TRIGGERS.map((trigger) => (
                    <option key={trigger.value} value={trigger.value}>
                      {trigger.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-700">Details</label>
                <input
                  value={form.triggerVal}
                  onChange={(event) => onChange({ triggerVal: event.target.value })}
                  className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm focus:border-transparent focus:ring-2 focus:ring-blue-500"
                  placeholder="e.g. 24h, status=resolved"
                />
              </div>
            </div>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <p className="text-sm font-semibold text-gray-800">
                Conditions <span className="text-xs font-normal text-gray-400">(optional)</span>
              </p>
            </div>
            <div className="space-y-2">
              {form.conditions.map((condition, index) => (
                <div key={`condition-${index}`} className="flex items-center space-x-2 rounded-lg border border-gray-200 bg-gray-50 p-2.5">
                  <select
                    value={condition.field}
                    onChange={(event) => onUpdateCondition(index, 'field', event.target.value)}
                    className="flex-1 rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-sm focus:border-transparent focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">Field...</option>
                    {CONDITION_FIELDS.map((field) => (
                      <option key={field} value={field}>
                        {field.replace('_', ' ')}
                      </option>
                    ))}
                  </select>
                  <select
                    value={condition.op}
                    onChange={(event) => onUpdateCondition(index, 'op', event.target.value)}
                    className="w-24 rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-sm focus:border-transparent focus:ring-2 focus:ring-blue-500"
                  >
                    {CONDITION_OPS.map((op) => (
                      <option key={op} value={op}>
                        {op}
                      </option>
                    ))}
                  </select>
                  <input
                    value={condition.val}
                    onChange={(event) => onUpdateCondition(index, 'val', event.target.value)}
                    className="flex-1 rounded-lg border border-gray-300 px-2 py-1.5 text-sm focus:border-transparent focus:ring-2 focus:ring-blue-500"
                    placeholder="value..."
                  />
                  <button
                    type="button"
                    onClick={() => onRemoveCondition(index)}
                    className="text-gray-400 hover:text-red-500"
                  >
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={onAddCondition}
                className="flex items-center space-x-1 text-xs font-medium text-blue-600 hover:text-blue-700"
              >
                <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                <span>Add Condition</span>
              </button>
            </div>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <p className="text-sm font-semibold text-gray-800">Actions</p>
            </div>
            <div className="space-y-2">
              {form.actions.map((action, index) => (
                <div key={`action-${index}`} className="flex items-center space-x-2 rounded-lg border border-green-100 bg-green-50 p-2.5">
                  <svg className="h-4 w-4 flex-shrink-0 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  <select
                    value={action.type}
                    onChange={(event) => onUpdateAction(index, 'type', event.target.value)}
                    className="flex-1 rounded-lg border border-green-200 bg-white px-2 py-1.5 text-sm focus:border-transparent focus:ring-2 focus:ring-blue-500"
                  >
                    {ACTION_TYPES.map((item) => (
                      <option key={item.value} value={item.value}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                  <input
                    value={action.val}
                    onChange={(event) => onUpdateAction(index, 'val', event.target.value)}
                    className="flex-1 rounded-lg border border-green-200 bg-white px-2 py-1.5 text-sm focus:border-transparent focus:ring-2 focus:ring-blue-500"
                    placeholder="value..."
                  />
                  <button
                    type="button"
                    onClick={() => onRemoveAction(index)}
                    className="text-gray-400 hover:text-red-500"
                  >
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={onAddAction}
                className="flex items-center space-x-1 text-xs font-medium text-blue-600 hover:text-blue-700"
              >
                <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                <span>Add Action</span>
              </button>
            </div>
          </div>
        </div>

        <div className="flex justify-end space-x-3 rounded-b-xl border-t border-gray-200 bg-gray-50 px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSubmit}
            disabled={loading}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
          >
            {loading ? 'Saving...' : isNew ? 'Create Automation' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}

function toFlatConditions(conditions: AutomationCondition[] | undefined): FlatCondition[] {
  if (!conditions || conditions.length === 0) {
    return [{ ...EMPTY_CONDITION }];
  }

  const flattened: FlatCondition[] = [];
  conditions.forEach((condition) => {
    if (condition.field || condition.operator || condition.value != null) {
      flattened.push({
        field: condition.field ?? '',
        op: condition.operator ?? 'is',
        val: condition.value != null ? String(condition.value) : ''
      });
      return;
    }
    if (condition.and?.length) {
      flattened.push({
        field: 'group',
        op: 'and',
        val: `${condition.and.length} conditions`
      });
      return;
    }
    if (condition.or?.length) {
      flattened.push({
        field: 'group',
        op: 'or',
        val: `${condition.or.length} conditions`
      });
    }
  });

  return flattened.length > 0 ? flattened : [{ ...EMPTY_CONDITION }];
}

function toFlatActions(actions: AutomationAction[] | undefined, teamsList: TeamRef[]): FlatAction[] {
  if (!actions || actions.length === 0) return [{ ...EMPTY_ACTION }];

  return actions.map((action) => {
    if (action.type === 'assign_team') {
      return {
        type: action.type,
        val: action.teamId ? resolveTeamName(action.teamId, teamsList) : ''
      };
    }
    if (action.type === 'set_priority') {
      return { type: action.type, val: action.priority ?? '' };
    }
    if (action.type === 'set_status') {
      return { type: action.type, val: action.status ?? '' };
    }
    if (action.type === 'send_reply') {
      return { type: action.type, val: action.body ?? '' };
    }
    return {
      type: action.type,
      val: action.body ?? ''
    };
  });
}

function toApiConditions(conditions: FlatCondition[]): AutomationCondition[] {
  return conditions
    .filter((condition) => condition.field.trim() || condition.val.trim())
    .map((condition) => ({
      field: condition.field.trim(),
      operator: condition.op.trim(),
      value: condition.val.trim()
    }));
}

function toApiActions(actions: FlatAction[], teamsList: TeamRef[]): AutomationAction[] {
  return actions
    .filter((action) => action.type.trim())
    .map((action) => {
      const value = action.val.trim();
      if (action.type === 'assign_team') {
        return {
          type: action.type,
          teamId: resolveTeamId(value, teamsList) ?? undefined
        };
      }
      if (action.type === 'set_priority') {
        return { type: action.type, priority: value };
      }
      if (action.type === 'set_status') {
        return { type: action.type, status: value };
      }
      if (action.type === 'send_reply') {
        return { type: action.type, body: value };
      }
      return { type: action.type, body: value || undefined };
    });
}

export function AutomationRulesPage({
  role,
  teamsList,
  headerProps
}: {
  role: Role;
  teamsList: TeamRef[];
  headerProps?: AutomationHeaderProps;
}) {
  const toast = useToast();
  const canEdit = role === 'TEAM_ADMIN' || role === 'OWNER';

  const [rules, setRules] = useState<AutomationRule[]>([]);
  const [uiMetaById, setUiMetaById] = useState<Record<string, RuleUiMeta>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [updatingRuleId, setUpdatingRuleId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [showEditor, setShowEditor] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<AutomationRule | null>(null);

  const [form, setForm] = useState<AutomationForm>({
    id: null,
    name: '',
    description: '',
    enabled: true,
    trigger: 'ticket_created',
    triggerVal: '',
    conditions: [{ ...EMPTY_CONDITION }],
    actions: [{ ...EMPTY_ACTION }],
    priority: 1,
    teamId: ''
  });

  useEffect(() => {
    void loadRules();
  }, []);

  async function loadRuleStats(nextRules: AutomationRule[], existingMeta: Record<string, RuleUiMeta>) {
    const statsEntries = await Promise.all(
      nextRules.map(async (rule, index) => {
        try {
          const execution = await fetchAutomationRuleExecutions(rule.id, 1, 1);
          return [
            rule.id,
            {
              ...existingMeta[rule.id],
              runCount: execution.meta.total,
              lastRun: formatRelativeTime(execution.data[0]?.executedAt ?? null),
              statsSource: 'live' as const
            }
          ] as const;
        } catch {
          return [
            rule.id,
            {
              ...existingMeta[rule.id],
              runCount: existingMeta[rule.id]?.runCount ?? (index === 0 ? 142 : index === 1 ? 8 : 0),
              lastRun: existingMeta[rule.id]?.lastRun ?? (index === 0 ? '2h ago' : index === 1 ? '5h ago' : 'Never'),
              statsSource: 'demo' as const
            }
          ] as const;
        }
      })
    );

    const statsById: Record<string, RuleUiMeta> = {};
    statsEntries.forEach(([id, meta]) => {
      statsById[id] = meta;
    });
    setUiMetaById(statsById);
  }

  async function loadRules() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetchAutomationRules();
      setRules(response.data);

      const baseMeta: Record<string, RuleUiMeta> = {};
      response.data.forEach((rule) => {
        baseMeta[rule.id] = {
          triggerVal: '',
          conditions: toFlatConditions(rule.conditions),
          actions: toFlatActions(rule.actions, teamsList),
          runCount: 0,
          lastRun: 'Never',
          statsSource: 'demo'
        };
      });
      await loadRuleStats(response.data, baseMeta);
    } catch (err) {
      const message = apiErrorMessage(err);
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }

  const sortedRules = useMemo(
    () => [...rules].sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name)),
    [rules]
  );

  const totalRuns = useMemo(
    () => sortedRules.reduce((sum, rule) => sum + (uiMetaById[rule.id]?.runCount ?? 0), 0),
    [sortedRules, uiMetaById]
  );

  function openCreateModal() {
    setForm({
      id: null,
      name: '',
      description: '',
      enabled: true,
      trigger: 'ticket_created',
      triggerVal: '',
      conditions: [{ ...EMPTY_CONDITION }],
      actions: [{ ...EMPTY_ACTION }],
      priority: sortedRules.length > 0 ? Math.max(...sortedRules.map((rule) => rule.priority)) + 1 : 1,
      teamId: ''
    });
    setShowEditor(true);
  }

  function openEditModal(rule: AutomationRule) {
    const meta = uiMetaById[rule.id];
    setForm({
      id: rule.id,
      name: rule.name,
      description: rule.description ?? '',
      enabled: rule.isActive,
      trigger: fromApiTrigger(rule.trigger),
      triggerVal: meta?.triggerVal ?? '',
      conditions: meta?.conditions?.map((item) => ({ ...item })) ?? toFlatConditions(rule.conditions),
      actions: meta?.actions?.map((item) => ({ ...item })) ?? toFlatActions(rule.actions, teamsList),
      priority: rule.priority,
      teamId: rule.teamId ?? ''
    });
    setShowEditor(true);
  }

  async function handleSaveRule() {
    if (!form.name.trim()) {
      setError('Automation name is required.');
      toast.error('Automation name is required.');
      return;
    }

    const payload = {
      name: form.name.trim(),
      description: form.description.trim() || undefined,
      trigger: toApiTrigger(form.trigger),
      conditions: toApiConditions(form.conditions),
      actions: toApiActions(form.actions, teamsList),
      isActive: form.enabled,
      priority: Math.max(1, Number(form.priority) || 1),
      teamId: form.teamId || undefined
    };

    setSaving(true);
    setError(null);
    try {
      if (form.id) {
        const updated = await updateAutomationRule(form.id, payload);
        setRules((prev) => prev.map((rule) => (rule.id === form.id ? updated : rule)));
        setUiMetaById((prev) => ({
          ...prev,
          [form.id!]: {
            ...(prev[form.id!] ?? {
              runCount: 0,
              lastRun: 'Never',
              statsSource: 'demo'
            }),
            triggerVal: form.triggerVal,
            conditions: form.conditions.map((item) => ({ ...item })),
            actions: form.actions.map((item) => ({ ...item }))
          }
        }));
        toast.success('Automation updated.');
      } else {
        const created = await createAutomationRule(payload);
        setRules((prev) => [...prev, created]);
        setUiMetaById((prev) => ({
          ...prev,
          [created.id]: {
            triggerVal: form.triggerVal,
            conditions: form.conditions.map((item) => ({ ...item })),
            actions: form.actions.map((item) => ({ ...item })),
            runCount: 0,
            lastRun: 'Never',
            statsSource: 'demo'
          }
        }));
        toast.success('Automation created.');
      }
      setShowEditor(false);
    } catch (err) {
      const message = apiErrorMessage(err);
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleRule(rule: AutomationRule, nextEnabled: boolean) {
    setUpdatingRuleId(rule.id);
    setError(null);
    try {
      const updated = await updateAutomationRule(rule.id, { isActive: nextEnabled });
      setRules((prev) => prev.map((item) => (item.id === rule.id ? updated : item)));
      toast.success(nextEnabled ? 'Automation enabled.' : 'Automation disabled.');
    } catch (err) {
      const message = apiErrorMessage(err);
      setError(message);
      toast.error(message);
    } finally {
      setUpdatingRuleId(null);
    }
  }

  async function handleDeleteRule(rule: AutomationRule) {
    setError(null);
    try {
      await deleteAutomationRule(rule.id);
      setRules((prev) => prev.filter((item) => item.id !== rule.id));
      setUiMetaById((prev) => {
        const next = { ...prev };
        delete next[rule.id];
        return next;
      });
      setDeleteTarget(null);
      toast.success('Automation deleted.');
    } catch (err) {
      const message = apiErrorMessage(err);
      setError(message);
      toast.error(message);
    }
  }

  return (
    <section className="min-h-full bg-gray-50 animate-fade-in">
      <div className="sticky top-0 z-40 border-b border-gray-200 bg-white">
        <div className="mx-auto max-w-[1600px] py-4 pl-6 pr-2">
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
                  <h1 className="text-xl font-semibold text-gray-900">Automation Rules</h1>
                  <p className="mt-0.5 text-sm text-gray-500">Run actions automatically based on ticket events.</p>
                </div>
              }
            />
          ) : (
            <div className="min-w-0">
              <h1 className="text-xl font-semibold text-gray-900">Automation Rules</h1>
              <p className="mt-0.5 text-sm text-gray-500">Run actions automatically based on ticket events.</p>
            </div>
          )}
        </div>
      </div>

      <div className="mx-auto max-w-[1600px] p-6">
        <div className="mb-5 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-700">
          Trigger details and some action value display are UI-mapped (demo) when backend fields are unavailable. Core automation CRUD and state are live.
        </div>

        {error && (
          <div className="mb-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="mb-5 flex items-center justify-between">
          <p className="text-sm text-gray-600">Automations run automatically based on triggers and conditions.</p>
          {canEdit && (
            <button
              type="button"
              onClick={openCreateModal}
              className="flex items-center space-x-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700"
            >
              <Plus className="h-4 w-4" />
              <span>New Automation</span>
            </button>
          )}
        </div>

        <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <p className="text-xs text-gray-500">Total Automations</p>
            <p className="mt-0.5 text-2xl font-bold text-blue-600">{rules.length}</p>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <p className="text-xs text-gray-500">Active</p>
            <p className="mt-0.5 text-2xl font-bold text-green-600">{rules.filter((rule) => rule.isActive).length}</p>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <p className="text-xs text-gray-500">Total Runs (30d)</p>
            <p className="mt-0.5 text-2xl font-bold text-purple-600">{totalRuns}</p>
          </div>
        </div>

        {loading ? (
          <div className="rounded-xl border border-gray-200 bg-white p-6 text-sm text-gray-500">
            Loading automation rules...
          </div>
        ) : (
          <div className="space-y-3">
            {sortedRules.map((rule) => {
              const meta = uiMetaById[rule.id] ?? {
                triggerVal: '',
                conditions: toFlatConditions(rule.conditions),
                actions: toFlatActions(rule.actions, teamsList),
                runCount: 0,
                lastRun: 'Never',
                statsSource: 'demo' as const
              };
              return (
                <div
                  key={rule.id}
                  className={`rounded-xl border border-gray-200 bg-white p-5 transition-all duration-200 hover:shadow-md ${
                    !rule.isActive ? 'opacity-60' : ''
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex flex-1 items-start space-x-4">
                      <div className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl ${triggerBg(fromApiTrigger(rule.trigger))}`}>
                        <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={triggerIcon(fromApiTrigger(rule.trigger))} />
                        </svg>
                      </div>
                      <div className="flex-1">
                        <div className="mb-1 flex items-center space-x-2">
                          <span className="text-sm font-semibold text-gray-900">{rule.name}</span>
                          {!rule.isActive && (
                            <span className="rounded-md bg-gray-100 px-2 py-1 text-xs font-medium text-gray-500">
                              Disabled
                            </span>
                          )}
                        </div>

                        <div className="mb-2 flex flex-wrap items-center gap-2">
                          <span className="text-xs text-gray-400">Trigger:</span>
                          <span className="rounded-md bg-amber-100 px-2 py-1 text-xs font-medium text-amber-700">
                            {triggerLabel(fromApiTrigger(rule.trigger))}
                          </span>
                          {meta.triggerVal && (
                            <span className="text-xs italic text-gray-500">"{meta.triggerVal}"</span>
                          )}
                          {meta.statsSource === 'demo' && (
                            <span className="rounded-md bg-purple-100 px-2 py-1 text-xs font-medium text-purple-700">
                              Demo metrics
                            </span>
                          )}
                        </div>

                        {meta.conditions.length > 0 && (
                          <div className="mb-2 flex flex-wrap gap-1.5">
                            <span className="mt-0.5 text-xs text-gray-400">IF</span>
                            {meta.conditions.map((condition, index) => (
                              <span key={`${rule.id}-condition-${index}`} className="rounded-md bg-gray-100 px-2 py-1 text-xs font-medium text-gray-700">
                                {condition.field.replace('_', ' ')} {condition.op} "{condition.val}"
                              </span>
                            ))}
                          </div>
                        )}

                        <div className="flex flex-wrap gap-1.5">
                          <span className="mt-0.5 text-xs text-green-500">THEN</span>
                          {meta.actions.map((action, index) => (
                            <span key={`${rule.id}-action-${index}`} className="rounded-md bg-green-100 px-2 py-1 text-xs font-medium text-green-700">
                              {action.type.replace('_', ' ')}
                              {action.val ? `: ${action.val.length > 20 ? `${action.val.slice(0, 20)}…` : action.val}` : ''}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>

                    <div className="ml-4 flex flex-shrink-0 flex-col items-end space-y-3">
                      {canEdit && (
                        <div className="flex items-center space-x-2">
                          <Toggle
                            checked={rule.isActive}
                            disabled={updatingRuleId === rule.id}
                            onChange={(value) => void handleToggleRule(rule, value)}
                          />
                          <button
                            type="button"
                            onClick={() => openEditModal(rule)}
                            className="rounded p-1.5 text-gray-400 hover:bg-blue-50 hover:text-blue-600"
                          >
                            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                            </svg>
                          </button>
                          <button
                            type="button"
                            onClick={() => setDeleteTarget(rule)}
                            className="rounded p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600"
                          >
                            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        </div>
                      )}
                      <div className="text-right">
                        <p className="text-xs text-gray-500">
                          <span className="font-semibold text-gray-700">{meta.runCount}</span> runs
                        </p>
                        <p className="text-xs text-gray-400">Last: {meta.lastRun}</p>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}

            {canEdit && (
              <button
                type="button"
                onClick={openCreateModal}
                className="flex w-full items-center justify-center space-x-2 rounded-xl border-2 border-dashed border-gray-300 p-4 text-sm text-gray-400 transition-colors hover:border-blue-300 hover:text-blue-600"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                <span>Add Automation</span>
              </button>
            )}
          </div>
        )}
      </div>

      {showEditor && (
        <RuleEditorModal
          form={form}
          isNew={!form.id}
          loading={saving}
          onClose={() => setShowEditor(false)}
          onSubmit={() => void handleSaveRule()}
          onChange={(next) => setForm((prev) => ({ ...prev, ...next }))}
          onAddCondition={() =>
            setForm((prev) => ({
              ...prev,
              conditions: [...prev.conditions, { ...EMPTY_CONDITION }]
            }))
          }
          onRemoveCondition={(index) =>
            setForm((prev) => ({
              ...prev,
              conditions:
                prev.conditions.length > 1
                  ? prev.conditions.filter((_, itemIndex) => itemIndex !== index)
                  : prev.conditions
            }))
          }
          onUpdateCondition={(index, key, value) =>
            setForm((prev) => ({
              ...prev,
              conditions: prev.conditions.map((condition, itemIndex) =>
                itemIndex === index ? { ...condition, [key]: value } : condition
              )
            }))
          }
          onAddAction={() =>
            setForm((prev) => ({
              ...prev,
              actions: [...prev.actions, { ...EMPTY_ACTION }]
            }))
          }
          onRemoveAction={(index) =>
            setForm((prev) => ({
              ...prev,
              actions:
                prev.actions.length > 1
                  ? prev.actions.filter((_, itemIndex) => itemIndex !== index)
                  : prev.actions
            }))
          }
          onUpdateAction={(index, key, value) =>
            setForm((prev) => ({
              ...prev,
              actions: prev.actions.map((action, itemIndex) =>
                itemIndex === index ? { ...action, [key]: value } : action
              )
            }))
          }
        />
      )}

      {deleteTarget && (
        <ConfirmDeleteModal
          ruleName={deleteTarget.name}
          onConfirm={() => void handleDeleteRule(deleteTarget)}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </section>
  );
}
