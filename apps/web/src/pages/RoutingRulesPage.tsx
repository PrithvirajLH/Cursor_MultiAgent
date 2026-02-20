import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import {
  createRoutingRule,
  deleteRoutingRule,
  fetchTeamMembers,
  fetchRoutingRules,
  updateRoutingRule,
  type RoutingRule,
  type TeamMember,
  type TeamRef
} from '../api/client';
import { TopBar } from '../components/TopBar';
import { useHeaderContext } from '../contexts/HeaderContext';
import { useToast } from '../hooks/useToast';
import { useModalFocusTrap } from '../hooks/useModalFocusTrap';
import type { Role } from '../types';
import { handleApiError } from '../utils/handleApiError';

type RoutingCondition = {
  field: string;
  op: string;
  val: string;
};

type RoutingAction = {
  type: string;
  val: string;
};

type RoutingForm = {
  id: string | null;
  name: string;
  enabled: boolean;
  priority: number;
  conditions: RoutingCondition[];
  actions: RoutingAction[];
};

type RuleUiMeta = {
  conditions: RoutingCondition[];
  actions: RoutingAction[];
};

type AssignmentMode = 'team' | 'member';

type MemberOption = {
  id: string;
  label: string;
  email: string;
};

const ACTION_LABELS: Record<string, string> = {
  assign_team: 'Assign Team',
  assign_member: 'Assign Member',
};

const DEFAULT_CONDITION: RoutingCondition = { field: 'subject', op: 'contains', val: '' };
const DEFAULT_ACTION: RoutingAction = { type: 'assign_team', val: '' };

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

function resolveTeamId(actionValue: string, teamsList: TeamRef[]): string | null {
  const trimmed = actionValue.trim();
  if (!trimmed) return null;
  const byId = teamsList.find((team) => team.id === trimmed);
  if (byId) return byId.id;
  const lowered = trimmed.toLowerCase();
  const byName = teamsList.find((team) => team.name.toLowerCase() === lowered);
  return byName?.id ?? null;
}

function resolveTeamName(teamId: string, teamsList: TeamRef[]): string {
  return teamsList.find((team) => team.id === teamId)?.name ?? teamId;
}

function resolveMemberId(actionValue: string, members: MemberOption[]): string | null {
  const trimmed = actionValue.trim();
  if (!trimmed) return null;
  const byId = members.find((member) => member.id === trimmed);
  if (byId) return byId.id;
  const lowered = trimmed.toLowerCase();
  const byEmail = members.find((member) => member.email.toLowerCase() === lowered);
  if (byEmail) return byEmail.id;
  const byLabel = members.find((member) => member.label.toLowerCase() === lowered);
  return byLabel?.id ?? null;
}

function resolveMemberName(memberId: string, members: MemberOption[]): string {
  return members.find((member) => member.id === memberId)?.label ?? memberId;
}

function deriveMetaFromRule(rule: RoutingRule, mode: AssignmentMode): RuleUiMeta {
  const conditions =
    rule.keywords.length > 0
      ? rule.keywords.map((keyword) => ({
          field: 'subject',
          op: 'contains',
          val: keyword
        }))
      : [{ ...DEFAULT_CONDITION }];

  const actions: RoutingAction[] = [
    {
      type: mode === 'member' ? 'assign_member' : 'assign_team',
      val: mode === 'member' ? rule.assigneeId ?? '' : rule.teamId
    }
  ];

  return { conditions, actions };
}

function getActionType(mode: AssignmentMode): RoutingAction['type'] {
  return mode === 'member' ? 'assign_member' : 'assign_team';
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
        aria-label="Delete routing rule"
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
          <h3 className="text-base font-semibold text-slate-900">Delete Routing Rule</h3>
        </div>
        <p className="mb-5 text-sm leading-relaxed text-slate-600">
          Delete "{ruleName}"? This cannot be undone.
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
  teamsList,
  assignmentMode,
  memberOptions,
  onClose,
  onSubmit,
  onChange,
  onAddCondition,
  onRemoveCondition,
  onUpdateCondition,
  onUpdateAction
}: {
  form: RoutingForm;
  isNew: boolean;
  loading: boolean;
  teamsList: TeamRef[];
  assignmentMode: AssignmentMode;
  memberOptions: MemberOption[];
  onClose: () => void;
  onSubmit: () => void;
  onChange: (next: Partial<RoutingForm>) => void;
  onAddCondition: () => void;
  onRemoveCondition: (index: number) => void;
  onUpdateCondition: (index: number, key: keyof RoutingCondition, value: string) => void;
  onUpdateAction: (index: number, key: keyof RoutingAction, value: string) => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useModalFocusTrap({
    open: true,
    containerRef: dialogRef,
    onClose,
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={isNew ? 'Create routing rule' : 'Edit routing rule'}
        tabIndex={-1}
        className="flex max-h-[92vh] w-full max-w-2xl flex-col rounded-xl bg-white shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <div>
            <p className="text-base font-semibold text-slate-900">
              {isNew ? 'Create Routing Rule' : 'Edit Routing Rule'}
            </p>
            <p className="mt-0.5 text-xs text-slate-500">
              Define subject keywords and target {assignmentMode === 'member' ? 'team member' : 'team'}
            </p>
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
              <label className="mb-1 block text-xs font-medium text-slate-700">Rule Name *</label>
              <input
                value={form.name}
                onChange={(event) => onChange({ name: event.target.value })}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-transparent focus:ring-2 focus:ring-blue-500"
                placeholder="e.g. VIP Fast Lane"
              />
            </div>
            <div className="col-span-2 flex items-end pb-1 sm:col-span-1">
              <div className="flex items-center space-x-2">
                <Toggle checked={form.enabled} onChange={(value) => onChange({ enabled: value })} />
                <span className="text-sm text-slate-700">Enabled</span>
              </div>
            </div>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <p className="text-sm font-semibold text-slate-800">Subject Keywords</p>
              <span className="text-xs text-slate-400">All keywords are matched against the ticket subject</span>
            </div>
            <div className="space-y-2">
              {form.conditions.map((condition, index) => (
                <div key={`condition-${index}`} className="flex items-center space-x-2 rounded-xl border border-slate-200 bg-slate-50 p-2.5">
                  <span className="rounded-lg bg-white px-2 py-1 text-xs font-medium text-slate-500">
                    subject
                  </span>
                  <span className="rounded-lg bg-white px-2 py-1 text-xs font-medium text-slate-500">
                    contains
                  </span>
                  <input
                    value={condition.val}
                    onChange={(event) => onUpdateCondition(index, 'val', event.target.value)}
                    className="flex-1 rounded-lg border border-slate-300 px-2 py-1.5 text-sm focus:border-transparent focus:ring-2 focus:ring-blue-500"
                    placeholder="keyword..."
                  />
                  <button
                    type="button"
                    onClick={() => onRemoveCondition(index)}
                    className="flex-shrink-0 text-slate-400 hover:text-red-500"
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
              <p className="text-sm font-semibold text-slate-800">Assignment</p>
              <span className="text-xs text-slate-400">Persisted backend field</span>
            </div>
            <div className="space-y-2">
              {form.actions.map((action, index) => (
                <div key={`action-${index}`} className="flex items-center space-x-2 rounded-lg border border-blue-100 bg-blue-50 p-2.5">
                  <svg className="h-4 w-4 flex-shrink-0 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                  <span className="rounded-lg bg-white px-2 py-1 text-xs font-medium text-blue-700">
                    {assignmentMode === 'member' ? 'Assign Member' : 'Assign Team'}
                  </span>
                  <select
                    value={action.val}
                    onChange={(event) => onUpdateAction(index, 'val', event.target.value)}
                    className="flex-1 rounded-lg border border-blue-200 bg-white px-2 py-1.5 text-sm focus:border-transparent focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">
                      {assignmentMode === 'member' ? 'Select member...' : 'Select team...'}
                    </option>
                    {assignmentMode === 'member'
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
              ))}
            </div>
            {assignmentMode === 'member' && memberOptions.length === 0 && (
              <p className="mt-2 text-xs text-amber-700">
                No team members found for assignment. Add team members first.
              </p>
            )}
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
            {loading ? 'Saving...' : isNew ? 'Create Rule' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function RoutingRulesPage({
  teamsList,
  role
}: {
  teamsList: TeamRef[];
  role: Role;
}) {
  const headerCtx = useHeaderContext();
  const toast = useToast();
  const [rules, setRules] = useState<RoutingRule[]>([]);
  const [uiMetaById, setUiMetaById] = useState<Record<string, RuleUiMeta>>({});
  const [memberOptions, setMemberOptions] = useState<MemberOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [updatingRuleId, setUpdatingRuleId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const assignmentMode: AssignmentMode = role === 'TEAM_ADMIN' ? 'member' : 'team';
  const actionType = getActionType(assignmentMode);

  const [showEditor, setShowEditor] = useState(false);
  const [form, setForm] = useState<RoutingForm>({
    id: null,
    name: '',
    enabled: true,
    priority: 1,
    conditions: [{ ...DEFAULT_CONDITION }],
    actions: [{ ...DEFAULT_ACTION }]
  });

  const [deleteTarget, setDeleteTarget] = useState<RoutingRule | null>(null);

  useEffect(() => {
    void loadRules();
  }, [assignmentMode]);

  useEffect(() => {
    if (assignmentMode !== 'member') {
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
        if (!active) return;
        setMemberOptions([]);
        const message = handleApiError(err);
        setError(message);
        toast.error(message);
      });

    return () => {
      active = false;
    };
  }, [assignmentMode, teamsList, toast]);

  function updateMetaFromRules(nextRules: RoutingRule[]) {
    setUiMetaById(() => {
      const next: Record<string, RuleUiMeta> = {};
      nextRules.forEach((rule) => {
        next[rule.id] = deriveMetaFromRule(rule, assignmentMode);
      });
      return next;
    });
  }

  async function loadRules() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetchRoutingRules();
      setRules(response.data);
      updateMetaFromRules(response.data);
    } catch (err) {
      const message = handleApiError(err);
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }

  const sortedRules = useMemo(() => {
    return [...rules].sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name));
  }, [rules]);

  function openCreateModal() {
    const nextPriority =
      sortedRules.length > 0
        ? Math.max(...sortedRules.map((rule) => rule.priority)) + 1
        : 1;
    const defaultActionValue =
      assignmentMode === 'member'
        ? memberOptions[0]?.id ?? ''
        : teamsList[0]?.id ?? '';
    setForm({
      id: null,
      name: '',
      enabled: true,
      priority: nextPriority,
      conditions: [{ ...DEFAULT_CONDITION }],
      actions: [{ type: actionType, val: defaultActionValue }]
    });
    setShowEditor(true);
  }

  function openEditModal(rule: RoutingRule) {
    const meta = uiMetaById[rule.id] ?? deriveMetaFromRule(rule, assignmentMode);
    setForm({
      id: rule.id,
      name: rule.name,
      enabled: rule.isActive,
      priority: rule.priority,
      conditions:
        meta.conditions.length > 0
          ? meta.conditions.map((item) => ({ ...item }))
          : [{ ...DEFAULT_CONDITION }],
      actions:
        meta.actions.length > 0
          ? meta.actions.map((item) => ({ ...item, type: actionType }))
          : [{ type: actionType, val: '' }]
    });
    setShowEditor(true);
  }

  function validateForm(nextForm: RoutingForm): {
    payload?: {
      name: string;
      keywords: string[];
      teamId?: string;
      assigneeId?: string;
      priority: number;
      isActive: boolean;
    };
    error?: string;
  } {
    if (!nextForm.name.trim()) {
      return { error: 'Rule name is required.' };
    }

    const keywords = toUniqueKeywords(nextForm.conditions);
    if (keywords.length === 0) {
      return { error: 'Add at least one condition value.' };
    }

    const assignmentAction = nextForm.actions[0];
    const basePayload = {
      name: nextForm.name.trim(),
      keywords,
      priority: Math.max(1, Number(nextForm.priority) || 1),
      isActive: nextForm.enabled
    };

    if (assignmentMode === 'member') {
      if (memberOptions.length === 0) {
        return { error: 'No team members available for assignment.' };
      }
      const assigneeId = assignmentAction
        ? resolveMemberId(assignmentAction.val, memberOptions)
        : null;
      if (!assigneeId) {
        return { error: 'Select a valid member assignment.' };
      }
      const scopedTeamId = teamsList[0]?.id;
      if (!scopedTeamId) {
        return { error: 'No team found for team admin routing rules.' };
      }

      return {
        payload: {
          ...basePayload,
          teamId: scopedTeamId,
          assigneeId
        }
      };
    }

    const teamId = assignmentAction ? resolveTeamId(assignmentAction.val, teamsList) : null;
    if (!teamId) {
      return { error: 'Select a valid team assignment.' };
    }

    return {
      payload: {
        ...basePayload,
        teamId,
      }
    };
  }

  async function handleSaveRule() {
    const parsed = validateForm(form);
    if (!parsed.payload) {
      const message = parsed.error ?? 'Invalid form values.';
      setError(message);
      toast.error(message);
      return;
    }

    setSaving(true);
    setError(null);
    try {
      if (form.id) {
        const updated = await updateRoutingRule(form.id, parsed.payload);
        setRules((prev) => prev.map((rule) => (rule.id === form.id ? updated : rule)));
        setUiMetaById((prev) => ({
          ...prev,
          [form.id!]: deriveMetaFromRule(updated, assignmentMode)
        }));
        toast.success('Routing rule updated.');
      } else {
        const created = await createRoutingRule(parsed.payload);
        setRules((prev) => [...prev, created]);
        setUiMetaById((prev) => ({
          ...prev,
          [created.id]: deriveMetaFromRule(created, assignmentMode)
        }));
        toast.success('Routing rule created.');
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

  async function handleToggleRule(rule: RoutingRule, nextEnabled: boolean) {
    setUpdatingRuleId(rule.id);
    setError(null);
    try {
      const updated = await updateRoutingRule(rule.id, { isActive: nextEnabled });
      setRules((prev) => prev.map((item) => (item.id === rule.id ? updated : item)));
      toast.success(nextEnabled ? 'Rule enabled.' : 'Rule disabled.');
    } catch (err) {
      const message = handleApiError(err);
      setError(message);
      toast.error(message);
    } finally {
      setUpdatingRuleId(null);
    }
  }

  async function handleDeleteRule(rule: RoutingRule) {
    setError(null);
    try {
      await deleteRoutingRule(rule.id);
      setRules((prev) => prev.filter((item) => item.id !== rule.id));
      setUiMetaById((prev) => {
        const next = { ...prev };
        delete next[rule.id];
        return next;
      });
      setDeleteTarget(null);
      toast.success('Routing rule deleted.');
    } catch (err) {
      const message = handleApiError(err);
      setError(message);
      toast.error(message);
    }
  }

  function updateCondition(index: number, key: keyof RoutingCondition, value: string) {
    setForm((prev) => ({
      ...prev,
      conditions: prev.conditions.map((condition, itemIndex) =>
        itemIndex === index ? { ...condition, [key]: value } : condition
      )
    }));
  }

  function updateAction(index: number, key: keyof RoutingAction, value: string) {
    setForm((prev) => ({
      ...prev,
      actions: prev.actions.map((action, itemIndex) =>
        itemIndex === index ? { ...action, [key]: value } : action
      )
    }));
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
                  <h1 className="text-xl font-semibold text-slate-900">Routing Rules</h1>
                  <p className="mt-0.5 text-sm text-slate-500">
                    Auto-assign {assignmentMode === 'member' ? 'team members' : 'teams'} and priorities using ticket conditions.
                  </p>
                </div>
              }
            />
          ) : (
            <div className="min-w-0">
              <h1 className="text-xl font-semibold text-slate-900">Routing Rules</h1>
              <p className="mt-0.5 text-sm text-slate-500">
                Auto-assign {assignmentMode === 'member' ? 'team members' : 'teams'} and priorities using ticket conditions.
              </p>
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
          <div>
            <p className="text-sm text-slate-600">
              Rules are evaluated in order. The first matching rule wins.
            </p>
          </div>
          <button
            type="button"
            onClick={openCreateModal}
            className="flex items-center space-x-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700"
          >
            <Plus className="h-4 w-4" />
            <span>New Rule</span>
          </button>
        </div>

        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={`rule-skel-${i}`} className="rounded-xl border border-slate-200 bg-white p-5">
                <div className="flex items-center justify-between">
                  <div className="space-y-2">
                    <div className="h-5 w-40 skeleton-shimmer rounded" />
                    <div className="h-3.5 w-56 skeleton-shimmer rounded" />
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="h-5 w-14 skeleton-shimmer rounded-full" />
                    <div className="h-5 w-14 skeleton-shimmer rounded-full" />
                    <div className="h-8 w-20 skeleton-shimmer rounded-lg" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-3">
            {sortedRules.map((rule, index) => {
              const meta = uiMetaById[rule.id] ?? deriveMetaFromRule(rule, assignmentMode);
              return (
                <div
                  key={rule.id}
                  className={`rounded-xl border bg-white p-4 transition-all duration-200 hover:shadow-md ${
                    !rule.isActive ? 'opacity-60' : ''
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-start space-x-3">
                      <div className="flex flex-col items-center pt-1">
                        <div className="cursor-grab opacity-40 transition-opacity hover:opacity-80">
                          <svg className="h-4 w-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                          </svg>
                        </div>
                        <span className="mt-1 text-xs font-medium text-slate-400">#{index + 1}</span>
                      </div>
                      <div>
                        <div className="mb-2 flex items-center space-x-2">
                          <span className="text-sm font-semibold text-slate-900">{rule.name}</span>
                          {!rule.isActive && (
                            <span className="rounded-lg bg-slate-100 px-2 py-1 text-xs font-medium text-slate-500">
                              Disabled
                            </span>
                          )}
                        </div>

                        <div className="mb-2 flex flex-wrap gap-1.5">
                          <span className="mt-0.5 text-xs font-medium text-slate-400">IF</span>
                          {meta.conditions.map((condition, conditionIndex) => (
                            <span key={`${rule.id}-condition-${conditionIndex}`} className="inline-flex items-center rounded-lg bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">
                              <span className="text-slate-500">{condition.field.replace('_', ' ')}</span>&nbsp;
                              {condition.op.replace('_', ' ')}&nbsp;
                              <span className="font-semibold">"{condition.val}"</span>
                            </span>
                          ))}
                        </div>

                        <div className="flex flex-wrap gap-1.5">
                          <span className="mt-0.5 text-xs font-medium text-blue-500">THEN</span>
                          {meta.actions.map((action, actionIndex) => (
                            <span key={`${rule.id}-action-${actionIndex}`} className="inline-flex items-center rounded-lg bg-blue-100 px-2 py-1 text-xs font-medium text-blue-700">
                              {ACTION_LABELS[action.type] ?? action.type}
                              {action.val
                                ? action.type === 'assign_member'
                                  ? `: ${resolveMemberName(resolveMemberId(action.val, memberOptions) ?? action.val, memberOptions)}`
                                  : `: ${resolveTeamName(resolveTeamId(action.val, teamsList) ?? action.val, teamsList)}`
                                : ''}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>

                    <div className="ml-3 flex flex-shrink-0 items-center space-x-2">
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
                  </div>
                </div>
              );
            })}

            {sortedRules.length === 0 && (
              <div className="rounded-xl border border-slate-200 bg-white p-8 text-center">
                <p className="text-sm font-semibold text-slate-700">No routing rules</p>
                <p className="mt-1 text-xs text-slate-400">
                  Create your first rule to automatically assign and prioritize incoming tickets.
                </p>
              </div>
            )}

            <button
              type="button"
              onClick={openCreateModal}
              className="flex w-full items-center justify-center space-x-2 rounded-xl border-2 border-dashed border-slate-300 p-4 text-sm text-slate-400 transition-colors hover:border-blue-300 hover:text-blue-600"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              <span>Add Routing Rule</span>
            </button>
          </div>
        )}
      </div>

      {showEditor && (
        <RuleEditorModal
          form={form}
          isNew={!form.id}
          loading={saving}
          teamsList={teamsList}
          assignmentMode={assignmentMode}
          memberOptions={memberOptions}
          onClose={() => setShowEditor(false)}
          onSubmit={() => void handleSaveRule()}
          onChange={(next) => setForm((prev) => ({ ...prev, ...next }))}
          onAddCondition={() =>
            setForm((prev) => ({
              ...prev,
              conditions: [...prev.conditions, { ...DEFAULT_CONDITION }]
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
          onUpdateCondition={updateCondition}
          onUpdateAction={updateAction}
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
