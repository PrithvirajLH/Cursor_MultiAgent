import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  AlignLeft,
  Calendar,
  CheckSquare,
  ChevronDown,
  Hash,
  Plus,
  Type,
  Users,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import {
  createCustomField,
  fetchCategories,
  fetchTeams,
  type CategoryRef,
  type TeamRef,
} from "../api/client";
import { TopBar } from "../components/TopBar";
import { useHeaderContext } from "../contexts/HeaderContext";
import { useToast } from "../hooks/useToast";
import type { Role } from "../types";
import { handleApiError } from "../utils/handleApiError";

type UiFieldType =
  | "text"
  | "textarea"
  | "number"
  | "dropdown"
  | "multiselect"
  | "checkbox"
  | "date"
  | "user";

type FieldFormState = {
  label: string;
  type: UiFieldType;
  required: boolean;
  teamId: string;
  options: string[];
  sortOrder: number;
  categoryId: string;
};

const FIELD_TYPES: Array<{
  value: UiFieldType;
  label: string;
  apiType: string;
  icon: typeof Type;
}> = [
  { value: "text", label: "Short Text", apiType: "TEXT", icon: Type },
  {
    value: "textarea",
    label: "Long Text",
    apiType: "TEXTAREA",
    icon: AlignLeft,
  },
  { value: "number", label: "Number", apiType: "NUMBER", icon: Hash },
  {
    value: "dropdown",
    label: "Dropdown",
    apiType: "DROPDOWN",
    icon: ChevronDown,
  },
  {
    value: "multiselect",
    label: "Multi Select",
    apiType: "MULTISELECT",
    icon: CheckSquare,
  },
  {
    value: "checkbox",
    label: "Checkbox",
    apiType: "CHECKBOX",
    icon: CheckSquare,
  },
  { value: "date", label: "Date", apiType: "DATE", icon: Calendar },
  { value: "user", label: "User", apiType: "USER", icon: Users },
];

const UI_TO_API_TYPE: Record<UiFieldType, string> = FIELD_TYPES.reduce(
  (acc, type) => {
    acc[type.value] = type.apiType;
    return acc;
  },
  {} as Record<UiFieldType, string>,
);

function createEmptyForm(teamId = ""): FieldFormState {
  return {
    label: "",
    type: "text",
    required: false,
    teamId,
    options: [],
    sortOrder: 0,
    categoryId: "",
  };
}

export function NewCustomFieldPage({ role }: { role?: Role }) {
  const headerCtx = useHeaderContext();
  const toast = useToast();
  const navigate = useNavigate();

  const isTeamAdmin = role === "TEAM_ADMIN";

  const [teamsList, setTeamsList] = useState<TeamRef[]>([]);
  const [categories, setCategories] = useState<CategoryRef[]>([]);
  const [form, setForm] = useState<FieldFormState>(() => createEmptyForm());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const resolvedTeamAdminTeamId = useMemo(() => {
    if (!isTeamAdmin) return "";
    return teamsList.length === 1 ? teamsList[0].id : "";
  }, [isTeamAdmin, teamsList]);

  useEffect(() => {
    setLoading(true);
    setError(null);
    Promise.all([fetchTeams(), fetchCategories({ includeInactive: false })])
      .then(([teamsResponse, categoriesResponse]) => {
        setTeamsList(teamsResponse.data);
        setCategories(categoriesResponse.data);
        if (isTeamAdmin) {
          const nextTeamId =
            teamsResponse.data.length === 1 ? teamsResponse.data[0].id : "";
          setForm(() => createEmptyForm(nextTeamId));
        }
      })
      .catch((err) => {
        const message = handleApiError(err);
        setError(message);
        toast.error(message);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [isTeamAdmin, toast]);

  function addOption() {
    setForm((prev) => ({
      ...prev,
      options: [...prev.options, ""],
    }));
  }

  function removeOption(index: number) {
    setForm((prev) => ({
      ...prev,
      options: prev.options.filter((_, i) => i !== index),
    }));
  }

  function updateOption(index: number, value: string) {
    setForm((prev) => ({
      ...prev,
      options: prev.options.map((option, i) => (i === index ? value : option)),
    }));
  }

  async function handleSubmit() {
    if (!form.label.trim()) {
      const message = "Field label is required.";
      setError(message);
      toast.error(message);
      return;
    }
    if (isTeamAdmin && !resolvedTeamAdminTeamId) {
      const message =
        "Team admin requires a primary team to manage custom fields.";
      setError(message);
      toast.error(message);
      return;
    }

    const trimmedOptions = form.options
      .map((option) => option.trim())
      .filter(Boolean);
    if (
      (form.type === "dropdown" || form.type === "multiselect") &&
      trimmedOptions.length === 0
    ) {
      const message =
        "Dropdown and multi-select fields require at least one option.";
      setError(message);
      toast.error(message);
      return;
    }

    const scopedTeamId = isTeamAdmin
      ? resolvedTeamAdminTeamId
      : form.teamId || undefined;
    const optionsPayload =
      form.type === "dropdown" || form.type === "multiselect"
        ? trimmedOptions.map((option) => ({ value: option, label: option }))
        : undefined;

    const payload: Parameters<typeof createCustomField>[0] = {
      name: form.label.trim(),
      fieldType: UI_TO_API_TYPE[form.type],
      isRequired: form.required,
      sortOrder: Math.max(0, Number(form.sortOrder) || 0),
      teamId: scopedTeamId,
      categoryId: form.categoryId || undefined,
      options: optionsPayload,
    };

    setSaving(true);
    setError(null);
    try {
      await createCustomField(payload);
      toast.success("Custom field created.");
      navigate("/custom-fields");
    } catch (err) {
      const message = handleApiError(err);
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  const headerValue = headerCtx;

  return (
    <section className="min-h-full bg-slate-50 animate-fade-in">
      <div className="sticky top-0 z-40 border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-[1600px] py-4 px-6">
          {headerValue ? (
            <TopBar
              title={headerValue.title}
              subtitle={headerValue.subtitle}
              currentEmail={headerValue.currentEmail}
              onOpenSearch={headerValue.onOpenSearch}
              notificationProps={headerValue.notificationProps}
              leftContent={
                <div className="min-w-0">
                  <h1 className="text-xl font-semibold text-slate-900">
                    New Custom Field
                  </h1>
                  <p className="mt-0.5 text-sm text-slate-500">
                    Define an additional ticket field for your forms and
                    workflows.
                  </p>
                </div>
              }
            />
          ) : (
            <div className="min-w-0">
              <h1 className="text-xl font-semibold text-slate-900">
                New Custom Field
              </h1>
              <p className="mt-0.5 text-sm text-slate-500">
                Define an additional ticket field for your forms and workflows.
              </p>
            </div>
          )}
        </div>
      </div>

      <div className="mx-auto w-full max-w-[900px] px-6 py-8">
        <button
          type="button"
          onClick={() => navigate("/custom-fields")}
          className="mb-4 inline-flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-slate-900"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>Back to custom fields</span>
        </button>

        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-6 py-4">
            <h2 className="text-lg font-semibold text-slate-900">
              Field configuration
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Choose a field type, scope, and behavior. You can edit this later.
            </p>
          </div>

          <div className="space-y-6 px-6 py-6">
            <div className="grid gap-4 md:grid-cols-3">
              <div className="md:col-span-2">
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Field label <span className="text-red-500">*</span>
                </label>
                <input
                  value={form.label}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, label: event.target.value }))
                  }
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-transparent focus:ring-2 focus:ring-blue-500"
                  placeholder="e.g. Asset tag, Account ID, Room number"
                />
              </div>
              <div className="space-y-2">
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Sort order
                </label>
                <input
                  type="number"
                  min={0}
                  value={form.sortOrder}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      sortOrder: Number(event.target.value) || 0,
                    }))
                  }
                  className="w-24 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-transparent focus:ring-2 focus:ring-blue-500"
                />
                <p className="text-xs text-slate-500">
                  Lower numbers appear higher in the form.
                </p>
              </div>
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <p className="text-sm font-semibold text-slate-800">
                  Field type
                </p>
                <span className="text-xs text-slate-400">
                  Choose how this field is captured.
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {FIELD_TYPES.map((type) => {
                  const TypeIcon = type.icon;
                  const selected = form.type === type.value;
                  return (
                    <button
                      key={type.value}
                      type="button"
                      onClick={() =>
                        setForm((prev) => ({
                          ...prev,
                          type: type.value,
                          options:
                            type.value === "dropdown" ||
                            type.value === "multiselect"
                              ? prev.options
                              : [],
                        }))
                      }
                      className={`flex flex-col items-center rounded-lg border p-3 text-xs font-medium transition-all ${
                        selected
                          ? "border-blue-500 bg-blue-50 text-blue-700"
                          : "border-slate-200 text-slate-600 hover:border-slate-300"
                      }`}
                    >
                      <TypeIcon className="mb-1 h-5 w-5" />
                      {type.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {(form.type === "dropdown" || form.type === "multiselect") && (
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-sm font-semibold text-slate-800">
                    Options
                  </p>
                  <span className="text-xs text-slate-400">
                    These values appear in the dropdown.
                  </span>
                </div>
                <div className="space-y-1.5">
                  {form.options.map((option, index) => (
                    <div
                      key={`option-${index}`}
                      className="flex items-center space-x-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5"
                    >
                      <input
                        value={option}
                        onChange={(event) =>
                          updateOption(index, event.target.value)
                        }
                        className="flex-1 bg-transparent text-sm text-slate-700 outline-none"
                        placeholder="Option value"
                      />
                      <button
                        type="button"
                        onClick={() => removeOption(index)}
                        className="text-slate-400 hover:text-red-500"
                      >
                        <CheckSquare className="h-3.5 w-3.5 rotate-45" />
                      </button>
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={addOption}
                  className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>Add option</span>
                </button>
              </div>
            )}

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Category scope
                </label>
                <select
                  value={form.categoryId}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      categoryId: event.target.value,
                    }))
                  }
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-transparent focus:ring-2 focus:ring-blue-500"
                  disabled={loading}
                >
                  <option value="">All categories</option>
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-slate-500">
                  Limit this field to tickets in a specific category, or keep it
                  global.
                </p>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Team scope
                </label>
                {isTeamAdmin ? (
                  <input
                    value={
                      resolvedTeamAdminTeamId
                        ? (teamsList.find(
                            (team) => team.id === resolvedTeamAdminTeamId,
                          )?.name ?? resolvedTeamAdminTeamId)
                        : "Primary team unavailable"
                    }
                    disabled
                    className="w-full rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 text-sm text-slate-600"
                  />
                ) : (
                  <select
                    value={form.teamId}
                    onChange={(event) =>
                      setForm((prev) => ({
                        ...prev,
                        teamId: event.target.value,
                      }))
                    }
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-transparent focus:ring-2 focus:ring-blue-500"
                    disabled={loading}
                  >
                    <option value="">All teams (global)</option>
                    {teamsList.map((team) => (
                      <option key={team.id} value={team.id}>
                        {team.name}
                      </option>
                    ))}
                  </select>
                )}
                <p className="mt-1 text-xs text-slate-500">
                  Control whether this field is global or only for one team.
                </p>
              </div>
            </div>

            <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div>
                <p className="text-sm font-medium text-slate-700">Required</p>
                <p className="text-xs text-slate-500">
                  The field must be filled before the ticket can be submitted.
                </p>
              </div>
              <input
                type="checkbox"
                checked={form.required}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    required: event.target.checked,
                  }))
                }
                className="h-4 w-4 rounded text-blue-600"
              />
            </div>
          </div>

          <div className="flex items-center justify-between rounded-b-2xl border-t border-slate-200 bg-slate-50 px-6 py-4">
            <span className="text-xs text-slate-400">
              * Required fields. Changes take effect immediately for new
              tickets.
            </span>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => navigate("/custom-fields")}
                disabled={saving}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleSubmit()}
                disabled={saving || loading}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
              >
                {saving ? "Creating…" : "Create field"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
