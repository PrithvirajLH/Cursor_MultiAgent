import { useEffect, useMemo, useState } from 'react';
import {
  AlignLeft,
  Calendar,
  CheckSquare,
  ChevronDown,
  Hash,
  Pencil,
  Plus,
  Trash2,
  Type
} from 'lucide-react';
import {
  ApiError,
  createCustomField,
  deleteCustomField,
  fetchCustomFields,
  fetchTeams,
  updateCustomField,
  type CustomFieldRecord,
  type NotificationRecord,
  type TeamRef
} from '../api/client';
import { TopBar } from '../components/TopBar';
import type { Role } from '../types';

type CustomFieldsHeaderProps = {
  title: string;
  subtitle: string;
  currentEmail: string;
  personas: { label: string; email: string }[];
  onEmailChange: (email: string) => void;
  onOpenSearch?: () => void;
  notificationProps?: {
    notifications: NotificationRecord[];
    unreadCount: number;
    loading: boolean;
    hasMore: boolean;
    onLoadMore: () => void;
    onMarkAsRead: (id: string) => void;
    onMarkAllAsRead: () => void;
    onRefresh: () => void;
  };
};

type UiFieldType = 'text' | 'textarea' | 'number' | 'dropdown' | 'checkbox' | 'date';

type FieldFormState = {
  id: string | null;
  label: string;
  type: UiFieldType;
  required: boolean;
  showList: boolean;
  showDetail: boolean;
  teamIds: string[];
  placeholder: string;
  options: string[];
  sortOrder: number;
  categoryId: string;
};

type FieldUiMeta = {
  showList: boolean;
  showDetail: boolean;
  placeholder: string;
  teamIds: string[];
};

const UI_META_STORAGE_KEY = 'web:custom-field-ui-meta';

const FIELD_TYPES: Array<{
  value: UiFieldType;
  label: string;
  apiType: string;
  icon: typeof Type;
}> = [
  { value: 'text', label: 'Short Text', apiType: 'TEXT', icon: Type },
  { value: 'textarea', label: 'Long Text', apiType: 'TEXTAREA', icon: AlignLeft },
  { value: 'number', label: 'Number', apiType: 'NUMBER', icon: Hash },
  { value: 'dropdown', label: 'Dropdown', apiType: 'DROPDOWN', icon: ChevronDown },
  { value: 'checkbox', label: 'Checkbox', apiType: 'CHECKBOX', icon: CheckSquare },
  { value: 'date', label: 'Date', apiType: 'DATE', icon: Calendar }
];

const API_TO_UI_TYPE: Record<string, UiFieldType> = {
  TEXT: 'text',
  TEXTAREA: 'textarea',
  NUMBER: 'number',
  DROPDOWN: 'dropdown',
  MULTISELECT: 'dropdown',
  CHECKBOX: 'checkbox',
  DATE: 'date',
  USER: 'text'
};

const UI_TO_API_TYPE: Record<UiFieldType, string> = FIELD_TYPES.reduce((acc, type) => {
  acc[type.value] = type.apiType;
  return acc;
}, {} as Record<UiFieldType, string>);

function apiErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    try {
      const parsed = JSON.parse(error.message) as { message?: string };
      if (typeof parsed.message === 'string' && parsed.message.trim()) {
        return parsed.message;
      }
    } catch {
      // keep fallback
    }
    return error.message || 'Request failed';
  }
  if (error instanceof Error) return error.message;
  return 'Request failed';
}

function parseOptionLabels(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((option) => {
      if (option && typeof option === 'object') {
        if ('label' in option && typeof (option as { label?: unknown }).label === 'string') {
          return (option as { label: string }).label.trim();
        }
        if ('value' in option && typeof (option as { value?: unknown }).value === 'string') {
          return (option as { value: string }).value.trim();
        }
      }
      return String(option ?? '').trim();
    })
    .filter(Boolean);
}

function fieldTypeLabel(fieldType: string): string {
  const uiType = API_TO_UI_TYPE[fieldType] ?? 'text';
  return FIELD_TYPES.find((type) => type.value === uiType)?.label ?? fieldType;
}

function fieldTypeIcon(fieldType: string) {
  const uiType = API_TO_UI_TYPE[fieldType] ?? 'text';
  return FIELD_TYPES.find((type) => type.value === uiType)?.icon ?? Type;
}

function defaultMetaFromField(field: CustomFieldRecord): FieldUiMeta {
  return {
    showList: false,
    showDetail: true,
    placeholder: '',
    teamIds: field.teamId ? [field.teamId] : []
  };
}

function buildFormFromField(field: CustomFieldRecord, meta?: FieldUiMeta): FieldFormState {
  const mergedMeta = meta ?? defaultMetaFromField(field);
  return {
    id: field.id,
    label: field.name,
    type: API_TO_UI_TYPE[field.fieldType] ?? 'text',
    required: field.isRequired,
    showList: mergedMeta.showList,
    showDetail: mergedMeta.showDetail,
    teamIds: mergedMeta.teamIds,
    placeholder: mergedMeta.placeholder,
    options: parseOptionLabels(field.options),
    sortOrder: field.sortOrder,
    categoryId: field.categoryId ?? ''
  };
}

function createEmptyForm(teamIds: string[] = []): FieldFormState {
  return {
    id: null,
    label: '',
    type: 'text',
    required: false,
    showList: false,
    showDetail: true,
    teamIds,
    placeholder: '',
    options: [],
    sortOrder: 0,
    categoryId: ''
  };
}

function loadStoredUiMeta(): Record<string, FieldUiMeta> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(UI_META_STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, FieldUiMeta>;
  } catch {
    return {};
  }
}

export function CustomFieldsAdminPage({
  role,
  headerProps
}: {
  role?: Role;
  headerProps?: CustomFieldsHeaderProps;
}) {
  const canEdit = role ? role === 'TEAM_ADMIN' || role === 'OWNER' : true;
  const [fields, setFields] = useState<CustomFieldRecord[]>([]);
  const [teamsList, setTeamsList] = useState<TeamRef[]>([]);
  const [uiMetaById, setUiMetaById] = useState<Record<string, FieldUiMeta>>(() =>
    loadStoredUiMeta()
  );

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [showEditor, setShowEditor] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<CustomFieldRecord | null>(null);
  const [form, setForm] = useState<FieldFormState>(createEmptyForm());

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(UI_META_STORAGE_KEY, JSON.stringify(uiMetaById));
  }, [uiMetaById]);

  useEffect(() => {
    void loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    setError(null);
    try {
      const [teamsResponse, fieldsResponse] = await Promise.all([
        fetchTeams(),
        fetchCustomFields()
      ]);

      const sortedFields = [...fieldsResponse.data].sort(
        (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)
      );
      setTeamsList(teamsResponse.data);
      setFields(sortedFields);

      setUiMetaById((prev) => {
        const next = { ...prev };
        sortedFields.forEach((field) => {
          if (!next[field.id]) {
            next[field.id] = defaultMetaFromField(field);
          }
        });
        return next;
      });
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  function teamLabel(teamId: string): string {
    return teamsList.find((team) => team.id === teamId)?.name ?? teamId;
  }

  function openCreate() {
    setError(null);
    setNotice(null);
    setForm(createEmptyForm());
    setShowEditor(true);
  }

  function openEdit(field: CustomFieldRecord) {
    setError(null);
    setNotice(null);
    setForm(buildFormFromField(field, uiMetaById[field.id]));
    setShowEditor(true);
  }

  function closeEditor() {
    setShowEditor(false);
    setForm(createEmptyForm());
  }

  function toggleTeam(teamId: string) {
    setForm((prev) => ({
      ...prev,
      teamIds: prev.teamIds.includes(teamId)
        ? prev.teamIds.filter((id) => id !== teamId)
        : [...prev.teamIds, teamId]
    }));
  }

  function addOption() {
    setForm((prev) => ({ ...prev, options: [...prev.options, ''] }));
  }

  function removeOption(index: number) {
    setForm((prev) => ({ ...prev, options: prev.options.filter((_, i) => i !== index) }));
  }

  function updateOption(index: number, value: string) {
    setForm((prev) => ({
      ...prev,
      options: prev.options.map((option, i) => (i === index ? value : option))
    }));
  }

  async function saveField() {
    if (!form.label.trim()) {
      setError('Field label is required.');
      return;
    }

    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const payload = {
        name: form.label.trim(),
        fieldType: UI_TO_API_TYPE[form.type],
        isRequired: form.required,
        sortOrder: form.sortOrder,
        teamId: form.teamIds[0] || undefined,
        categoryId: form.categoryId || undefined,
        options:
          form.type === 'dropdown'
            ? form.options
                .map((option) => option.trim())
                .filter(Boolean)
                .map((option) => ({ value: option, label: option }))
            : undefined
      };

      if (form.id) {
        const updated = await updateCustomField(form.id, {
          name: payload.name,
          fieldType: payload.fieldType,
          isRequired: payload.isRequired,
          sortOrder: payload.sortOrder,
          teamId: payload.teamId ?? null,
          categoryId: payload.categoryId ?? null,
          options: payload.options
        });
        setFields((prev) =>
          prev
            .map((field) => (field.id === updated.id ? updated : field))
            .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
        );
        setUiMetaById((prev) => ({
          ...prev,
          [updated.id]: {
            showList: form.showList,
            showDetail: form.showDetail,
            placeholder: form.placeholder,
            teamIds: [...form.teamIds]
          }
        }));
        setNotice('Custom field updated.');
      } else {
        const created = await createCustomField(payload);
        setFields((prev) =>
          [...prev, created].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
        );
        setUiMetaById((prev) => ({
          ...prev,
          [created.id]: {
            showList: form.showList,
            showDetail: form.showDetail,
            placeholder: form.placeholder,
            teamIds: [...form.teamIds]
          }
        }));
        setNotice('Custom field created.');
      }

      closeEditor();
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete(field: CustomFieldRecord) {
    setError(null);
    setNotice(null);
    try {
      await deleteCustomField(field.id);
      setFields((prev) => prev.filter((item) => item.id !== field.id));
      setUiMetaById((prev) => {
        const next = { ...prev };
        delete next[field.id];
        return next;
      });
      setDeleteTarget(null);
      setNotice('Custom field deleted.');
    } catch (err) {
      setError(apiErrorMessage(err));
    }
  }

  const rows = useMemo(() => {
    return fields.map((field) => {
      const meta = uiMetaById[field.id] ?? defaultMetaFromField(field);
      const scopedTeamIds = meta.teamIds.length > 0 ? meta.teamIds : field.teamId ? [field.teamId] : [];
      return {
        field,
        meta,
        scopedTeamIds
      };
    });
  }, [fields, uiMetaById]);

  return (
    <section className="min-h-full bg-gray-50 animate-fade-in">
      <div className="sticky top-0 z-40 border-b border-gray-200 bg-white">
        <div className="mx-auto max-w-[1600px] py-4 pl-6 pr-2">
          {headerProps ? (
            <TopBar
              title={headerProps.title}
              subtitle={headerProps.subtitle}
              currentEmail={headerProps.currentEmail}
              personas={headerProps.personas}
              onEmailChange={headerProps.onEmailChange}
              onOpenSearch={headerProps.onOpenSearch}
              notificationProps={headerProps.notificationProps}
              leftContent={
                <div className="min-w-0">
                  <h1 className="text-xl font-semibold text-gray-900">Custom Fields</h1>
                  <p className="mt-0.5 text-sm text-gray-500">Form fields and visibility.</p>
                </div>
              }
            />
          ) : (
            <div className="min-w-0">
              <h1 className="text-xl font-semibold text-gray-900">Custom Fields</h1>
              <p className="mt-0.5 text-sm text-gray-500">Form fields and visibility.</p>
            </div>
          )}
        </div>
      </div>

      <div className="mx-auto max-w-[1600px] p-6">
        <div className="mb-5 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-700">
          Core field data is live from backend. "In List", "In Detail", placeholder, and multi-team UI are tracked as demo metadata until backend support is added.
        </div>

        {error && (
          <div className="mb-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}
        {notice && (
          <div className="mb-5 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
            {notice}
          </div>
        )}

        <div className="mb-5 flex items-center justify-between">
          <p className="text-sm text-gray-600">
            Custom fields appear on ticket forms and detail views.
          </p>
          {canEdit && (
            <button
              type="button"
              onClick={openCreate}
              className="inline-flex items-center space-x-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700"
            >
              <Plus className="h-4 w-4" />
              <span>New Field</span>
            </button>
          )}
        </div>

        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-gray-200 bg-gray-50">
                <tr>
                  {['Field Label', 'Type', 'Required', 'In List', 'In Detail', 'Teams', 'Actions'].map(
                    (heading) => (
                      <th
                        key={heading}
                        className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500"
                      >
                        {heading}
                      </th>
                    )
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {loading ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-sm text-gray-500">
                      Loading custom fields...
                    </td>
                  </tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-10 text-center">
                      <p className="text-sm font-semibold text-gray-700">No custom fields</p>
                      <p className="mt-1 text-xs text-gray-400">
                        Create your first custom field to extend ticket forms.
                      </p>
                    </td>
                  </tr>
                ) : (
                  rows.map(({ field, meta, scopedTeamIds }) => {
                    const TypeIcon = fieldTypeIcon(field.fieldType);
                    return (
                      <tr key={field.id} className="transition-colors hover:bg-gray-50">
                        <td className="px-4 py-3">
                          <div className="flex items-center space-x-2">
                            <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-purple-100">
                              <TypeIcon className="h-3.5 w-3.5 text-purple-600" />
                            </div>
                            <div>
                              <p className="text-sm font-semibold text-gray-900">{field.name}</p>
                              {meta.placeholder && (
                                <p className="text-xs text-gray-400">{meta.placeholder}</p>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span className="rounded-md bg-gray-100 px-2 py-1 text-xs font-medium text-gray-700">
                            {fieldTypeLabel(field.fieldType)}
                          </span>
                          {(field.fieldType === 'DROPDOWN' || field.fieldType === 'MULTISELECT') && (
                            <p className="mt-0.5 text-xs text-gray-400">
                              {parseOptionLabels(field.options).length} options
                            </p>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {field.isRequired ? (
                            <span className="rounded-md bg-red-100 px-2 py-1 text-xs font-medium text-red-700">
                              Required
                            </span>
                          ) : (
                            <span className="text-xs text-gray-400">Optional</span>
                          )}
                        </td>
                        <td className="px-4 py-3">{meta.showList ? '✓' : <span className="text-gray-300">—</span>}</td>
                        <td className="px-4 py-3">{meta.showDetail ? '✓' : <span className="text-gray-300">—</span>}</td>
                        <td className="px-4 py-3">
                          {scopedTeamIds.length === 0 ? (
                            <span className="text-xs text-gray-400">All teams</span>
                          ) : (
                            <div className="flex flex-wrap gap-1">
                              {scopedTeamIds.slice(0, 2).map((teamId) => (
                                <span
                                  key={`${field.id}-${teamId}`}
                                  className="rounded-md bg-indigo-100 px-2 py-1 text-xs font-medium text-indigo-700"
                                >
                                  {teamLabel(teamId).split(' ')[0]}
                                </span>
                              ))}
                              {scopedTeamIds.length > 2 && (
                                <span className="rounded-md bg-gray-100 px-2 py-1 text-xs font-medium text-gray-600">
                                  +{scopedTeamIds.length - 2}
                                </span>
                              )}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {canEdit && (
                            <div className="flex items-center space-x-1">
                              <button
                                type="button"
                                onClick={() => openEdit(field)}
                                className="rounded p-1.5 text-gray-400 hover:bg-blue-50 hover:text-blue-600"
                              >
                                <Pencil className="h-4 w-4" />
                              </button>
                              <button
                                type="button"
                                onClick={() => setDeleteTarget(field)}
                                className="rounded p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {canEdit && (
            <div className="border-t border-gray-100 px-4 py-3">
              <button
                type="button"
                onClick={openCreate}
                className="inline-flex items-center space-x-1 text-sm font-medium text-blue-600 hover:text-blue-700"
              >
                <Plus className="h-4 w-4" />
                <span>Add Custom Field</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {showEditor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="flex max-h-[92vh] w-full max-w-lg flex-col rounded-xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
              <p className="text-base font-semibold text-gray-900">
                {form.id ? 'Edit Custom Field' : 'Create Custom Field'}
              </p>
              <button type="button" onClick={closeEditor} className="text-gray-400 hover:text-gray-600">
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="flex-1 space-y-4 overflow-y-auto p-6">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-700">Field Label *</label>
                <input
                  value={form.label}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, label: event.target.value }))
                  }
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-transparent focus:ring-2 focus:ring-blue-500"
                  placeholder="e.g. Account ID"
                />
              </div>

              <div>
                <label className="mb-2 block text-xs font-medium text-gray-700">Field Type</label>
                <div className="grid grid-cols-3 gap-2">
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
                            options: type.value === 'dropdown' ? prev.options : []
                          }))
                        }
                        className={`flex flex-col items-center rounded-lg border p-3 text-xs font-medium transition-all ${
                          selected
                            ? 'border-blue-500 bg-blue-50 text-blue-700'
                            : 'border-gray-200 text-gray-600 hover:border-gray-300'
                        }`}
                      >
                        <TypeIcon className="mb-1 h-5 w-5" />
                        {type.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-gray-700">Placeholder</label>
                <input
                  value={form.placeholder}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, placeholder: event.target.value }))
                  }
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-transparent focus:ring-2 focus:ring-blue-500"
                  placeholder="Hint text shown in empty field"
                />
              </div>

              {form.type === 'dropdown' && (
                <div>
                  <label className="mb-2 block text-xs font-medium text-gray-700">Options</label>
                  <div className="space-y-1.5">
                    {form.options.map((option, index) => (
                      <div key={`option-${index}`} className="flex items-center space-x-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-1.5">
                        <input
                          value={option}
                          onChange={(event) => updateOption(index, event.target.value)}
                          className="flex-1 bg-transparent text-sm text-gray-700 outline-none"
                          placeholder="Option value"
                        />
                        <button
                          type="button"
                          onClick={() => removeOption(index)}
                          className="text-gray-400 hover:text-red-500"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={addOption}
                    className="mt-2 text-xs font-medium text-blue-600 hover:text-blue-700"
                  >
                    Add option
                  </button>
                </div>
              )}

              <div className="space-y-2">
                <div className="flex items-center justify-between rounded-lg border border-gray-200 bg-gray-50 p-3">
                  <div>
                    <p className="text-sm font-medium text-gray-700">Required</p>
                    <p className="text-xs text-gray-500">Must be filled before submitting</p>
                  </div>
                  <input
                    type="checkbox"
                    checked={form.required}
                    onChange={(event) =>
                      setForm((prev) => ({ ...prev, required: event.target.checked }))
                    }
                    className="h-4 w-4 rounded text-blue-600"
                  />
                </div>

                <div className="flex items-center justify-between rounded-lg border border-gray-200 bg-gray-50 p-3">
                  <div>
                    <p className="text-sm font-medium text-gray-700">Show in Ticket List</p>
                    <p className="text-xs text-gray-500">Visible as a column in the tickets table</p>
                  </div>
                  <input
                    type="checkbox"
                    checked={form.showList}
                    onChange={(event) =>
                      setForm((prev) => ({ ...prev, showList: event.target.checked }))
                    }
                    className="h-4 w-4 rounded text-blue-600"
                  />
                </div>

                <div className="flex items-center justify-between rounded-lg border border-gray-200 bg-gray-50 p-3">
                  <div>
                    <p className="text-sm font-medium text-gray-700">Show in Ticket Detail</p>
                    <p className="text-xs text-gray-500">Visible in the ticket detail sidebar</p>
                  </div>
                  <input
                    type="checkbox"
                    checked={form.showDetail}
                    onChange={(event) =>
                      setForm((prev) => ({ ...prev, showDetail: event.target.checked }))
                    }
                    className="h-4 w-4 rounded text-blue-600"
                  />
                </div>
              </div>

              <div>
                <p className="mb-2 text-xs font-medium text-gray-700">
                  Available for Teams <span className="font-normal text-gray-400">(empty = all teams)</span>
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {teamsList.map((team) => (
                    <label
                      key={team.id}
                      className={`flex cursor-pointer items-center space-x-2 rounded-lg border p-2 text-xs ${
                        form.teamIds.includes(team.id)
                          ? 'border-blue-500 bg-blue-50'
                          : 'border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={form.teamIds.includes(team.id)}
                        onChange={() => toggleTeam(team.id)}
                        className="h-3.5 w-3.5 rounded text-blue-600"
                      />
                      <span className="font-medium text-gray-700">{team.name}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex justify-end space-x-3 rounded-b-xl border-t border-gray-200 bg-gray-50 px-6 py-4">
              <button
                type="button"
                onClick={closeEditor}
                disabled={saving}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void saveField()}
                disabled={saving}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
              >
                {saving ? 'Saving...' : form.id ? 'Save Field' : 'Create Field'}
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl">
            <div className="mb-3 flex items-center space-x-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-100">
                <Trash2 className="h-5 w-5 text-red-600" />
              </div>
              <h3 className="text-base font-semibold text-gray-900">Delete Custom Field</h3>
            </div>
            <p className="mb-5 text-sm leading-relaxed text-gray-600">
              Delete "{deleteTarget.name}"? This will remove it from all tickets.
            </p>
            <div className="flex justify-end space-x-3">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void confirmDelete(deleteTarget)}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
