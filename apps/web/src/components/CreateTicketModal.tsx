import { useCallback, useEffect, useRef } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { X } from 'lucide-react';
import type { CategoryRef, CustomFieldRecord, TeamRef } from '../api/client';
import { CustomFieldInput } from './CustomFieldRenderer';
import { Button } from './ui/Button';
import { createTicketSchema, type CreateTicketFormData } from '../schemas/createTicket';

export type CreateTicketForm = CreateTicketFormData;

export function CreateTicketModal({
  open,
  onClose,
  onSubmit,
  error,
  teams,
  categories = [],
  customFields = [],
  customFieldValues = {},
  onCustomFieldChange,
  onTeamChange,
  onCategoryChange,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (data: CreateTicketFormData) => void | Promise<void>;
  error: string | null;
  teams: TeamRef[];
  categories?: CategoryRef[];
  customFields?: CustomFieldRecord[];
  customFieldValues?: Record<string, string>;
  onCustomFieldChange?: (fieldId: string, value: string) => void;
  onTeamChange?: (teamId: string) => void;
  onCategoryChange?: (categoryId: string) => void;
}) {
  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors },
  } = useForm<CreateTicketFormData>({
    resolver: zodResolver(createTicketSchema),
    mode: 'onBlur',
    defaultValues: {
      subject: '',
      description: '',
      priority: 'P3',
      channel: 'PORTAL',
      assignedTeamId: '',
      categoryId: '',
    },
  });

  // Reset form when modal opens or closes
  useEffect(() => {
    reset();
  }, [open, reset]);

  const subjectValue = watch('subject');
  const descriptionValue = watch('description');
  const assignedTeamId = watch('assignedTeamId');
  const categoryId = watch('categoryId');

  // Notify parent when team selection changes (drives custom-field fetching)
  useEffect(() => {
    onTeamChange?.(assignedTeamId);
  }, [assignedTeamId, onTeamChange]);

  // Notify parent when category selection changes (drives custom-field filtering)
  useEffect(() => {
    onCategoryChange?.(categoryId ?? '');
  }, [categoryId, onCategoryChange]);

  // Focus trap (7.5 fix): keep Tab focus inside the modal
  const dialogRef = useRef<HTMLDivElement>(null);

  const handleFocusTrap = useCallback((e: KeyboardEvent) => {
    if (e.key !== 'Tab' || !dialogRef.current) return;
    const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey) {
      if (document.activeElement === first) { e.preventDefault(); last.focus(); }
    } else {
      if (document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    document.addEventListener('keydown', handleFocusTrap);
    // Auto-focus the dialog on open
    const timer = window.setTimeout(() => dialogRef.current?.focus(), 50);
    return () => {
      document.removeEventListener('keydown', handleFocusTrap);
      window.clearTimeout(timer);
    };
  }, [open, handleFocusTrap]);

  if (!open) {
    return null;
  }

  const inputBase =
    'w-full rounded-lg border px-3 py-2 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500';
  const inputError = 'border-red-400';
  const inputNormal = 'border-slate-300 bg-white';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Raise a new ticket"
        tabIndex={-1}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            onClose();
          }
        }}
        className="w-full max-w-xl rounded-xl bg-white shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <div>
            <h3 className="text-base font-semibold text-slate-900">Raise a new ticket</h3>
            <p className="mt-0.5 text-xs text-slate-500">Select the department and describe the issue.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <form className="space-y-4 p-6" onSubmit={handleSubmit((data) => onSubmit(data))}>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div>
            <label htmlFor="create-ticket-team" className="mb-1 block text-xs font-medium text-slate-700">Department *</label>
            <select
              id="create-ticket-team"
              className={`${inputBase} ${errors.assignedTeamId ? inputError : inputNormal}`}
              {...register('assignedTeamId')}
            >
              <option value="">Select department</option>
              {teams.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name}
                </option>
              ))}
            </select>
            {errors.assignedTeamId && (
              <p className="mt-1 text-xs text-red-600">{errors.assignedTeamId.message}</p>
            )}
          </div>
          {categories.length > 0 && (
            <div>
              <label htmlFor="create-ticket-category" className="mb-1 block text-xs font-medium text-slate-700">Category (optional)</label>
              <select id="create-ticket-category" className={`${inputBase} ${inputNormal}`} {...register('categoryId')}>
                <option value="">Any category</option>
                {categories.map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {cat.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div>
            <div className="mb-1 flex items-center justify-between">
              <label htmlFor="create-ticket-subject" className="block text-xs font-medium text-slate-700">Subject *</label>
              <span className={`text-xs ${(subjectValue?.length ?? 0) > 200 ? 'text-red-500' : 'text-slate-400'}`}>
                {subjectValue?.length ?? 0}/200
              </span>
            </div>
            <input
              id="create-ticket-subject"
              className={`${inputBase} ${errors.subject ? inputError : inputNormal}`}
              {...register('subject')}
            />
            {errors.subject && (
              <p className="mt-1 text-xs text-red-600">{errors.subject.message}</p>
            )}
          </div>
          <div>
            <div className="mb-1 flex items-center justify-between">
              <label htmlFor="create-ticket-description" className="block text-xs font-medium text-slate-700">Description *</label>
              <span className={`text-xs ${(descriptionValue?.length ?? 0) > 5000 ? 'text-red-500' : 'text-slate-400'}`}>
                {descriptionValue?.length ?? 0}/5000
              </span>
            </div>
            <textarea
              id="create-ticket-description"
              className={`${inputBase} ${errors.description ? inputError : inputNormal}`}
              rows={4}
              {...register('description')}
            />
            {errors.description && (
              <p className="mt-1 text-xs text-red-600">{errors.description.message}</p>
            )}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="create-ticket-priority" className="mb-1 block text-xs font-medium text-slate-700">Priority</label>
              <select
                id="create-ticket-priority"
                className={`${inputBase} ${errors.priority ? inputError : inputNormal}`}
                {...register('priority')}
              >
                <option value="P1">P1</option>
                <option value="P2">P2</option>
                <option value="P3">P3</option>
                <option value="P4">P4</option>
              </select>
              {errors.priority && (
                <p className="mt-1 text-xs text-red-600">{errors.priority.message}</p>
              )}
            </div>
            <div>
              <label htmlFor="create-ticket-channel" className="mb-1 block text-xs font-medium text-slate-700">Channel</label>
              <select
                id="create-ticket-channel"
                className={`${inputBase} ${errors.channel ? inputError : inputNormal}`}
                {...register('channel')}
              >
                <option value="PORTAL">Portal</option>
                <option value="EMAIL">Email</option>
              </select>
              {errors.channel && (
                <p className="mt-1 text-xs text-red-600">{errors.channel.message}</p>
              )}
            </div>
          </div>
          {customFields.length > 0 && (
            <div className="space-y-3 border-t border-slate-200 pt-4">
              <p className="text-xs font-medium text-slate-700">Custom fields</p>
              {customFields.map((field) => (
                <CustomFieldInput
                  key={field.id}
                  field={field}
                  value={customFieldValues[field.id] ?? ''}
                  onChange={(value) => onCustomFieldChange?.(field.id, value)}
                />
              ))}
            </div>
          )}
          <Button type="submit" variant="primary" size="md" className="w-full">
            Submit ticket
          </Button>
        </form>
      </div>
    </div>
  );
}
