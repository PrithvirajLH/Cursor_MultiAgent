import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { CategoryRef, CustomFieldRecord, TeamRef } from '../api/client';
import { CustomFieldInput } from './CustomFieldRenderer';
import { Button } from './ui/Button';
import { Drawer } from './ui/Drawer';
import {
    CREATE_TICKET_DESCRIPTION_MAX,
    CREATE_TICKET_SUBJECT_MAX,
    createTicketSchema,
    type CreateTicketFormData,
} from '../schemas/createTicket';

export type CreateTicketForm = CreateTicketFormData;

export function CreateTicketDrawer({
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
        formState: { errors, isSubmitting },
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

    // Reset form when drawer opens or closes
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

    const inputBase =
        'w-full rounded-lg border px-3 py-2 text-sm transition-colors focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20';
    const inputError = 'border-red-400 bg-red-50 focus:border-red-500 focus:ring-red-500/20';
    const inputNormal = 'border-slate-300 bg-white hover:border-slate-400';

    return (
        <Drawer
            open={open}
            onClose={onClose}
            title="Create New Ticket"
            description="Fill in the details below to raise a new ticket for the appropriate department."
            width="md"
        >
            <form className="space-y-6" onSubmit={handleSubmit((data) => onSubmit(data))}>
                {error && (
                    <div className="rounded-md bg-red-50 p-4 border border-red-200">
                        <p className="text-sm font-medium text-red-800">{error}</p>
                    </div>
                )}

                <div className="space-y-4">
                    <div>
                        <label htmlFor="create-ticket-team" className="mb-1.5 block text-sm font-medium text-slate-700">
                            Department <span className="text-red-500">*</span>
                        </label>
                        <select
                            id="create-ticket-team"
                            className={`${inputBase} ${errors.assignedTeamId ? inputError : inputNormal}`}
                            {...register('assignedTeamId')}
                        >
                            <option value="">Select a department</option>
                            {teams.map((team) => (
                                <option key={team.id} value={team.id}>
                                    {team.name}
                                </option>
                            ))}
                        </select>
                        {errors.assignedTeamId && (
                            <p className="mt-1 text-sm text-red-600">{errors.assignedTeamId.message}</p>
                        )}
                    </div>

                    {categories.length > 0 && (
                        <div>
                            <label htmlFor="create-ticket-category" className="mb-1.5 block text-sm font-medium text-slate-700">
                                Category <span className="text-slate-400 font-normal">(optional)</span>
                            </label>
                            <select id="create-ticket-category" className={`${inputBase} ${inputNormal}`} {...register('categoryId')}>
                                <option value="">Select a category</option>
                                {categories.map((cat) => (
                                    <option key={cat.id} value={cat.id}>
                                        {cat.name}
                                    </option>
                                ))}
                            </select>
                        </div>
                    )}

                    <div>
                        <div className="mb-1.5 flex items-center justify-between">
                            <label htmlFor="create-ticket-subject" className="block text-sm font-medium text-slate-700">
                                Subject <span className="text-red-500">*</span>
                            </label>
                            <span className={`text-xs ${(subjectValue?.length ?? 0) > CREATE_TICKET_SUBJECT_MAX ? 'text-red-500 font-medium' : 'text-slate-400'}`}>
                                {subjectValue?.length ?? 0}/{CREATE_TICKET_SUBJECT_MAX}
                            </span>
                        </div>
                        <input
                            id="create-ticket-subject"
                            placeholder="Brief summary of the issue"
                            className={`${inputBase} ${errors.subject ? inputError : inputNormal}`}
                            maxLength={CREATE_TICKET_SUBJECT_MAX}
                            {...register('subject')}
                        />
                        {errors.subject && (
                            <p className="mt-1 text-sm text-red-600">{errors.subject.message}</p>
                        )}
                    </div>

                    <div>
                        <div className="mb-1.5 flex items-center justify-between">
                            <label htmlFor="create-ticket-description" className="block text-sm font-medium text-slate-700">
                                Description <span className="text-red-500">*</span>
                            </label>
                            <span className={`text-xs ${(descriptionValue?.length ?? 0) > CREATE_TICKET_DESCRIPTION_MAX ? 'text-red-500 font-medium' : 'text-slate-400'}`}>
                                {descriptionValue?.length ?? 0}/{CREATE_TICKET_DESCRIPTION_MAX}
                            </span>
                        </div>
                        <textarea
                            id="create-ticket-description"
                            placeholder="Provide detailed information about the issue..."
                            className={`${inputBase} resize-y min-h-[120px] ${errors.description ? inputError : inputNormal}`}
                            maxLength={CREATE_TICKET_DESCRIPTION_MAX}
                            {...register('description')}
                        />
                        {errors.description && (
                            <p className="mt-1 text-sm text-red-600">{errors.description.message}</p>
                        )}
                    </div>

                    <div className="grid gap-4 sm:grid-cols-2">
                        <div>
                            <label htmlFor="create-ticket-priority" className="mb-1.5 block text-sm font-medium text-slate-700">
                                Priority
                            </label>
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
                                <p className="mt-1 text-sm text-red-600">{errors.priority.message}</p>
                            )}
                        </div>
                        <div>
                            <label htmlFor="create-ticket-channel" className="mb-1.5 block text-sm font-medium text-slate-700">
                                Channel
                            </label>
                            <select
                                id="create-ticket-channel"
                                className={`${inputBase} ${errors.channel ? inputError : inputNormal}`}
                                {...register('channel')}
                            >
                                <option value="PORTAL">Portal</option>
                                <option value="EMAIL">Email</option>
                            </select>
                            {errors.channel && (
                                <p className="mt-1 text-sm text-red-600">{errors.channel.message}</p>
                            )}
                        </div>
                    </div>
                </div>

                {customFields.length > 0 && (
                    <div className="space-y-4 border-t border-slate-200 pt-6">
                        <h3 className="text-sm font-semibold text-slate-900">Additional Information</h3>
                        <div className="space-y-4">
                            {customFields.map((field) => (
                                <div key={field.id} className="rounded-lg border border-slate-100 bg-slate-50/50 p-4">
                                    <CustomFieldInput
                                        field={field}
                                        value={customFieldValues[field.id] ?? ''}
                                        onChange={(value) => onCustomFieldChange?.(field.id, value)}
                                    />
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                <div className="sticky bottom-0 -mx-6 -mb-6 mt-8 flex items-center justify-end gap-3 border-t border-slate-200 bg-slate-50 px-6 py-4">
                    <Button type="button" variant="secondary" onClick={onClose} disabled={isSubmitting}>
                        Cancel
                    </Button>
                    <Button type="submit" variant="primary" disabled={isSubmitting}>
                        Create Ticket
                    </Button>
                </div>
            </form>
        </Drawer>
    );
}
