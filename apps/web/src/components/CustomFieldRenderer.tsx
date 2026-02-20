import type { CustomFieldRecord, CustomFieldValueRecord, UserRef } from '../api/client';

function parseOptions(raw: unknown): { value: string; label: string }[] {
  if (Array.isArray(raw)) {
    return raw.map((item) => {
      if (item && typeof item === 'object' && 'value' in item) {
        return {
          value: String((item as { value: unknown }).value ?? ''),
          label: String((item as { label?: unknown }).label ?? (item as { value: unknown }).value ?? '')
        };
      }
      return { value: String(item), label: String(item) };
    });
  }
  return [];
}

/** Display a single custom field value (read-only). */
export function CustomFieldDisplay({
  field,
  value
}: {
  field: CustomFieldRecord;
  value: string | null | undefined;
}) {
  const raw = value ?? null;
  const label = field.name;
  const isRequired = field.isRequired;

  if (raw === null || raw === '') {
    return (
      <div className="flex flex-wrap gap-x-2 gap-y-1">
        <span className="text-xs text-slate-500">{label}{isRequired ? ' *' : ''}</span>
        <span className="text-sm text-slate-400">—</span>
      </div>
    );
  }

  switch (field.fieldType) {
    case 'CHECKBOX':
      return (
        <div className="flex flex-wrap gap-x-2 gap-y-1">
          <span className="text-xs text-slate-500">{label}{isRequired ? ' *' : ''}</span>
          <span className="text-sm text-slate-700">{raw === 'true' || raw === '1' ? 'Yes' : 'No'}</span>
        </div>
      );
    case 'DATE':
      return (
        <div className="flex flex-wrap gap-x-2 gap-y-1">
          <span className="text-xs text-slate-500">{label}{isRequired ? ' *' : ''}</span>
          <span className="text-sm text-slate-700">{raw}</span>
        </div>
      );
    case 'DROPDOWN':
    case 'USER': {
      const options = parseOptions(field.options);
      const option = options.find((o) => o.value === raw);
      const display = option ? option.label : raw;
      return (
        <div className="flex flex-wrap gap-x-2 gap-y-1">
          <span className="text-xs text-slate-500">{label}{isRequired ? ' *' : ''}</span>
          <span className="text-sm text-slate-700">{display}</span>
        </div>
      );
    }
    case 'MULTISELECT': {
      const options = parseOptions(field.options);
      const values = raw.split(',').map((v) => v.trim()).filter(Boolean);
      const labels = values.map((v) => options.find((o) => o.value === v)?.label ?? v);
      return (
        <div className="flex flex-wrap gap-x-2 gap-y-1">
          <span className="text-xs text-slate-500">{label}{isRequired ? ' *' : ''}</span>
          <span className="text-sm text-slate-700">{labels.length ? labels.join(', ') : raw}</span>
        </div>
      );
    }
    default:
      return (
        <div className="flex flex-wrap gap-x-2 gap-y-1">
          <span className="text-xs text-slate-500">{label}{isRequired ? ' *' : ''}</span>
          <span className="text-sm text-slate-700 whitespace-pre-wrap">{raw}</span>
        </div>
      );
  }
}

/** Edit a single custom field (controlled input). */
export function CustomFieldInput({
  field,
  value,
  onChange,
  users = []
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

  const inputClass = 'mt-1 w-full rounded-xl border border-slate-200 bg-white/80 px-3 py-2 text-sm';

  switch (field.fieldType) {
    case 'TEXT':
      return (
        <div>
          <label htmlFor={inputId} className="text-xs text-slate-500">{label}{isRequired ? ' *' : ''}</label>
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
    case 'TEXTAREA':
      return (
        <div>
          <label htmlFor={inputId} className="text-xs text-slate-500">{label}{isRequired ? ' *' : ''}</label>
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
    case 'NUMBER':
      return (
        <div>
          <label htmlFor={inputId} className="text-xs text-slate-500">{label}{isRequired ? ' *' : ''}</label>
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
    case 'DATE':
      return (
        <div>
          <label htmlFor={inputId} className="text-xs text-slate-500">{label}{isRequired ? ' *' : ''}</label>
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
    case 'CHECKBOX':
      return (
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id={inputId}
            checked={value === 'true' || value === '1'}
            onChange={(e) => onChange(e.target.checked ? 'true' : '')}
            className="rounded border-slate-300"
          />
          <label htmlFor={inputId} className="text-sm text-slate-700">{label}{isRequired ? ' *' : ''}</label>
        </div>
      );
    case 'DROPDOWN':
      return (
        <div>
          <label htmlFor={inputId} className="text-xs text-slate-500">{label}{isRequired ? ' *' : ''}</label>
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
    case 'MULTISELECT': {
      const selected = value ? value.split(',').map((v) => v.trim()).filter(Boolean) : [];
      function toggle(val: string) {
        const next = selected.includes(val)
          ? selected.filter((v) => v !== val)
          : [...selected, val];
        onChange(next.join(','));
      }
      return (
        <fieldset>
          <legend className="text-xs text-slate-500">{label}{isRequired ? ' *' : ''}</legend>
          <div className="mt-1 flex flex-wrap gap-2">
            {options.map((opt, index) => {
              const optionId = `${inputId}-${index}`;
              return (
                <div key={opt.value} className="inline-flex items-center gap-1.5 text-sm text-slate-700">
                <input
                  id={optionId}
                  type="checkbox"
                  checked={selected.includes(opt.value)}
                  onChange={() => toggle(opt.value)}
                  className="rounded border-slate-300"
                />
                <label htmlFor={optionId}>{opt.label}</label>
              </div>
              );
            })}
          </div>
        </fieldset>
      );
    }
    case 'USER':
      if (users.length === 0) {
        return (
          <div>
            <label htmlFor={inputId} className="text-xs text-slate-500">{label}{isRequired ? ' *' : ''}</label>
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
          <label htmlFor={inputId} className="text-xs text-slate-500">{label}{isRequired ? ' *' : ''}</label>
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
          <label htmlFor={inputId} className="text-xs text-slate-500">{label}{isRequired ? ' *' : ''}</label>
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
export function CustomFieldsDisplay({ values }: { values: CustomFieldValueRecord[] }) {
  if (!values?.length) return null;
  return (
    <div className="space-y-2">
      {values.map((cv) => (
        <CustomFieldDisplay key={cv.id} field={cv.customField} value={cv.value} />
      ))}
    </div>
  );
}
