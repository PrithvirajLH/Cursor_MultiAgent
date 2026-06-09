import { type FormEvent } from "react";
import { Plus, Trash2 } from "lucide-react";
import type { CategoryRef, CustomFieldRecord, TeamRef } from "../api/client";

export const CUSTOM_FIELD_TYPES = [
  { value: "TEXT", label: "Text (single line)" },
  { value: "TEXTAREA", label: "Text Area (multi-line)" },
  { value: "NUMBER", label: "Number" },
  { value: "DROPDOWN", label: "Dropdown (single select)" },
  { value: "MULTISELECT", label: "Multi-select" },
  { value: "DATE", label: "Date" },
  { value: "CHECKBOX", label: "Checkbox" },
  { value: "USER", label: "User picker" },
] as const;

export type CustomFieldFormState = {
  name: string;
  fieldType: string;
  options: { value: string; label: string }[];
  isRequired: boolean;
  teamId: string;
  categoryId: string;
  sortOrder: number;
};

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

export function customFieldToFormState(
  field: CustomFieldRecord | null,
): CustomFieldFormState {
  if (!field) {
    return {
      name: "",
      fieldType: "TEXT",
      options: [],
      isRequired: false,
      teamId: "",
      categoryId: "",
      sortOrder: 0,
    };
  }
  return {
    name: field.name,
    fieldType: field.fieldType,
    options: parseOptions(field.options),
    isRequired: field.isRequired,
    teamId: field.teamId ?? "",
    categoryId: field.categoryId ?? "",
    sortOrder: field.sortOrder,
  };
}

export function formStateToPayload(form: CustomFieldFormState): {
  name: string;
  fieldType: string;
  options?: unknown;
  isRequired: boolean;
  teamId?: string;
  categoryId?: string;
  sortOrder: number;
} {
  const payload: {
    name: string;
    fieldType: string;
    options?: unknown;
    isRequired: boolean;
    teamId?: string;
    categoryId?: string;
    sortOrder: number;
  } = {
    name: form.name.trim(),
    fieldType: form.fieldType,
    isRequired: form.isRequired,
    sortOrder: form.sortOrder,
  };
  if (form.teamId) payload.teamId = form.teamId;
  if (form.categoryId) payload.categoryId = form.categoryId;
  if (form.fieldType === "DROPDOWN" || form.fieldType === "MULTISELECT") {
    payload.options = form.options
      .filter((o) => o.value.trim() !== "")
      .map((o) => ({
        value: o.value.trim(),
        label: o.label.trim() || o.value.trim(),
      }));
  }
  return payload;
}

export function CustomFieldEditor({
  form,
  onChange,
  onSubmit,
  onCancel,
  teamsList,
  categories,
  saving,
  error,
}: {
  form: CustomFieldFormState;
  onChange: (updates: Partial<CustomFieldFormState>) => void;
  onSubmit: (e: FormEvent<HTMLFormElement>) => void;
  onCancel: () => void;
  teamsList: TeamRef[];
  categories: CategoryRef[];
  saving: boolean;
  error: string | null;
}) {
  const needsOptions =
    form.fieldType === "DROPDOWN" || form.fieldType === "MULTISELECT";

  function addOption() {
    onChange({ options: [...form.options, { value: "", label: "" }] });
  }

  function removeOption(index: number) {
    onChange({ options: form.options.filter((_, i) => i !== index) });
  }

  function updateOption(index: number, key: "value" | "label", value: string) {
    const next = [...form.options];
    next[index] = { ...next[index], [key]: value };
    onChange({ options: next });
  }

  return (
    <form className="space-y-4" onSubmit={onSubmit}>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div>
        <label htmlFor="custom-field-name" className="text-xs text-muted-foreground">Name</label>
        <input
          id="custom-field-name"
          className="mt-1 w-full rounded-xl border border-border bg-card px-3 py-2 text-sm text-foreground"
          value={form.name}
          onChange={(e) => onChange({ name: e.target.value })}
          placeholder="e.g. Asset Tag"
          maxLength={80}
          required
        />
      </div>
      <div>
        <label htmlFor="custom-field-type" className="text-xs text-muted-foreground">Field type</label>
        <select
          id="custom-field-type"
          className="mt-1 w-full rounded-xl border border-border bg-card px-3 py-2 text-sm text-foreground"
          value={form.fieldType}
          onChange={(e) => onChange({ fieldType: e.target.value })}
        >
          {CUSTOM_FIELD_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </div>
      {needsOptions && (
        <div>
          <div className="flex items-center justify-between">
            <label className="text-xs text-muted-foreground">
              Options (value / label)
            </label>
            <button
              type="button"
              onClick={addOption}
              className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
            >
              <Plus className="h-3 w-3" /> Add
            </button>
          </div>
          <div className="mt-1 space-y-2">
            {form.options.map((opt, i) => (
              <div key={i} className="flex gap-2 items-center">
                <input
                  id={`custom-field-option-value-${i}`}
                  aria-label={`Option ${i + 1} value`}
                  className="flex-1 rounded-lg border border-border bg-card px-2 py-1.5 text-sm text-foreground"
                  value={opt.value}
                  onChange={(e) => updateOption(i, "value", e.target.value)}
                  placeholder="Value"
                />
                <input
                  id={`custom-field-option-label-${i}`}
                  aria-label={`Option ${i + 1} label`}
                  className="flex-1 rounded-lg border border-border bg-card px-2 py-1.5 text-sm text-foreground"
                  value={opt.label}
                  onChange={(e) => updateOption(i, "label", e.target.value)}
                  placeholder="Label"
                />
                <button
                  type="button"
                  onClick={() => removeOption(i)}
                  className="p-1.5 text-muted-foreground hover:text-red-400"
                  aria-label="Remove option"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
            {form.options.length === 0 && (
              <p className="text-xs text-muted-foreground">
                No options yet. Add at least one for dropdown/multi-select.
              </p>
            )}
          </div>
        </div>
      )}
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="custom-field-required"
          checked={form.isRequired}
          onChange={(e) => onChange({ isRequired: e.target.checked })}
          className="rounded border-border"
        />
        <label
          htmlFor="custom-field-required"
          className="text-sm text-foreground"
        >
          Required
        </label>
      </div>
      <div>
        <label htmlFor="custom-field-team" className="text-xs text-muted-foreground">Team (scope)</label>
        <select
          id="custom-field-team"
          className="mt-1 w-full rounded-xl border border-border bg-card px-3 py-2 text-sm text-foreground"
          value={form.teamId}
          onChange={(e) => onChange({ teamId: e.target.value })}
        >
          <option value="">All teams</option>
          {teamsList.map((team) => (
            <option key={team.id} value={team.id}>
              {team.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="custom-field-category" className="text-xs text-muted-foreground">Category (scope)</label>
        <select
          id="custom-field-category"
          className="mt-1 w-full rounded-xl border border-border bg-card px-3 py-2 text-sm text-foreground"
          value={form.categoryId}
          onChange={(e) => onChange({ categoryId: e.target.value })}
        >
          <option value="">Any category</option>
          {categories.map((cat) => (
            <option key={cat.id} value={cat.id}>
              {cat.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="custom-field-sort-order" className="text-xs text-muted-foreground">Sort order</label>
        <input
          id="custom-field-sort-order"
          type="number"
          className="mt-1 w-full rounded-xl border border-border bg-card px-3 py-2 text-sm text-foreground"
          value={form.sortOrder}
          onChange={(e) => onChange({ sortOrder: Number(e.target.value) || 0 })}
          min={0}
        />
      </div>
      <div className="flex gap-2 justify-end pt-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-xl border border-border px-4 py-2 text-sm text-foreground hover:bg-accent"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={saving || !form.name.trim()}
          className="rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );
}
