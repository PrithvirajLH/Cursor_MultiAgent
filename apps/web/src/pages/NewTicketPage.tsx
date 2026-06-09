import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useNavigate } from "react-router-dom";
import { TopBar } from "../components/TopBar";
import { useHeaderContext } from "../contexts/HeaderContext";
import { useToast } from "../hooks/useToast";
import type { Role } from "../types";
import type { TeamRef } from "../api/client";
import { useCreateTicketForm } from "../hooks/useCreateTicketForm";
import {
  CREATE_TICKET_DESCRIPTION_MAX,
  CREATE_TICKET_SUBJECT_MAX,
  createTicketSchema,
  type CreateTicketFormData,
} from "../schemas/createTicket";
import { CustomFieldInput } from "../components/CustomFieldRenderer";
import { Button } from "../components/ui/Button";

type NewTicketPageProps = {
  role: Role;
  teamsList: TeamRef[];
};

export function NewTicketPage({ teamsList }: NewTicketPageProps) {
  const headerCtx = useHeaderContext();
  const toast = useToast();
  const navigate = useNavigate();

  const createTicketForm = useCreateTicketForm({
    // Success toast is fired once by the hook via toastSuccess; don't duplicate it here.
    onSuccess: () => {},
    toastSuccess: toast.success,
    toastError: toast.error,
  });

  function handleClose() {
    navigate("/tickets");
  }

  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<CreateTicketFormData>({
    resolver: zodResolver(createTicketSchema),
    mode: "onBlur",
    defaultValues: {
      subject: "",
      description: "",
      priority: "SEV3",
      channel: "PORTAL",
      assignedTeamId: "",
      categoryId: "",
    },
  });

  useEffect(() => {
    reset();
  }, [reset]);

  const subjectValue = watch("subject");
  const descriptionValue = watch("description");
  const assignedTeamId = watch("assignedTeamId");
  const categoryId = watch("categoryId");

  useEffect(() => {
    createTicketForm.setSelectedTeamId(assignedTeamId);
  }, [assignedTeamId, createTicketForm]);

  useEffect(() => {
    createTicketForm.setSelectedCategoryId(categoryId ?? "");
  }, [categoryId, createTicketForm]);

  const currentUser = headerCtx?.currentUser ?? null;
  const initialFacility =
    currentUser?.graphProfile?.officeLocation?.trim() ?? "";
  const hasProfileFacility = initialFacility.length > 0;
  const [facility, setFacility] = useState(initialFacility);

  async function onSubmit(data: CreateTicketFormData) {
    const nextDescription =
      facility && facility.trim().length > 0
        ? `Facility: ${facility.trim()}\n\n${data.description}`
        : data.description;
    const ok = await createTicketForm.handleSubmit({
      ...data,
      description: nextDescription,
    });
    if (ok) {
      handleClose();
    }
  }

  const headerValue = headerCtx;

  const inputBase =
    "w-full rounded-lg border border-border bg-card px-3 py-2 text-sm transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring/20 hover:border-border";
  const inputError = "";
  const inputNormal = "";

  return (
    <section className="min-h-full bg-background">
      <div className="sticky top-0 z-40 border-b border-border bg-card/90 backdrop-blur-sm">
        <div className="mx-auto w-full max-w-[1600px] px-6 py-4">
          {headerValue ? (
            <TopBar
              title={headerValue.title}
              subtitle={headerValue.subtitle}
              currentEmail={headerValue.currentEmail}
              onOpenSearch={headerValue.onOpenSearch}
              notificationProps={headerValue.notificationProps}
            />
          ) : (
            <div>
              <h1 className="text-xl font-bold tracking-tight text-foreground">
                Create New Ticket
              </h1>
              <p className="text-sm font-medium text-muted-foreground">
                Fill in the details below to raise a new request.
              </p>
            </div>
          )}
        </div>
      </div>

      <div className="mx-auto w-full max-w-[900px] px-6 py-8">
        <div className="rounded-2xl border border-border bg-card shadow-sm">
          <div className="flex items-center justify-between border-b border-border px-6 py-4">
            <div>
              <h2 className="text-lg font-semibold text-foreground">
                Raise a new ticket
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Choose the department, add a clear subject, and describe the
                issue in detail.
              </p>
            </div>
          </div>
          <form
            className="space-y-6 px-6 py-6"
            onSubmit={handleSubmit(onSubmit)}
          >
            {createTicketForm.error && (
              <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                {createTicketForm.error}
              </div>
            )}

            <div className="space-y-4">
              <div>
                <label
                  htmlFor="new-ticket-team"
                  className="mb-1.5 block text-sm font-medium text-foreground"
                >
                  Department <span className="text-red-500">*</span>
                </label>
                <select
                  id="new-ticket-team"
                  className={`${inputBase} ${
                    errors.assignedTeamId ? inputError : inputNormal
                  }`}
                  {...register("assignedTeamId")}
                >
                  <option value="">Select a department</option>
                  {teamsList.map((team) => (
                    <option key={team.id} value={team.id}>
                      {team.name}
                    </option>
                  ))}
                </select>
                {errors.assignedTeamId && (
                  <p className="mt-1 text-sm text-red-600">
                    {errors.assignedTeamId.message}
                  </p>
                )}
              </div>

              {createTicketForm.categories.length > 0 && (
                <div>
                  <label
                    htmlFor="new-ticket-category"
                    className="mb-1.5 block text-sm font-medium text-foreground"
                  >
                    Category{" "}
                    <span className="text-muted-foreground font-normal">
                      (optional)
                    </span>
                  </label>
                  <select
                    id="new-ticket-category"
                    className={`${inputBase} ${inputNormal}`}
                    {...register("categoryId")}
                  >
                    <option value="">Select a category</option>
                    {createTicketForm.categories.map((cat) => (
                      <option key={cat.id} value={cat.id}>
                        {cat.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label
                  htmlFor="new-ticket-facility"
                  className="mb-1.5 block text-sm font-medium text-foreground"
                >
                  Facility / Office location
                </label>
                <input
                  id="new-ticket-facility"
                  className={`${inputBase} ${inputNormal} ${
                    hasProfileFacility ? "bg-accent cursor-not-allowed" : ""
                  }`}
                  placeholder="e.g. HQ – 3rd Floor – East Wing"
                  value={facility}
                  readOnly={hasProfileFacility}
                  onChange={
                    hasProfileFacility
                      ? undefined
                      : (event) => setFacility(event.target.value)
                  }
                />
              </div>

              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <label
                    htmlFor="new-ticket-subject"
                    className="block text-sm font-medium text-foreground"
                  >
                    Subject <span className="text-red-500">*</span>
                  </label>
                  <span
                    className={`text-xs ${
                      (subjectValue?.length ?? 0) > CREATE_TICKET_SUBJECT_MAX
                        ? "text-red-500 font-medium"
                        : "text-muted-foreground"
                    }`}
                  >
                    {subjectValue?.length ?? 0}/{CREATE_TICKET_SUBJECT_MAX}
                  </span>
                </div>
                <input
                  id="new-ticket-subject"
                  placeholder="e.g. Laptop will not start after latest Windows update"
                  className={`${inputBase} ${
                    errors.subject ? inputError : inputNormal
                  }`}
                  maxLength={CREATE_TICKET_SUBJECT_MAX}
                  {...register("subject")}
                />
                {errors.subject && (
                  <p className="mt-1 text-sm text-red-600">
                    {errors.subject.message}
                  </p>
                )}
              </div>

              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <label
                    htmlFor="new-ticket-description"
                    className="block text-sm font-medium text-foreground"
                  >
                    Description <span className="text-red-500">*</span>
                  </label>
                  <span
                    className={`text-xs ${
                      (descriptionValue?.length ?? 0) >
                      CREATE_TICKET_DESCRIPTION_MAX
                        ? "text-red-500 font-medium"
                        : "text-muted-foreground"
                    }`}
                  >
                    {descriptionValue?.length ?? 0}/
                    {CREATE_TICKET_DESCRIPTION_MAX}
                  </span>
                </div>
                <textarea
                  id="new-ticket-description"
                  placeholder="Describe what you were trying to do, what happened instead, any error messages, and how this is blocking you."
                  className={`${inputBase} min-h-[140px] resize-y ${
                    errors.description ? inputError : inputNormal
                  }`}
                  maxLength={CREATE_TICKET_DESCRIPTION_MAX}
                  {...register("description")}
                />
                {errors.description && (
                  <p className="mt-1 text-sm text-red-600">
                    {errors.description.message}
                  </p>
                )}
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="new-ticket-priority"
                    className="mb-1.5 block text-sm font-medium text-foreground"
                  >
                    Priority
                  </label>
                  <select
                    id="new-ticket-priority"
                    className={`${inputBase} ${
                      errors.priority ? inputError : inputNormal
                    }`}
                    {...register("priority")}
                  >
                    <option value="SEV1">SEV1 – Critical</option>
                    <option value="SEV2">SEV2 – High</option>
                    <option value="SEV3">SEV3 – Normal</option>
                    <option value="SEV4">SEV4 – Low</option>
                  </select>
                  {errors.priority && (
                    <p className="mt-1 text-sm text-red-600">
                      {errors.priority.message}
                    </p>
                  )}
                </div>
              </div>
            </div>

            {createTicketForm.customFields.length > 0 && (
              <div className="space-y-4 border-t border-border pt-6">
                <h3 className="text-sm font-semibold text-foreground">
                  Additional information
                </h3>
                <p className="text-xs text-muted-foreground">
                  These fields help your team route and solve the request
                  faster.
                </p>
                <div className="space-y-3">
                  {createTicketForm.customFields.map((field) => (
                    <div
                      key={field.id}
                      className="rounded-lg border border-border bg-muted/60 p-4"
                    >
                      <CustomFieldInput
                        field={field}
                        value={
                          createTicketForm.customFieldValues[field.id] ?? ""
                        }
                        onChange={(value) =>
                          createTicketForm.onCustomFieldChange(field.id, value)
                        }
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex items-center justify-between border-t border-border pt-4">
              <Button
                type="button"
                variant="secondary"
                onClick={handleClose}
                disabled={isSubmitting}
              >
                Cancel
              </Button>
              <div className="flex items-center gap-2">
                <span className="hidden text-xs text-muted-foreground sm:inline">
                  Press{" "}
                  <span className="rounded border border-border px-1">
                    Enter
                  </span>{" "}
                  to submit
                </span>
                <Button type="submit" variant="primary" disabled={isSubmitting}>
                  {isSubmitting ? "Creating…" : "Create Ticket"}
                </Button>
              </div>
            </div>
          </form>
        </div>
      </div>
    </section>
  );
}
