import type { AutomationAction } from '../../api/client';

const ACTION_TYPES = [
  { value: 'assign_team', label: 'Assign to team' },
  { value: 'assign_user', label: 'Assign to user' },
  { value: 'set_priority', label: 'Set priority' },
  { value: 'set_status', label: 'Set status' },
  { value: 'notify_team_lead', label: 'Notify team lead' },
  { value: 'add_internal_note', label: 'Add internal note' },
] as const;

const PRIORITIES = ['P1', 'P2', 'P3', 'P4'];
const STATUSES = [
  'NEW', 'TRIAGED', 'ASSIGNED', 'IN_PROGRESS',
  'WAITING_ON_REQUESTER', 'WAITING_ON_VENDOR', 'RESOLVED', 'CLOSED', 'REOPENED',
];

type Props = {
  action: AutomationAction;
  onChange: (a: AutomationAction) => void;
  onRemove: () => void;
  teams: { id: string; name: string }[];
  users: { id: string; displayName: string; email: string }[];
};

export function ActionEditor({
  action,
  onChange,
  onRemove,
  teams,
  users,
}: Props) {
  const type = action.type ?? 'assign_team';

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-slate-50/50 p-2 text-sm">
      <select
        className="rounded border border-slate-200 bg-white px-2 py-1 text-xs"
        value={type}
        onChange={(e) => onChange({ ...action, type: e.target.value })}
      >
        {ACTION_TYPES.map((a) => (
          <option key={a.value} value={a.value}>
            {a.label}
          </option>
        ))}
      </select>
      {type === 'assign_team' && (
        <select
          className="rounded border border-slate-200 bg-white px-2 py-1 text-xs"
          value={action.teamId ?? ''}
          onChange={(e) => onChange({ ...action, teamId: e.target.value })}
        >
          <option value="">Select team</option>
          {teams.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      )}
      {type === 'assign_user' && (
        <select
          className="rounded border border-slate-200 bg-white px-2 py-1 text-xs min-w-[140px]"
          value={action.userId ?? ''}
          onChange={(e) => onChange({ ...action, userId: e.target.value })}
        >
          <option value="">Select user</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.displayName}
            </option>
          ))}
        </select>
      )}
      {type === 'set_priority' && (
        <select
          className="rounded border border-slate-200 bg-white px-2 py-1 text-xs"
          value={action.priority ?? ''}
          onChange={(e) => onChange({ ...action, priority: e.target.value })}
        >
          <option value="">Select</option>
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      )}
      {type === 'set_status' && (
        <select
          className="rounded border border-slate-200 bg-white px-2 py-1 text-xs"
          value={action.status ?? ''}
          onChange={(e) => onChange({ ...action, status: e.target.value })}
        >
          <option value="">Select</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s.replace(/_/g, ' ')}
            </option>
          ))}
        </select>
      )}
      {(type === 'notify_team_lead' || type === 'add_internal_note') && (
        <input
          type="text"
          className="rounded border border-slate-200 bg-white px-2 py-1 text-xs min-w-[160px]"
          placeholder={type === 'add_internal_note' ? 'Note text' : 'Message (optional)'}
          value={action.body ?? ''}
          onChange={(e) => onChange({ ...action, body: e.target.value })}
        />
      )}
      <button
        type="button"
        onClick={onRemove}
        className="rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-500 hover:bg-slate-100"
      >
        Remove
      </button>
    </div>
  );
}
