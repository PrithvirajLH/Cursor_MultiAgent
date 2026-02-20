import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlignLeft,
  Calendar,
  CheckSquare,
  ChevronDown,
  Hash,
  Pencil,
  Plus,
  Trash2,
  Type,
  Users
} from 'lucide-react';
import {
  fetchCategories,
  createCustomField,
  deleteCustomField,
  fetchCustomFields,
  fetchTeams,
  updateCustomField,
  type CategoryRef,
  type CustomFieldRecord,
  type TeamRef
} from '../api/client';
import { TopBar } from '../components/TopBar';
import { useHeaderContext } from '../contexts/HeaderContext';
import { useModalFocusTrap } from '../hooks/useModalFocusTrap';
import type { Role } from '../types';
import { handleApiError } from '../utils/handleApiError';

type UiFieldType = 'text' | 'textarea' | 'number' | 'dropdown' | 'multiselect' | 'checkbox' | 'date' | 'user';

type FieldFormState = {
  id: string | null;
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
  { value: 'text', label: 'Short Text', apiType: 'TEXT', icon: Type },
  { value: 'textarea', label: 'Long Text', apiType: 'TEXTAREA', icon: AlignLeft },
  { value: 'number', label: 'Number', apiType: 'NUMBER', icon: Hash },
  { value: 'dropdown', label: 'Dropdown', apiType: 'DROPDOWN', icon: ChevronDown },
  { value: 'multiselect', label: 'Multi Select', apiType: 'MULTISELECT', icon: CheckSquare },
  { value: 'checkbox', label: 'Checkbox', apiType: 'CHECKBOX', icon: CheckSquare },
  { value: 'date', label: 'Date', apiType: 'DATE', icon: Calendar },
  { value: 'user', label: 'User', apiType: 'USER', icon: Users }
];

const API_TO_UI_TYPE: Record<string, UiFieldType> = {
  TEXT: 'text',
  TEXTAREA: 'textarea',
  NUMBER: 'number',
  DROPDOWN: 'dropdown',
  MULTISELECT: 'multiselect',
  CHECKBOX: 'checkbox',
  DATE: 'date',
  USER: 'user'
};

const UI_TO_API_TYPE: Record<UiFieldType, string> = FIELD_TYPES.reduce((acc, type) => {
  acc[type.value] = type.apiType;
  return acc;
}, {} as Record<UiFieldType, string>);

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

function buildFormFromField(field: CustomFieldRecord): FieldFormState {
  return {
    id: field.id,
    label: field.name,
    type: API_TO_UI_TYPE[field.fieldType] ?? 'text',
    required: field.isRequired,
    teamId: field.teamId ?? '',
    options: parseOptionLabels(field.options),
    sortOrder: field.sortOrder,
    categoryId: field.categoryId ?? ''
  };
}

function createEmptyForm(teamId = ''): FieldFormState {
  return {
    id: null,
    label: '',
    type: 'text',
    required: false,
    teamId,
    options: [],
    sortOrder: 0,
    categoryId: ''
  };
}

export function CustomFieldsAdminPage({
  role
}: {
  role?: Role;
}) {
  const headerCtx = useHeaderContext();
  const canEdit = role ? role === 'TEAM_ADMIN' || role === 'OWNER' : true;
  const isTeamAdmin = role === 'TEAM_ADMIN';
  const [fields, setFields] = useState<CustomFieldRecord[]>([]);
  const [teamsList, setTeamsList] = useState<TeamRef[]>([]);
  const [categories, setCategories] = useState<CategoryRef[]>([]);

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [showEditor, setShowEditor] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<CustomFieldRecord | null>(null);
  const [form, setForm] = useState<FieldFormState>(createEmptyForm());
  const editorDialogRef = useRef<HTMLDivElement>(null);
  const deleteDialogRef = useRef<HTMLDivElement>(null);

  const resolvedTeamAdminTeamId = useMemo(() => {
    if (!isTeamAdmin) return '';
    return teamsList.length === 1 ? teamsList[0].id : '';
  }, [isTeamAdmin, teamsList]);

  useEffect(() => {
    void loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    setError(null);
    try {
      const [teamsResponse, fieldsResponse, categoriesResponse] = await Promise.all([
        fetchTeams(),
        fetchCustomFields(),
        fetchCategories({ includeInactive: false })
      ]);

      const sortedFields = [...fieldsResponse.data].sort(
        (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)
      );
      setTeamsList(teamsResponse.data);
      setFields(sortedFields);
      setCategories(categoriesResponse.data);
    } catch (err) {
      setError(handleApiError(err));
    } finally {
      setLoading(false);
    }
  }

  function teamLabel(teamId: string): string {
    return teamsList.find((team) => team.id === teamId)?.name ?? teamId;
  }

  function categoryLabel(categoryId: string | null): string {
    if (!categoryId) return 'All categories';
    return categories.find((category) => category.id === categoryId)?.name ?? categoryId;
  }

  function canManageField(field: CustomFieldRecord): boolean {
    if (!canEdit) return false;
    if (!role || role === 'OWNER') return true;
    if (role === 'TEAM_ADMIN') {
      return !!resolvedTeamAdminTeamId && field.teamId === resolvedTeamAdminTeamId;
    }
    return false;
  }

  function openCreate() {
    setError(null);
    setNotice(null);
    setForm(createEmptyForm(resolvedTeamAdminTeamId));
    setShowEditor(true);
  }

  function openEdit(field: CustomFieldRecord) {
    setError(null);
    setNotice(null);
    setForm(buildFormFromField(field));
    setShowEditor(true);
  }

  function closeEditor() {
    setShowEditor(false);
    setForm(createEmptyForm(resolvedTeamAdminTeamId));
  }

  useModalFocusTrap({
    open: showEditor,
    containerRef: editorDialogRef,
    onClose: closeEditor,
  });

  useModalFocusTrap({
    open: Boolean(deleteTarget),
    containerRef: deleteDialogRef,
    onClose: () => setDeleteTarget(null),
  });

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
    if (isTeamAdmin && !resolvedTeamAdminTeamId) {
      setError('Team admin requires a primary team to manage custom fields.');
      return;
    }

    const trimmedOptions = form.options.map((option) => option.trim()).filter(Boolean);
    if ((form.type === 'dropdown' || form.type === 'multiselect') && trimmedOptions.length === 0) {
      setError('Dropdown and multi-select fields require at least one option.');
      return;
    }

    const scopedTeamId = isTeamAdmin ? resolvedTeamAdminTeamId : form.teamId || undefined;
    const optionsPayload =
      form.type === 'dropdown' || form.type === 'multiselect'
        ? trimmedOptions.map((option) => ({ value: option, label: option }))
        : undefined;

    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const payload = {
        name: form.label.trim(),
        fieldType: UI_TO_API_TYPE[form.type],
        isRequired: form.required,
        sortOrder: Math.max(0, Number(form.sortOrder) || 0),
        teamId: scopedTeamId,
        categoryId: form.categoryId || undefined,
        options: optionsPayload
      };

      if (form.id) {
        const updated = await updateCustomField(form.id, {
          name: payload.name,
          fieldType: payload.fieldType,
          isRequired: payload.isRequired,
          sortOrder: payload.sortOrder,
          teamId: payload.teamId ?? null,
          categoryId: payload.categoryId ?? null,
          // Clear stale options when switching away from dropdown.
          options: payload.options ?? null
        });
        setFields((prev) =>
          prev
            .map((field) => (field.id === updated.id ? updated : field))
            .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
        );
        setNotice('Custom field updated.');
      } else {
        const created = await createCustomField(payload);
        setFields((prev) =>
          [...prev, created].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
        );
        setNotice('Custom field created.');
      }

      closeEditor();
    } catch (err) {
      setError(handleApiError(err));
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
      setDeleteTarget(null);
      setNotice('Custom field deleted.');
    } catch (err) {
      setError(handleApiError(err));
    }
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
                  <h1 className="text-xl font-semibold text-slate-900">Custom Fields</h1>
                  <p className="mt-0.5 text-sm text-slate-500">Form fields and visibility.</p>
                </div>
              }
            />
          ) : (
            <div className="min-w-0">
              <h1 className="text-xl font-semibold text-slate-900">Custom Fields</h1>
              <p className="mt-0.5 text-sm text-slate-500">Form fields and visibility.</p>
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
        {notice && (
          <div className="mb-5 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
            {notice}
          </div>
        )}

        <div className="mb-5 flex items-center justify-between">
          <p className="text-sm text-slate-600">
            Custom fields appear on ticket forms and detail views.
          </p>
          {canEdit && (
            <button
              type="button"
              onClick={openCreate}
              disabled={isTeamAdmin && !resolvedTeamAdminTeamId}
              className="inline-flex items-center space-x-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
            >
              <Plus className="h-4 w-4" />
              <span>New Field</span>
            </button>
          )}
        </div>

        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-200 bg-slate-50">
                <tr>
                  {['Field Label', 'Type', 'Required', 'Category', 'Team Scope', 'Sort', 'Actions'].map(
                    (heading) => (
                      <th
                        key={heading}
                        className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500"
                      >
                        {heading}
                      </th>
                    )
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  Array.from({ length: 6 }).map((_, i) => (
                    <tr key={`skel-${i}`} className="border-b border-slate-100 last:border-0">
                      <td className="px-4 py-3"><div className="h-4 w-32 skeleton-shimmer rounded" /></td>
                      <td className="px-4 py-3"><div className="h-4 w-20 skeleton-shimmer rounded" /></td>
                      <td className="px-4 py-3"><div className="h-4 w-24 skeleton-shimmer rounded" /></td>
                      <td className="px-4 py-3"><div className="h-5 w-14 skeleton-shimmer rounded-full" /></td>
                      <td className="px-4 py-3"><div className="h-4 w-20 skeleton-shimmer rounded" /></td>
                      <td className="px-4 py-3"><div className="h-4 w-16 skeleton-shimmer rounded" /></td>
                      <td className="px-4 py-3"><div className="h-4 w-12 skeleton-shimmer rounded" /></td>
                    </tr>
                  ))
                ) : fields.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-10 text-center">
                      <p className="text-sm font-semibold text-slate-700">No custom fields</p>
                      <p className="mt-1 text-xs text-slate-400">
                        Create your first custom field to extend ticket forms.
                      </p>
                    </td>
                  </tr>
                ) : (
                  fields.map((field) => {
                    const TypeIcon = fieldTypeIcon(field.fieldType);
                    return (
                      <tr key={field.id} className="transition-colors hover:bg-slate-50">
                        <td className="px-4 py-3">
                          <div className="flex items-center space-x-2">
                            <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-purple-100">
                              <TypeIcon className="h-3.5 w-3.5 text-purple-600" />
                            </div>
                            <div>
                              <p className="text-sm font-semibold text-slate-900">{field.name}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">
                            {fieldTypeLabel(field.fieldType)}
                          </span>
                          {(field.fieldType === 'DROPDOWN' || field.fieldType === 'MULTISELECT') && (
                            <p className="mt-0.5 text-xs text-slate-400">
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
                            <span className="text-xs text-slate-400">Optional</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-xs text-slate-600">{categoryLabel(field.categoryId)}</span>
                        </td>
                        <td className="px-4 py-3">
                          {field.teamId ? (
                            <span className="rounded-md bg-indigo-100 px-2 py-1 text-xs font-medium text-indigo-700">
                              {teamLabel(field.teamId)}
                            </span>
                          ) : (
                            <span className="text-xs text-slate-400">All teams</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-600">{field.sortOrder}</td>
                        <td className="px-4 py-3">
                          {canManageField(field) && (
                            <div className="flex items-center space-x-1">
                              <button
                                type="button"
                                onClick={() => openEdit(field)}
                                className="rounded p-1.5 text-slate-400 hover:bg-blue-50 hover:text-blue-600"
                              >
                                <Pencil className="h-4 w-4" />
                              </button>
                              <button
                                type="button"
                                onClick={() => setDeleteTarget(field)}
                                className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </div>
                          )}
                          {!canManageField(field) && canEdit && (
                            <span className="text-xs text-slate-400">Read-only</span>
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
            <div className="border-t border-slate-100 px-4 py-3">
              <button
                type="button"
                onClick={openCreate}
                disabled={isTeamAdmin && !resolvedTeamAdminTeamId}
                className="inline-flex items-center space-x-1 text-sm font-medium text-blue-600 hover:text-blue-700 disabled:cursor-not-allowed disabled:text-blue-300"
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
          <div
            ref={editorDialogRef}
            role="dialog"
            aria-modal="true"
            aria-label={form.id ? 'Edit custom field' : 'Create custom field'}
            tabIndex={-1}
            className="flex max-h-[92vh] w-full max-w-lg flex-col rounded-xl bg-white shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
              <p className="text-base font-semibold text-slate-900">
                {form.id ? 'Edit Custom Field' : 'Create Custom Field'}
              </p>
              <button type="button" onClick={closeEditor} className="text-slate-400 hover:text-slate-600">
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="flex-1 space-y-4 overflow-y-auto p-6">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-700">Field Label *</label>
                <input
                  value={form.label}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, label: event.target.value }))
                  }
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-transparent focus:ring-2 focus:ring-blue-500"
                  placeholder="e.g. Account ID"
                />
              </div>

              <div>
                <label className="mb-2 block text-xs font-medium text-slate-700">Field Type</label>
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
                            options: type.value === 'dropdown' || type.value === 'multiselect' ? prev.options : []
                          }))
                        }
                        className={`flex flex-col items-center rounded-lg border p-3 text-xs font-medium transition-all ${
                          selected
                            ? 'border-blue-500 bg-blue-50 text-blue-700'
                            : 'border-slate-200 text-slate-600 hover:border-slate-300'
                        }`}
                      >
                        <TypeIcon className="mb-1 h-5 w-5" />
                        {type.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {(form.type === 'dropdown' || form.type === 'multiselect') && (
                <div>
                  <label className="mb-2 block text-xs font-medium text-slate-700">Options</label>
                  <div className="space-y-1.5">
                    {form.options.map((option, index) => (
                      <div key={`option-${index}`} className="flex items-center space-x-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5">
                        <input
                          value={option}
                          onChange={(event) => updateOption(index, event.target.value)}
                          className="flex-1 bg-transparent text-sm text-slate-700 outline-none"
                          placeholder="Option value"
                        />
                        <button
                          type="button"
                          onClick={() => removeOption(index)}
                          className="text-slate-400 hover:text-red-500"
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

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-700">Category Scope</label>
                  <select
                    value={form.categoryId}
                    onChange={(event) =>
                      setForm((prev) => ({ ...prev, categoryId: event.target.value }))
                    }
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-transparent focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">All categories</option>
                    {categories.map((category) => (
                      <option key={category.id} value={category.id}>
                        {category.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-700">Sort Order</label>
                  <input
                    type="number"
                    min={0}
                    value={form.sortOrder}
                    onChange={(event) =>
                      setForm((prev) => ({ ...prev, sortOrder: Number(event.target.value) || 0 }))
                    }
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-transparent focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-slate-700">Team Scope</label>
                {isTeamAdmin ? (
                  <input
                    value={resolvedTeamAdminTeamId ? teamLabel(resolvedTeamAdminTeamId) : 'Primary team unavailable'}
                    disabled
                    className="w-full rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 text-sm text-slate-600"
                  />
                ) : (
                  <select
                    value={form.teamId}
                    onChange={(event) =>
                      setForm((prev) => ({ ...prev, teamId: event.target.value }))
                    }
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-transparent focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">All teams (global)</option>
                    {teamsList.map((team) => (
                      <option key={team.id} value={team.id}>
                        {team.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 p-3">
                <div>
                  <p className="text-sm font-medium text-slate-700">Required</p>
                  <p className="text-xs text-slate-500">Must be filled before submitting</p>
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
            </div>

            <div className="flex justify-end space-x-3 rounded-b-xl border-t border-slate-200 bg-slate-50 px-6 py-4">
              <button
                type="button"
                onClick={closeEditor}
                disabled={saving}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
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
          <div
            ref={deleteDialogRef}
            role="dialog"
            aria-modal="true"
            aria-label="Delete custom field"
            tabIndex={-1}
            className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl"
          >
            <div className="mb-3 flex items-center space-x-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-100">
                <Trash2 className="h-5 w-5 text-red-600" />
              </div>
              <h3 className="text-base font-semibold text-slate-900">Delete Custom Field</h3>
            </div>
            <p className="mb-5 text-sm leading-relaxed text-slate-600">
              Delete "{deleteTarget.name}"? This will remove it from all tickets.
            </p>
            <div className="flex justify-end space-x-3">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
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
