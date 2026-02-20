import { useEffect, useMemo, useState } from 'react';
import {
  createTicket,
  fetchCategories,
  fetchCustomFields,
  type CategoryRef,
  type CustomFieldRecord,
} from '../api/client';
import type { CreateTicketFormData } from '../schemas/createTicket';
import { handleApiError } from '../utils/handleApiError';

export function useCreateTicketForm(opts: {
  onSuccess: () => void;
  toastSuccess: (msg: string) => void;
  toastError: (msg: string) => void;
}) {
  const [showModal, setShowModal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [categories, setCategories] = useState<CategoryRef[]>([]);
  const [customFieldsRaw, setCustomFieldsRaw] = useState<CustomFieldRecord[]>([]);
  const [customFieldValues, setCustomFieldValues] = useState<Record<string, string>>({});

  // Track the currently-selected team so we can filter custom fields and refetch
  const [selectedTeamId, setSelectedTeamId] = useState('');
  const [selectedCategoryId, setSelectedCategoryId] = useState('');

  const customFields = useMemo(() => {
    if (!selectedCategoryId) return customFieldsRaw;
    return customFieldsRaw.filter(
      (f) => !f.categoryId || f.categoryId === selectedCategoryId,
    );
  }, [customFieldsRaw, selectedCategoryId]);

  useEffect(() => {
    fetchCategories({ includeInactive: false })
      .then((res) => setCategories(res.data))
      .catch(() => setCategories([]));
  }, []);

  useEffect(() => {
    if (!selectedTeamId) {
      setCustomFieldsRaw([]);
      setCustomFieldValues({});
      return;
    }
    fetchCustomFields({ teamId: selectedTeamId })
      .then((res) => setCustomFieldsRaw(res.data))
      .catch(() => setCustomFieldsRaw([]));
    setCustomFieldValues({});
  }, [selectedTeamId]);

  function openModal() {
    setShowModal(true);
  }

  function closeModal() {
    setShowModal(false);
    setSelectedTeamId('');
    setSelectedCategoryId('');
    setCustomFieldValues({});
    setError(null);
  }

  function onCustomFieldChange(fieldId: string, value: string) {
    setCustomFieldValues((prev) => ({ ...prev, [fieldId]: value }));
  }

  async function handleSubmit(data: CreateTicketFormData) {
    setError(null);

    // Keep track of selections for custom field filtering
    setSelectedTeamId(data.assignedTeamId);
    setSelectedCategoryId(data.categoryId ?? '');

    const missingRequired = customFields.filter(
      (f) => f.isRequired && !(customFieldValues[f.id]?.trim?.() ?? ''),
    );
    if (missingRequired.length > 0) {
      const names = missingRequired.map((f) => f.name).join(', ');
      const msg = `Required field(s) must be filled: ${names}`;
      setError(msg);
      opts.toastError(msg);
      return;
    }

    try {
      const customFieldValuesPayload =
        customFields.length > 0
          ? customFields.map((f) => ({
              customFieldId: f.id,
              value: (customFieldValues[f.id]?.trim?.() ?? '') || null,
            }))
          : [];

      await createTicket({
        subject: data.subject,
        description: data.description,
        priority: data.priority,
        channel: data.channel,
        ...(data.assignedTeamId && { assignedTeamId: data.assignedTeamId }),
        ...(data.categoryId && { categoryId: data.categoryId }),
        ...(customFieldValuesPayload.length > 0 && {
          customFieldValues: customFieldValuesPayload,
        }),
      });

      setCustomFieldValues({});
      setSelectedTeamId('');
      setSelectedCategoryId('');
      setShowModal(false);
      opts.onSuccess();
      opts.toastSuccess('Ticket created successfully.');
    } catch (err: unknown) {
      const display = handleApiError(err);
      setError(display);
      opts.toastError(display);
    }
  }

  return {
    showModal,
    openModal,
    closeModal,
    error,
    categories,
    customFields,
    customFieldValues,
    onCustomFieldChange,
    handleSubmit,
    /** Expose setter so the modal's `watch` can keep custom-field refetch in sync */
    setSelectedTeamId,
    setSelectedCategoryId,
  } as const;
}
