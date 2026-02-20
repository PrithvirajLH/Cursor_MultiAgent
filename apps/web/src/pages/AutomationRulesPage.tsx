import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import {
  createAutomationRule,
  deleteAutomationRule,
  fetchAllUsers,
  fetchTeamMembers,
  fetchAutomationRuleExecutions,
  fetchAutomationRules,
  type AutomationAction,
  type AutomationCondition,
  type AutomationRule,
  type TeamRef,
  type UserRef,
  updateAutomationRule
} from '../api/client';
import { TopBar } from '../components/TopBar';
import { useHeaderContext } from '../contexts/HeaderContext';
import type { Role } from '../types';
import { useToast } from '../hooks/useToast';
import { useModalFocusTrap } from '../hooks/useModalFocusTrap';
import { handleApiError } from '../utils/handleApiError';

type FlatCondition = {
  field: string;
  op: string;
  val: string;
};

type FlatAction = {
  type: string;
  val: string;
};

type UserOption = {
  id: string;
  label: string;
  email: string;
  role?: string;
};

type RuleUiMeta = {
  conditions: FlatCondition[];
  actions: FlatAction[];
  runCount: number;
  lastRun: string;
};

type AutomationForm = {
  id: string | null;
  name: string;
  description: string;
  enabled: boolean;
  trigger: string;
  conditions: FlatCondition[];
  actions: FlatAction[];
  priority: number;
  teamId: string;
  sourceConditions: AutomationCondition[] | null;
  conditionTreeLocked: boolean;
};

const TRIGGERS = [
  { value: 'TICKET_CREATED', label: 'Ticket Created' },
  { value: 'STATUS_CHANGED', label: 'Status Changed' },
  { value: 'SLA_APPROACHING', label: 'SLA Approaching' },
  { value: 'SLA_BREACHED', label: 'SLA Breached' }
];

const ACTION_TYPES = [
  { value: 'set_status', label: 'Set Status' },
  { value: 'assign_team', label: 'Assign Team' },
  { value: 'assign_user', label: 'Assign User' },
  { value: 'notify_team_lead', label: 'Notify Team Lead' },
  { value: 'add_internal_note', label: 'Add Internal Note' },
  { value: 'set_priority', label: 'Set Priority' }
];

const CONDITION_FIELDS = ['subject', 'description', 'priority', 'status', 'assignedTeamId', 'assigneeId', 'categoryId', 'requesterId'];
const CONDITION_OPS = ['contains', 'equals', 'notEquals', 'in', 'notIn', 'isEmpty', 'isNotEmpty'];
const PRIORITY_OPTIONS = ['P1', 'P2', 'P3', 'P4'];
const STATUS_OPTIONS = [
  'NEW',
  'TRIAGED',
  'ASSIGNED',
  'IN_PROGRESS',
  'WAITING_ON_REQUESTER',
  'WAITING_ON_VENDOR',
  'RESOLVED',
  'CLOSED',
  'REOPENED',
];

const EMPTY_CONDITION: FlatCondition = { field: 'status', op: 'equals', val: '' };
const EMPTY_ACTION: FlatAction = { type: 'set_status', val: '' };

function triggerIcon(trigger: string): string {
  if (trigger === 'SLA_APPROACHING') return 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z';
  if (trigger === 'SLA_BREACHED') {
    return 'M12 9v2m0 4h.01M10.293 4.293a1 1 0 011.414 0L21 13.586V19a2 2 0 01-2 2H5a2 2 0 01-2-2v-5.414l9.293-9.293z';
  }
  return 'M13 10V3L4 14h7v7l9-11h-7z';
}

function triggerBg(trigger: string): string {
  if (trigger === 'SLA_BREACHED') return 'bg-red-100 text-red-600';
  if (trigger === 'SLA_APPROACHING') return 'bg-purple-100 text-purple-600';
  return 'bg-green-100 text-green-600';
}

function triggerLabel(trigger: string): string {
  return TRIGGERS.find((item) => item.value === trigger)?.label ?? trigger;
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

function resolveUserName(userId: string, users: UserOption[]): string {
  return users.find((user) => user.id === userId)?.label ?? userId;
}

function resolveTeamAdminScopeTeamId(teamsList: TeamRef[]): string {
  return teamsList.length === 1 ? teamsList[0].id : '';
}

function resolveTeamAdminScopeTeamName(teamsList: TeamRef[]): string {
  return teamsList.length === 1 ? teamsList[0].name : 'Primary Team (unavailable)';
}

function hasConditionGroups(conditions: AutomationCondition[] | undefined): boolean {
  if (!conditions || conditions.length === 0) return false;

  function visit(node: AutomationCondition): boolean {
    if (node.and?.length) return true;
    if (node.or?.length) return true;
    return false;
  }

  return conditions.some((condition) => visit(condition));
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
      <span className="absolute inset-0 cursor-pointer rounded-full bg-slate-300 transition peer-checked:bg-blue-600 peer-disabled:cursor-not-allowed peer-disabled:opacity-60" />
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
  const dialogRef = useRef<HTMLDivElement>(null);
  useModalFocusTrap({ open: true, containerRef: dialogRef, onClose: onCancel });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Delete automation rule"
        tabIndex={-1}
        className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl"
      >
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
          <h3 className="text-base font-semibold text-slate-900">Delete Automation</h3>
        </div>
        <p className="mb-5 text-sm leading-relaxed text-slate-600">
          Delete "{ruleName}"?
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
  role,
  teamsList,
  teamAdminScopeName,
  assignableUserOptions,
  assignableUsersLoading,
  assignableUsersHint,
  conditionEditingLocked,
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
  role: Role;
  teamsList: TeamRef[];
  teamAdminScopeName: string;
  assignableUserOptions: UserOption[];
  assignableUsersLoading: boolean;
  assignableUsersHint: string | null;
  conditionEditingLocked: boolean;
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
  const isTeamAdmin = role === 'TEAM_ADMIN';
  const dialogRef = useRef<HTMLDivElement>(null);
  useModalFocusTrap({ open: true, containerRef: dialogRef, onClose });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={isNew ? 'Create automation rule' : 'Edit automation rule'}
        tabIndex={-1}
        className="flex max-h-[92vh] w-full max-w-2xl flex-col rounded-xl bg-white shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <div>
            <p className="text-base font-semibold text-slate-900">
              {isNew ? 'Create Automation' : 'Edit Automation'}
            </p>
            <p className="mt-0.5 text-xs text-slate-500">Set trigger, conditions and actions</p>
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto p-6">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2 sm:col-span-1">
              <label className="mb-1 block text-xs font-medium text-slate-700">Automation Name *</label>
              <input
                value={form.name}
                onChange={(event) => onChange({ name: event.target.value })}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-transparent focus:ring-2 focus:ring-blue-500"
                placeholder="e.g. Auto-close Resolved"
              />
            </div>
            <div className="col-span-2 sm:col-span-1">
              <label className="mb-1 block text-xs font-medium text-slate-700">Scope</label>
              {isTeamAdmin ? (
                <input
                  value={teamAdminScopeName}
                  disabled
                  className="w-full rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 text-sm text-slate-600"
                />
              ) : (
                <select
                  value={form.teamId}
                  onChange={(event) => onChange({ teamId: event.target.value })}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-transparent focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Global (all teams)</option>
                  {teamsList.map((team) => (
                    <option key={team.id} value={team.id}>
                      {team.name}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <div className="col-span-2 flex items-end pb-1 sm:col-span-2">
              <div className="flex items-center space-x-2">
                <Toggle checked={form.enabled} onChange={(value) => onChange({ enabled: value })} />
                <span className="text-sm text-slate-700">Enabled</span>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
            <p className="mb-2 text-xs font-semibold text-amber-800">Trigger</p>
            <div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-700">When</label>
                <select
                  value={form.trigger}
                  onChange={(event) => onChange({ trigger: event.target.value })}
                  className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm focus:border-transparent focus:ring-2 focus:ring-blue-500"
                >
                  {TRIGGERS.map((trigger) => (
                    <option key={trigger.value} value={trigger.value}>
                      {trigger.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <p className="text-sm font-semibold text-slate-800">Conditions</p>
            </div>
            {conditionEditingLocked && (
              <div className="mb-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                This rule uses nested AND/OR groups. Condition editing is locked to prevent losing rule logic.
              </div>
            )}
            <div className="space-y-2">
              {form.conditions.map((condition, index) => (
                <div key={`condition-${index}`} className="flex items-center space-x-2 rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                  <select
                    value={condition.field}
                    onChange={(event) => onUpdateCondition(index, 'field', event.target.value)}
                    disabled={conditionEditingLocked}
                    className="flex-1 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm focus:border-transparent focus:ring-2 focus:ring-blue-500"
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
                    disabled={conditionEditingLocked}
                    className="w-24 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm focus:border-transparent focus:ring-2 focus:ring-blue-500"
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
                    disabled={conditionEditingLocked}
                    className="flex-1 rounded-lg border border-slate-300 px-2 py-1.5 text-sm focus:border-transparent focus:ring-2 focus:ring-blue-500"
                    placeholder="value..."
                  />
                  <button
                    type="button"
                    onClick={() => onRemoveCondition(index)}
                    disabled={conditionEditingLocked}
                    className="text-slate-400 hover:text-red-500 disabled:cursor-not-allowed disabled:opacity-40"
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
                disabled={conditionEditingLocked}
                className="flex items-center space-x-1 text-xs font-medium text-blue-600 hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
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
              <p className="text-sm font-semibold text-slate-800">Actions</p>
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
                  {action.type === 'assign_team' ? (
                    <select
                      value={action.val}
                      onChange={(event) => onUpdateAction(index, 'val', event.target.value)}
                      className="flex-1 rounded-lg border border-green-200 bg-white px-2 py-1.5 text-sm focus:border-transparent focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="">Select team...</option>
                      {teamsList.map((team) => (
                        <option key={team.id} value={team.id}>
                          {team.name}
                        </option>
                      ))}
                    </select>
                  ) : action.type === 'assign_user' ? (
                    <select
                      value={action.val}
                      onChange={(event) => onUpdateAction(index, 'val', event.target.value)}
                      className="flex-1 rounded-lg border border-green-200 bg-white px-2 py-1.5 text-sm focus:border-transparent focus:ring-2 focus:ring-blue-500"
                      disabled={assignableUsersLoading || !!assignableUsersHint}
                    >
                      <option value="">
                        {assignableUsersLoading
                          ? 'Loading users...'
                          : assignableUsersHint ?? 'Select user...'}
                      </option>
                      {assignableUserOptions.map((user) => (
                        <option key={user.id} value={user.id}>
                          {user.label}
                        </option>
                      ))}
                    </select>
                  ) : action.type === 'set_priority' ? (
                    <select
                      value={action.val}
                      onChange={(event) => onUpdateAction(index, 'val', event.target.value)}
                      className="flex-1 rounded-lg border border-green-200 bg-white px-2 py-1.5 text-sm focus:border-transparent focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="">Select priority...</option>
                      {PRIORITY_OPTIONS.map((priority) => (
                        <option key={priority} value={priority}>
                          {priority}
                        </option>
                      ))}
                    </select>
                  ) : action.type === 'set_status' ? (
                    <select
                      value={action.val}
                      onChange={(event) => onUpdateAction(index, 'val', event.target.value)}
                      className="flex-1 rounded-lg border border-green-200 bg-white px-2 py-1.5 text-sm focus:border-transparent focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="">Select status...</option>
                      {STATUS_OPTIONS.map((status) => (
                        <option key={status} value={status}>
                          {status}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      value={action.val}
                      onChange={(event) => onUpdateAction(index, 'val', event.target.value)}
                      className="flex-1 rounded-lg border border-green-200 bg-white px-2 py-1.5 text-sm focus:border-transparent focus:ring-2 focus:ring-blue-500"
                      placeholder="value..."
                    />
                  )}
                  <button
                    type="button"
                    onClick={() => onRemoveAction(index)}
                    className="text-slate-400 hover:text-red-500"
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

        <div className="flex justify-end space-x-3 rounded-b-xl border-t border-slate-200 bg-slate-50 px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
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

  function flatten(node: AutomationCondition): FlatCondition[] {
    if (node.and?.length) {
      return node.and.flatMap((child) => flatten(child));
    }
    if (node.or?.length) {
      return node.or.flatMap((child) => flatten(child));
    }
    if (node.field || node.operator || node.value != null) {
      return [
        {
          field: node.field ?? '',
          op: node.operator ?? 'equals',
          val: node.value != null ? String(node.value) : ''
        }
      ];
    }
    return [];
  }

  const flattened: FlatCondition[] = [];
  conditions.forEach((condition) => {
    flattened.push(...flatten(condition));
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
    if (action.type === 'assign_user') {
      return { type: action.type, val: action.userId ?? '' };
    }
    if (action.type === 'add_internal_note') {
      return { type: action.type, val: action.body ?? '' };
    }
    if (action.type === 'notify_team_lead') {
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
    .map((condition) => {
      const op = condition.op.trim();
      if (op === 'isEmpty' || op === 'isNotEmpty') {
        return {
          field: condition.field.trim(),
          operator: op
        };
      }
      if (op === 'in' || op === 'notIn') {
        return {
          field: condition.field.trim(),
          operator: op,
          value: condition.val
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean)
        };
      }
      return {
        field: condition.field.trim(),
        operator: op,
        value: condition.val.trim()
      };
    });
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
      if (action.type === 'assign_user') {
        return { type: action.type, userId: value || undefined };
      }
      if (action.type === 'add_internal_note') {
        return { type: action.type, body: value };
      }
      if (action.type === 'notify_team_lead') {
        return { type: action.type, body: value };
      }
      return { type: action.type, body: value || undefined };
    });
}

export function AutomationRulesPage({
  role,
  teamsList
}: {
  role: Role;
  teamsList: TeamRef[];
}) {
  const headerCtx = useHeaderContext();
  const toast = useToast();
  const canEdit = role === 'TEAM_ADMIN' || role === 'OWNER';
  const teamAdminScopeTeamId = useMemo(
    () => (role === 'TEAM_ADMIN' ? resolveTeamAdminScopeTeamId(teamsList) : ''),
    [role, teamsList]
  );
  const teamAdminScopeTeamName = useMemo(
    () => (role === 'TEAM_ADMIN' ? resolveTeamAdminScopeTeamName(teamsList) : ''),
    [role, teamsList]
  );

  const [rules, setRules] = useState<AutomationRule[]>([]);
  const [uiMetaById, setUiMetaById] = useState<Record<string, RuleUiMeta>>({});
  const [allUserOptions, setAllUserOptions] = useState<UserOption[]>([]);
  const [assignableUserOptions, setAssignableUserOptions] = useState<UserOption[]>([]);
  const [allUsersLoading, setAllUsersLoading] = useState(false);
  const [assignableUsersLoading, setAssignableUsersLoading] = useState(false);
  const [assignableUsersHint, setAssignableUsersHint] = useState<string | null>(null);
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
    trigger: 'TICKET_CREATED',
    conditions: [{ ...EMPTY_CONDITION }],
    actions: [{ ...EMPTY_ACTION }],
    priority: 1,
    teamId: '',
    sourceConditions: null,
    conditionTreeLocked: false,
  });

  const effectiveScopeTeamId = useMemo(() => {
    if (role === 'TEAM_ADMIN') {
      return teamAdminScopeTeamId || form.teamId || '';
    }
    return form.teamId || '';
  }, [form.teamId, role, teamAdminScopeTeamId]);

  useEffect(() => {
    void loadRules();
  }, [teamsList]);

  useEffect(() => {
    if (!canEdit) return;

    setAllUsersLoading(true);
    fetchAllUsers({ pageSize: 100 })
      .then((response) => {
        const options = response.data
          .map((user: UserRef) => ({
            id: user.id,
            label: user.displayName?.trim() ? `${user.displayName} (${user.email})` : user.email,
            email: user.email,
            role: user.role,
          }))
          .sort((a, b) => a.label.localeCompare(b.label));
        setAllUserOptions(options);
      })
      .catch((err) => {
        const message = handleApiError(err);
        setError(message);
        toast.error(message);
      })
      .finally(() => {
        setAllUsersLoading(false);
      });
  }, [canEdit, toast]);

  useEffect(() => {
    if (!showEditor || !canEdit) {
      setAssignableUserOptions([]);
      setAssignableUsersHint(null);
      return;
    }

    if (!effectiveScopeTeamId) {
      setAssignableUserOptions([]);
      setAssignableUsersHint(
        role === 'TEAM_ADMIN'
          ? 'Primary team is unavailable. Reload or contact an owner.'
          : 'Select a scope team first.'
      );
      return;
    }

    let cancelled = false;
    setAssignableUsersLoading(true);
    setAssignableUsersHint(null);

    fetchTeamMembers(effectiveScopeTeamId)
      .then((response) => {
        if (cancelled) return;
        const options = response.data
          .map((member) => ({
            id: member.user.id,
            label: member.user.displayName?.trim()
              ? `${member.user.displayName} (${member.user.email})`
              : member.user.email,
            email: member.user.email,
            role: member.user.role,
          }))
          .sort((a, b) => a.label.localeCompare(b.label));
        setAssignableUserOptions(options);
        if (options.length === 0) {
          setAssignableUsersHint('No team members available for assignment.');
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setAssignableUserOptions([]);
        setAssignableUsersHint('Unable to load team members for assignment.');
        const message = handleApiError(err);
        setError(message);
        toast.error(message);
      })
      .finally(() => {
        if (cancelled) return;
        setAssignableUsersLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [canEdit, effectiveScopeTeamId, role, showEditor, toast]);

  async function loadRuleStats(nextRules: AutomationRule[], existingMeta: Record<string, RuleUiMeta>) {
    const statsEntries = await Promise.all(
      nextRules.map(async (rule) => {
        try {
          const execution = await fetchAutomationRuleExecutions(rule.id, 1, 1);
          return [
            rule.id,
            {
              ...existingMeta[rule.id],
              runCount: execution.meta.total,
              lastRun: formatRelativeTime(execution.data[0]?.executedAt ?? null),
            }
          ] as const;
        } catch {
          return [
            rule.id,
            {
              ...existingMeta[rule.id],
              runCount: existingMeta[rule.id]?.runCount ?? 0,
              lastRun: existingMeta[rule.id]?.lastRun ?? 'Never',
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
          conditions: toFlatConditions(rule.conditions),
          actions: toFlatActions(rule.actions, teamsList),
          runCount: 0,
          lastRun: 'Never',
        };
      });
      await loadRuleStats(response.data, baseMeta);
    } catch (err) {
      const message = handleApiError(err);
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
    const scopedTeamId = role === 'TEAM_ADMIN' ? teamAdminScopeTeamId : '';
    setForm({
      id: null,
      name: '',
      description: '',
      enabled: true,
      trigger: 'TICKET_CREATED',
      conditions: [{ ...EMPTY_CONDITION }],
      actions: [{ ...EMPTY_ACTION }],
      priority: sortedRules.length > 0 ? Math.max(...sortedRules.map((rule) => rule.priority)) + 1 : 1,
      teamId: scopedTeamId,
      sourceConditions: null,
      conditionTreeLocked: false,
    });
    setShowEditor(true);
  }

  function openEditModal(rule: AutomationRule) {
    const conditionTreeLocked = hasConditionGroups(rule.conditions);
    setForm({
      id: rule.id,
      name: rule.name,
      description: rule.description ?? '',
      enabled: rule.isActive,
      trigger: rule.trigger,
      conditions: toFlatConditions(rule.conditions),
      actions: toFlatActions(rule.actions, teamsList),
      priority: rule.priority,
      teamId: role === 'TEAM_ADMIN' ? rule.teamId ?? teamAdminScopeTeamId : rule.teamId ?? '',
      sourceConditions: conditionTreeLocked ? rule.conditions : null,
      conditionTreeLocked,
    });
    setShowEditor(true);
  }

  async function handleSaveRule() {
    if (!form.name.trim()) {
      setError('Automation name is required.');
      toast.error('Automation name is required.');
      return;
    }

    const scopedTeamId = role === 'TEAM_ADMIN' ? teamAdminScopeTeamId || form.teamId || '' : form.teamId.trim();

    const conditions =
      form.conditionTreeLocked && form.sourceConditions
        ? form.sourceConditions
        : toApiConditions(form.conditions);
    if (conditions.length === 0) {
      setError('At least one valid condition is required.');
      toast.error('At least one valid condition is required.');
      return;
    }

    const actions = toApiActions(form.actions, teamsList);
    if (actions.length === 0) {
      setError('At least one action is required.');
      toast.error('At least one action is required.');
      return;
    }

    for (let i = 0; i < actions.length; i++) {
      const action = actions[i];
      const n = i + 1;
      if (action.type === 'assign_team' && !action.teamId) {
        const message = `Action ${n}: select a valid team.`;
        setError(message);
        toast.error(message);
        return;
      }
      if (action.type === 'assign_user' && !action.userId) {
        const message = `Action ${n}: assign user requires a user id.`;
        setError(message);
        toast.error(message);
        return;
      }
      if (action.type === 'assign_user' && !scopedTeamId) {
        const message = `Action ${n}: assign user requires a scope team.`;
        setError(message);
        toast.error(message);
        return;
      }
      if (action.type === 'assign_user' && assignableUsersLoading) {
        const message = `Action ${n}: wait until team members finish loading.`;
        setError(message);
        toast.error(message);
        return;
      }
      if (
        action.type === 'assign_user' &&
        action.userId &&
        !assignableUserOptions.some((option) => option.id === action.userId)
      ) {
        const message = assignableUsersHint ?? `Action ${n}: selected user is not in the scoped team.`;
        setError(message);
        toast.error(message);
        return;
      }
      if (action.type === 'set_priority' && !['P1', 'P2', 'P3', 'P4'].includes(action.priority ?? '')) {
        const message = `Action ${n}: priority must be P1, P2, P3, or P4.`;
        setError(message);
        toast.error(message);
        return;
      }
      if (
        action.type === 'set_status' &&
        ![
          'NEW',
          'TRIAGED',
          'ASSIGNED',
          'IN_PROGRESS',
          'WAITING_ON_REQUESTER',
          'WAITING_ON_VENDOR',
          'RESOLVED',
          'CLOSED',
          'REOPENED',
        ].includes(action.status ?? '')
      ) {
        const message = `Action ${n}: status must be a valid ticket status.`;
        setError(message);
        toast.error(message);
        return;
      }
      if (action.type === 'add_internal_note' && !(action.body ?? '').trim()) {
        const message = `Action ${n}: internal note body is required.`;
        setError(message);
        toast.error(message);
        return;
      }
    }

    if (role === 'TEAM_ADMIN' && !scopedTeamId) {
      setError('Team admin requires a primary team to manage automation rules.');
      toast.error('Team admin requires a primary team to manage automation rules.');
      return;
    }

    const payload = {
      name: form.name.trim(),
      description: form.description.trim() || undefined,
      trigger: form.trigger,
      conditions,
      actions,
      isActive: form.enabled,
      priority: Math.max(1, Number(form.priority) || 1),
      teamId: scopedTeamId || undefined
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
            }),
            conditions: toFlatConditions(updated.conditions),
            actions: toFlatActions(updated.actions, teamsList),
          }
        }));
        toast.success('Automation updated.');
      } else {
        const created = await createAutomationRule(payload);
        setRules((prev) => [...prev, created]);
        setUiMetaById((prev) => ({
          ...prev,
          [created.id]: {
            conditions: toFlatConditions(created.conditions),
            actions: toFlatActions(created.actions, teamsList),
            runCount: 0,
            lastRun: 'Never',
          }
        }));
        toast.success('Automation created.');
      }
      setShowEditor(false);
    } catch (err) {
      const message = handleApiError(err);
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
      const message = handleApiError(err);
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
      const message = handleApiError(err);
      setError(message);
      toast.error(message);
    }
  }

  return (
    <section className="min-h-full bg-slate-50 animate-fade-in">
      <div className="sticky top-0 z-40 border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-[1600px] py-4 px-6">
          {headerCtx ? (
            <TopBar
              title={headerCtx.title}
              subtitle={headerCtx.subtitle}
              currentEmail={headerCtx.currentEmail}
              personas={headerCtx.personas}
              onEmailChange={headerCtx.onEmailChange}
              onOpenSearch={headerCtx.onOpenSearch}
              notificationProps={headerCtx.notificationProps}
              leftContent={
                <div className="min-w-0">
                  <h1 className="text-xl font-semibold text-slate-900">Automation Rules</h1>
                  <p className="mt-0.5 text-sm text-slate-500">Run actions automatically based on ticket events.</p>
                </div>
              }
            />
          ) : (
            <div className="min-w-0">
              <h1 className="text-xl font-semibold text-slate-900">Automation Rules</h1>
              <p className="mt-0.5 text-sm text-slate-500">Run actions automatically based on ticket events.</p>
            </div>
          )}
        </div>
      </div>

      <div className="mx-auto max-w-[1600px] p-6">
        {error && (
          <div className="mb-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="mb-5 flex items-center justify-between">
          <p className="text-sm text-slate-600">Automations run automatically based on triggers and conditions.</p>
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
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-xs text-slate-500">Total Automations</p>
            <p className="mt-0.5 text-2xl font-bold text-blue-600">{rules.length}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-xs text-slate-500">Active</p>
            <p className="mt-0.5 text-2xl font-bold text-green-600">{rules.filter((rule) => rule.isActive).length}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-xs text-slate-500">Total Runs</p>
            <p className="mt-0.5 text-2xl font-bold text-purple-600">{totalRuns}</p>
          </div>
        </div>

        {loading ? (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={`kpi-skel-${i}`} className="rounded-xl border border-slate-200 bg-white p-4">
                  <div className="mb-3 h-4 w-24 skeleton-shimmer rounded" />
                  <div className="mb-2 h-7 w-16 skeleton-shimmer rounded" />
                  <div className="h-3 w-32 skeleton-shimmer rounded" />
                </div>
              ))}
            </div>
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={`rule-skel-${i}`} className="rounded-xl border border-slate-200 bg-white p-5">
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
          </div>
        ) : (
          <div className="space-y-3">
            {sortedRules.map((rule) => {
              const meta = uiMetaById[rule.id] ?? {
                conditions: toFlatConditions(rule.conditions),
                actions: toFlatActions(rule.actions, teamsList),
                runCount: 0,
                lastRun: 'Never',
              };
              return (
                <div
                  key={rule.id}
                  className={`rounded-xl border border-slate-200 bg-white p-5 transition-all duration-200 hover:shadow-md ${
                    !rule.isActive ? 'opacity-60' : ''
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex flex-1 items-start space-x-4">
                      <div className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl ${triggerBg(rule.trigger)}`}>
                        <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={triggerIcon(rule.trigger)} />
                        </svg>
                      </div>
                      <div className="flex-1">
                        <div className="mb-1 flex items-center space-x-2">
                          <span className="text-sm font-semibold text-slate-900">{rule.name}</span>
                          {!rule.isActive && (
                            <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-medium text-slate-500">
                              Disabled
                            </span>
                          )}
                        </div>

                        <div className="mb-2 flex flex-wrap items-center gap-2">
                          <span className="text-xs text-slate-400">Trigger:</span>
                          <span className="rounded-md bg-amber-100 px-2 py-1 text-xs font-medium text-amber-700">
                            {triggerLabel(rule.trigger)}
                          </span>
                        </div>

                        {meta.conditions.length > 0 && (
                          <div className="mb-2 flex flex-wrap gap-1.5">
                            <span className="mt-0.5 text-xs text-slate-400">IF</span>
                            {meta.conditions.map((condition, index) => (
                              <span key={`${rule.id}-condition-${index}`} className="rounded-md bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">
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
                              {action.val
                                ? (() => {
                                    const displayValue =
                                      action.type === 'assign_user'
                                        ? resolveUserName(action.val, allUserOptions)
                                        : action.val;
                                    return `: ${displayValue.length > 24 ? `${displayValue.slice(0, 24)}…` : displayValue}`;
                                  })()
                                : ''}
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
                            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        </div>
                      )}
                      <div className="text-right">
                        <p className="text-xs text-slate-500">
                          <span className="font-semibold text-slate-700">{meta.runCount}</span> runs
                        </p>
                        <p className="text-xs text-slate-400">Last: {meta.lastRun}</p>
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
                className="flex w-full items-center justify-center space-x-2 rounded-xl border-2 border-dashed border-slate-300 p-4 text-sm text-slate-400 transition-colors hover:border-blue-300 hover:text-blue-600"
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
          role={role}
          teamsList={teamsList}
          teamAdminScopeName={teamAdminScopeTeamName}
          assignableUserOptions={assignableUserOptions}
          assignableUsersLoading={assignableUsersLoading || allUsersLoading}
          assignableUsersHint={assignableUsersHint}
          conditionEditingLocked={form.conditionTreeLocked}
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
                itemIndex === index
                  ? key === 'type'
                    ? { ...action, type: value, val: '' }
                    : { ...action, [key]: value }
                  : action
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
