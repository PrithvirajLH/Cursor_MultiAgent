import type { AutomationCondition } from "../../api/client";

const FIELDS = [
  { value: "subject", label: "Subject" },
  { value: "description", label: "Description" },
  { value: "priority", label: "Priority" },
  { value: "status", label: "Status" },
  { value: "assignedTeamId", label: "Team" },
  { value: "assigneeId", label: "Assignee" },
  { value: "categoryId", label: "Category" },
] as const;

const OPERATORS = [
  { value: "contains", label: "contains" },
  { value: "equals", label: "equals" },
  { value: "notEquals", label: "not equals" },
  { value: "in", label: "is one of" },
  { value: "notIn", label: "is not one of" },
  { value: "isEmpty", label: "is empty" },
  { value: "isNotEmpty", label: "is not empty" },
] as const;

const PRIORITIES = ["SEV1", "SEV2", "SEV3", "SEV4"];
const STATUSES = [
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

type Props = {
  condition: AutomationCondition;
  onChange: (c: AutomationCondition) => void;
  onRemove: () => void;
  teams: { id: string; name: string }[];
  users: { id: string; displayName: string; email: string }[];
  categories?: { id: string; name: string }[];
};

type SelectOption = { value: string; label: string };

/**
 * Renders the value editor for a dropdown-backed field. For single-value
 * operators it's a plain <select>; for `in`/`notIn` it's a multi-value
 * picker — an "add" <select> plus removable chips — so several values can be
 * authored (BUG-23).
 */
function DropdownValueEditor({
  isMulti,
  options,
  value,
  valueArray,
  placeholder,
  minWidth,
  onSetValue,
}: {
  isMulti: boolean;
  options: SelectOption[];
  value: unknown;
  valueArray: unknown[];
  placeholder: string;
  minWidth?: string;
  onSetValue: (next: unknown) => void;
}) {
  const selectClass = `rounded border border-border bg-card px-2 py-1 text-xs${
    minWidth ? ` ${minWidth}` : ""
  }`;

  if (!isMulti) {
    return (
      <select
        className={selectClass}
        value={value != null ? String(value) : ""}
        onChange={(e) => onSetValue(e.target.value)}
      >
        <option value="">{placeholder}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    );
  }

  const selected = valueArray.map(String);
  const labelFor = (v: string) =>
    options.find((o) => o.value === v)?.label ?? v;
  const available = options.filter((o) => !selected.includes(o.value));

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {selected.map((v) => (
        <span
          key={v}
          className="inline-flex items-center gap-1 rounded border border-border bg-muted px-1.5 py-0.5 text-xs text-foreground"
        >
          {labelFor(v)}
          <button
            type="button"
            aria-label={`Remove ${labelFor(v)}`}
            onClick={() => onSetValue(selected.filter((s) => s !== v))}
            className="text-muted-foreground hover:text-foreground"
          >
            ×
          </button>
        </span>
      ))}
      <select
        className={selectClass}
        value=""
        onChange={(e) => {
          if (e.target.value) onSetValue([...selected, e.target.value]);
        }}
      >
        <option value="">{placeholder}</option>
        {available.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export function ConditionEditor({
  condition,
  onChange,
  onRemove,
  teams,
  users,
  categories = [],
}: Props) {
  const field = condition.field ?? "subject";
  const operator = condition.operator ?? "contains";
  const value = condition.value;

  const needsValue = operator !== "isEmpty" && operator !== "isNotEmpty";
  const isMulti = operator === "in" || operator === "notIn";
  const valueArray = Array.isArray(value)
    ? value
    : value != null
      ? [value]
      : [];

  function setValue(next: unknown) {
    onChange({ ...condition, value: next });
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/50 p-2 text-sm">
      <select
        className="rounded border border-border bg-card px-2 py-1 text-xs"
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
        className="rounded border border-border bg-card px-2 py-1 text-xs"
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
          {field === "priority" && (
            <DropdownValueEditor
              isMulti={isMulti}
              options={PRIORITIES.map((p) => ({ value: p, label: p }))}
              value={value}
              valueArray={valueArray}
              placeholder="Select"
              onSetValue={setValue}
            />
          )}
          {field === "status" && (
            <DropdownValueEditor
              isMulti={isMulti}
              options={STATUSES.map((s) => ({
                value: s,
                label: s.replace(/_/g, " "),
              }))}
              value={value}
              valueArray={valueArray}
              placeholder="Select"
              onSetValue={setValue}
            />
          )}
          {field === "assignedTeamId" && (
            <DropdownValueEditor
              isMulti={isMulti}
              options={teams.map((t) => ({ value: t.id, label: t.name }))}
              value={value}
              valueArray={valueArray}
              placeholder="Select team"
              onSetValue={setValue}
            />
          )}
          {field === "assigneeId" && (
            <DropdownValueEditor
              isMulti={isMulti}
              options={users.map((u) => ({
                value: u.id,
                label: u.displayName,
              }))}
              value={value}
              valueArray={valueArray}
              placeholder="Select user"
              minWidth="min-w-[140px]"
              onSetValue={setValue}
            />
          )}
          {field === "categoryId" && (
            <DropdownValueEditor
              isMulti={isMulti}
              options={categories.map((c) => ({ value: c.id, label: c.name }))}
              value={value}
              valueArray={valueArray}
              placeholder="Select category"
              onSetValue={setValue}
            />
          )}
          {(field === "subject" || field === "description") && (
            <input
              type="text"
              className="rounded border border-border bg-card px-2 py-1 text-xs min-w-[120px]"
              placeholder={isMulti ? "Comma-separated" : "Value"}
              value={
                isMulti
                  ? valueArray.map(String).join(", ")
                  : value != null
                    ? String(value)
                    : ""
              }
              onChange={(e) => {
                const v = e.target.value;
                if (isMulti) {
                  setValue(
                    v
                      .split(",")
                      .map((s) => s.trim())
                      .filter(Boolean),
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
        className="rounded border border-border bg-card px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
      >
        Remove
      </button>
    </div>
  );
}
