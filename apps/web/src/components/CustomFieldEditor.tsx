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
        <label className="text-xs text-slate-500">Name</label>
        <input
          className="mt-1 w-full rounded-xl border border-slate-200 bg-white/80 px-3 py-2 text-sm"
          value={form.name}
          onChange={(e) => onChange({ name: e.target.value })}
          placeholder="e.g. Asset Tag"
          maxLength={80}
          required
        />
      </div>
      <div>
        <label className="text-xs text-slate-500">Field type</label>
        <select
          className="mt-1 w-full rounded-xl border border-slate-200 bg-white/80 px-3 py-2 text-sm"
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
            <label className="text-xs text-slate-500">
              Options (value / label)
            </label>
            <button
              type="button"
              onClick={addOption}
              className="text-xs text-slate-600 hover:text-slate-900 inline-flex items-center gap-1"
            >
              <Plus className="h-3 w-3" /> Add
            </button>
          </div>
          <div className="mt-1 space-y-2">
            {form.options.map((opt, i) => (
              <div key={i} className="flex gap-2 items-center">
                <input
                  className="flex-1 rounded-lg border border-slate-200 bg-white/80 px-2 py-1.5 text-sm"
                  value={opt.value}
                  onChange={(e) => updateOption(i, "value", e.target.value)}
                  placeholder="Value"
                />
                <input
                  className="flex-1 rounded-lg border border-slate-200 bg-white/80 px-2 py-1.5 text-sm"
                  value={opt.label}
                  onChange={(e) => updateOption(i, "label", e.target.value)}
                  placeholder="Label"
                />
                <button
                  type="button"
                  onClick={() => removeOption(i)}
                  className="p-1.5 text-slate-500 hover:text-red-600"
                  aria-label="Remove option"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
            {form.options.length === 0 && (
              <p className="text-xs text-slate-400">
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
          className="rounded border-slate-300"
        />
        <label
          htmlFor="custom-field-required"
          className="text-sm text-slate-700"
        >
          Required
        </label>
      </div>
      <div>
        <label className="text-xs text-slate-500">Team (scope)</label>
        <select
          className="mt-1 w-full rounded-xl border border-slate-200 bg-white/80 px-3 py-2 text-sm"
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
        <label className="text-xs text-slate-500">Category (scope)</label>
        <select
          className="mt-1 w-full rounded-xl border border-slate-200 bg-white/80 px-3 py-2 text-sm"
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
        <label className="text-xs text-slate-500">Sort order</label>
        <input
          type="number"
          className="mt-1 w-full rounded-xl border border-slate-200 bg-white/80 px-3 py-2 text-sm"
          value={form.sortOrder}
          onChange={(e) => onChange({ sortOrder: Number(e.target.value) || 0 })}
          min={0}
        />
      </div>
      <div className="flex gap-2 justify-end pt-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-xl border border-slate-200 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={saving || !form.name.trim()}
          className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );
}
