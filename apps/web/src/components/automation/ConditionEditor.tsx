import type { AutomationCondition } from '../../api/client';

const FIELDS = [
  { value: 'subject', label: 'Subject' },
  { value: 'description', label: 'Description' },
  { value: 'priority', label: 'Priority' },
  { value: 'status', label: 'Status' },
  { value: 'assignedTeamId', label: 'Team' },
  { value: 'assigneeId', label: 'Assignee' },
  { value: 'categoryId', label: 'Category' },
] as const;

const OPERATORS = [
  { value: 'contains', label: 'contains' },
  { value: 'equals', label: 'equals' },
  { value: 'notEquals', label: 'not equals' },
  { value: 'in', label: 'is one of' },
  { value: 'notIn', label: 'is not one of' },
  { value: 'isEmpty', label: 'is empty' },
  { value: 'isNotEmpty', label: 'is not empty' },
] as const;

const PRIORITIES = ['P1', 'P2', 'P3', 'P4'];
const STATUSES = [
  'NEW', 'TRIAGED', 'ASSIGNED', 'IN_PROGRESS',
  'WAITING_ON_REQUESTER', 'WAITING_ON_VENDOR', 'RESOLVED', 'CLOSED', 'REOPENED',
];

type Props = {
  condition: AutomationCondition;
  onChange: (c: AutomationCondition) => void;
  onRemove: () => void;
  teams: { id: string; name: string }[];
  users: { id: string; displayName: string; email: string }[];
  categories?: { id: string; name: string }[];
};

export function ConditionEditor({
  condition,
  onChange,
  onRemove,
  teams,
  users,
  categories = [],
}: Props) {
  const field = condition.field ?? 'subject';
  const operator = condition.operator ?? 'contains';
  const value = condition.value;

  const needsValue =
    operator !== 'isEmpty' && operator !== 'isNotEmpty';
  const isMulti = operator === 'in' || operator === 'notIn';
  const valueArray = Array.isArray(value) ? value : value != null ? [value] : [];

  function setValue(next: unknown) {
    onChange({ ...condition, value: next });
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-slate-50/50 p-2 text-sm">
      <select
        className="rounded border border-slate-200 bg-white px-2 py-1 text-xs"
        value={field}
        onChange={(e) => onChange({ ...condition, field: e.target.value })}
      >
        {FIELDS.map((f) => (
          <option key={f.value} value={f.value}>
            {f.label}
          </option>
        ))}
      </select>
      <select
        className="rounded border border-slate-200 bg-white px-2 py-1 text-xs"
        value={operator}
        onChange={(e) => onChange({ ...condition, operator: e.target.value })}
      >
        {OPERATORS.map((op) => (
          <option key={op.value} value={op.value}>
            {op.label}
          </option>
        ))}
      </select>
      {needsValue && (
        <>
          {field === 'priority' && (
            <select
              className="rounded border border-slate-200 bg-white px-2 py-1 text-xs"
              value={isMulti ? (valueArray[0] ?? '') : (value ?? '')}
              onChange={(e) =>
                setValue(isMulti ? [e.target.value] : e.target.value)
              }
            >
              <option value="">Select</option>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          )}
          {field === 'status' && (
            <select
              className="rounded border border-slate-200 bg-white px-2 py-1 text-xs"
              value={isMulti ? (valueArray[0] ?? '') : (value ?? '')}
              onChange={(e) =>
                setValue(isMulti ? [e.target.value] : e.target.value)
              }
            >
              <option value="">Select</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          )}
          {field === 'assignedTeamId' && (
            <select
              className="rounded border border-slate-200 bg-white px-2 py-1 text-xs"
              value={isMulti ? (valueArray[0] ?? '') : (value ?? '')}
              onChange={(e) =>
                setValue(isMulti ? [e.target.value] : e.target.value)
              }
            >
              <option value="">Select team</option>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          )}
          {field === 'assigneeId' && (
            <select
              className="rounded border border-slate-200 bg-white px-2 py-1 text-xs min-w-[140px]"
              value={isMulti ? (valueArray[0] ?? '') : (value ?? '')}
              onChange={(e) =>
                setValue(isMulti ? [e.target.value] : e.target.value)
              }
            >
              <option value="">Select user</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.displayName}
                </option>
              ))}
            </select>
          )}
          {field === 'categoryId' && (
            <select
              className="rounded border border-slate-200 bg-white px-2 py-1 text-xs"
              value={isMulti ? (valueArray[0] ?? '') : (value ?? '')}
              onChange={(e) =>
                setValue(isMulti ? [e.target.value] : e.target.value)
              }
            >
              <option value="">Select category</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          )}
          {(field === 'subject' || field === 'description') && (
            <input
              type="text"
              className="rounded border border-slate-200 bg-white px-2 py-1 text-xs min-w-[120px]"
              placeholder={isMulti ? 'Comma-separated' : 'Value'}
              value={
                isMulti
                  ? valueArray.map(String).join(', ')
                  : value != null
                    ? String(value)
                    : ''
              }
              onChange={(e) => {
                const v = e.target.value;
                if (isMulti) {
                  setValue(
                    v
                      .split(',')
                      .map((s) => s.trim())
                      .filter(Boolean)
                  );
                } else {
                  setValue(v || undefined);
                }
              }}
            />
          )}
        </>
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
