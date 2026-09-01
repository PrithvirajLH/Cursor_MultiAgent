import type { ReactNode } from "react";
import type {
  CustomFieldRecord,
  CustomFieldValueRecord,
  UserRef,
} from "../api/client";

function parseOptions(raw: unknown): { value: string; label: string }[] {
  if (Array.isArray(raw)) {
    return raw.map((item) => {
      if (item && typeof item === "object" && "value" in item) {
        return {
          value: String((item as { value: unknown }).value ?? ""),
          label: String(
            (item as { label?: unknown }).label ??
              (item as { value: unknown }).value ??
              "",
          ),
        };
      }
      return { value: String(item), label: String(item) };
    });
  }
  return [];
}

/** Display a single custom field value (read-only). */
/**
 * One custom-field row in the ticket sidebar.
 *
 * Laid out to match `DetailRow` in `TicketSidebar` — fixed label column, value
 * right-aligned — so the Custom Fields panel reads as part of the same sidebar as
 * the Information panel directly above it. Before this, every field type carried
 * its own copy of a `flex flex-wrap` wrapper with no label column, so values
 * started at a different x position on every row.
 *
 * A long label is allowed to wrap rather than truncate: the label is what tells
 * an agent what they are looking at. A long value truncates and keeps the whole
 * string in `title`.
 */
/**
 * Beyond this many characters a value cannot sit on one truncated line in a
 * sidebar without hiding most of itself, so it stacks under its label instead.
 * The old layout wrapped everything and never truncated; aligning the short
 * values must not cost the long ones their readability.
 */
const STACK_VALUE_OVER_CHARS = 32;

function FieldRow({
  label,
  isRequired,
  children,
  full,
}: {
  label: string;
  isRequired: boolean;
  children: ReactNode;
  /** Stack label above value — for content a single truncated line cannot carry. */
  full?: boolean;
}) {
  const labelText = `${label}${isRequired ? " *" : ""}`;
  if (full) {
    return (
      <div className="space-y-1">
        <span className="block text-xs leading-snug text-muted-foreground">
          {labelText}
        </span>
        <span className="block whitespace-pre-wrap break-words text-xs font-medium text-foreground">
          {children}
        </span>
      </div>
    );
  }
  return (
    <div className="flex items-baseline gap-x-3">
      <span className="w-[104px] shrink-0 text-xs leading-snug text-muted-foreground">
        {labelText}
      </span>
      <span className="min-w-0 flex-1 truncate text-right text-xs font-medium text-foreground">
        {children}
      </span>
    </div>
  );
}

export function CustomFieldDisplay({
  field,
  value,
}: {
  field: CustomFieldRecord;
  value: string | null | undefined;
}) {
  const raw = value ?? null;
  const label = field.name;
  const isRequired = field.isRequired;

  if (raw === null || raw === "") {
    return (
      <FieldRow label={label} isRequired={isRequired}>
        <span className="text-muted-foreground">—</span>
      </FieldRow>
    );
  }

  switch (field.fieldType) {
    case "CHECKBOX":
      return (
        <FieldRow label={label} isRequired={isRequired}>
          {raw === "true" || raw === "1" ? "Yes" : "No"}
        </FieldRow>
      );
    case "DROPDOWN":
    case "USER": {
      const options = parseOptions(field.options);
      const option = options.find((o) => o.value === raw);
      const display = option ? option.label : raw;
      return (
        <FieldRow
          label={label}
          isRequired={isRequired}
          full={display.length > STACK_VALUE_OVER_CHARS}
        >
          <span title={display}>{display}</span>
        </FieldRow>
      );
    }
    case "MULTISELECT": {
      const options = parseOptions(field.options);
      const selected = raw
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean);
      const labels = selected.map(
        (v) => options.find((o) => o.value === v)?.label ?? v,
      );
      // Several values will not fit on one truncated line without losing some.
      return (
        <FieldRow label={label} isRequired={isRequired} full>
          {labels.length ? labels.join(", ") : raw}
        </FieldRow>
      );
    }
    case "TEXTAREA":
      // Free text, and the reason the original kept `whitespace-pre-wrap`.
      return (
        <FieldRow label={label} isRequired={isRequired} full>
          {raw}
        </FieldRow>
      );
    default:
      return (
        <FieldRow
          label={label}
          isRequired={isRequired}
          full={raw.length > STACK_VALUE_OVER_CHARS}
        >
          <span title={raw}>{raw}</span>
        </FieldRow>
      );
  }
}


/** Edit a single custom field (controlled input). */
export function CustomFieldInput({
  field,
  value,
  onChange,
  users = [],
}: {
  field: CustomFieldRecord;
  value: string;
  onChange: (value: string) => void;
  users?: UserRef[];
}) {
  const label = field.name;
  const isRequired = field.isRequired;
  const options = parseOptions(field.options);
  const inputId = `cf-input-${field.id}`;

  const inputClass =
    "mt-1 w-full rounded-xl border border-border bg-card px-3 py-2 text-sm text-foreground";

  switch (field.fieldType) {
    case "TEXT":
      return (
        <div>
          <label htmlFor={inputId} className="text-xs text-muted-foreground">
            {label}
            {isRequired ? " *" : ""}
          </label>
          <input
            id={inputId}
            type="text"
            className={inputClass}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            required={isRequired}
          />
        </div>
      );
    case "TEXTAREA":
      return (
        <div>
          <label htmlFor={inputId} className="text-xs text-muted-foreground">
            {label}
            {isRequired ? " *" : ""}
          </label>
          <textarea
            id={inputId}
            className={inputClass}
            rows={3}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            required={isRequired}
          />
        </div>
      );
    case "NUMBER":
      return (
        <div>
          <label htmlFor={inputId} className="text-xs text-muted-foreground">
            {label}
            {isRequired ? " *" : ""}
          </label>
          <input
            id={inputId}
            type="number"
            className={inputClass}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            required={isRequired}
          />
        </div>
      );
    case "DATE":
      return (
        <div>
          <label htmlFor={inputId} className="text-xs text-muted-foreground">
            {label}
            {isRequired ? " *" : ""}
          </label>
          <input
            id={inputId}
            type="date"
            className={inputClass}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            required={isRequired}
          />
        </div>
      );
    case "CHECKBOX":
      return (
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id={inputId}
            checked={value === "true" || value === "1"}
            onChange={(e) => onChange(e.target.checked ? "true" : "")}
            className="rounded border-border"
          />
          <label htmlFor={inputId} className="text-sm text-foreground">
            {label}
            {isRequired ? " *" : ""}
          </label>
        </div>
      );
    case "DROPDOWN":
      return (
        <div>
          <label htmlFor={inputId} className="text-xs text-muted-foreground">
            {label}
            {isRequired ? " *" : ""}
          </label>
          <select
            id={inputId}
            className={inputClass}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            required={isRequired}
          >
            <option value="">Select…</option>
            {options.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      );
    case "MULTISELECT": {
      const selected = value
        ? value
            .split(",")
            .map((v) => v.trim())
            .filter(Boolean)
        : [];
      function toggle(val: string) {
        const next = selected.includes(val)
          ? selected.filter((v) => v !== val)
          : [...selected, val];
        onChange(next.join(","));
      }
      return (
        <fieldset>
          <legend className="text-xs text-muted-foreground">
            {label}
            {isRequired ? " *" : ""}
          </legend>
          <div className="mt-1 flex flex-wrap gap-2">
            {options.map((opt, index) => {
              const optionId = `${inputId}-${index}`;
              return (
                <div
                  key={opt.value}
                  className="inline-flex items-center gap-1.5 text-sm text-foreground"
                >
                  <input
                    id={optionId}
                    type="checkbox"
                    checked={selected.includes(opt.value)}
                    onChange={() => toggle(opt.value)}
                    className="rounded border-border"
                  />
                  <label htmlFor={optionId}>{opt.label}</label>
                </div>
              );
            })}
          </div>
        </fieldset>
      );
    }
    case "USER":
      if (users.length === 0) {
        return (
          <div>
            <label htmlFor={inputId} className="text-xs text-muted-foreground">
              {label}
              {isRequired ? " *" : ""}
            </label>
            <input
              id={inputId}
              type="text"
              className={inputClass}
              value={value}
              onChange={(e) => onChange(e.target.value)}
              required={isRequired}
              placeholder="Enter user ID"
            />
          </div>
        );
      }
      return (
        <div>
          <label htmlFor={inputId} className="text-xs text-muted-foreground">
            {label}
            {isRequired ? " *" : ""}
          </label>
          <select
            id={inputId}
            className={inputClass}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            required={isRequired}
          >
            <option value="">Select user…</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.displayName || u.email}
              </option>
            ))}
          </select>
        </div>
      );
    default:
      return (
        <div>
          <label htmlFor={inputId} className="text-xs text-muted-foreground">
            {label}
            {isRequired ? " *" : ""}
          </label>
          <input
            id={inputId}
            type="text"
            className={inputClass}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            required={isRequired}
          />
        </div>
      );
  }
}

/** Render a list of custom field values (read-only) from ticket. */
export function CustomFieldsDisplay({
  values,
}: {
  values: CustomFieldValueRecord[];
}) {
  if (!values?.length) return null;
  return (
    <div className="space-y-2">
      {values.map((cv) => (
        <CustomFieldDisplay
          key={cv.id}
          field={cv.customField}
          value={cv.value}
        />
      ))}
    </div>
  );
}
