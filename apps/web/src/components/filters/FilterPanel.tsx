import { X } from "lucide-react";
import { MultiSelectFilter, type MultiSelectOption } from "./MultiSelectFilter";
import { DateRangeFilter } from "./DateRangeFilter";
import { SavedViewsDropdown } from "./SavedViewsDropdown";
import { TextFilterDropdown } from "./TextFilterDropdown";
import type { TicketFilters } from "../../types";
import type { TeamRef } from "../../api/client";
import type { UserRef } from "../../api/client";

const STATUS_OPTIONS: MultiSelectOption[] = [
  { value: "NEW", label: "New" },
  { value: "TRIAGED", label: "Triaged" },
  { value: "ASSIGNED", label: "Assigned" },
  { value: "IN_PROGRESS", label: "In Progress" },
  { value: "WAITING_ON_REQUESTER", label: "Waiting on Requester" },
  { value: "WAITING_ON_VENDOR", label: "Waiting on Vendor" },
  { value: "RESOLVED", label: "Resolved" },
  { value: "CLOSED", label: "Closed" },
  { value: "REOPENED", label: "Reopened" },
];

const PRIORITY_OPTIONS: MultiSelectOption[] = [
  { value: "P1", label: "P1" },
  { value: "P2", label: "P2" },
  { value: "P3", label: "P3" },
  { value: "P4", label: "P4" },
];

const SLA_STATUS_OPTIONS: MultiSelectOption[] = [
  { value: "on_track", label: "On track" },
  { value: "at_risk", label: "At risk" },
  { value: "breached", label: "Breached" },
];

export function FilterPanel({
  filters,
  setFilters,
  clearFilters,
  hasActiveFilters,
  showTeamFilter = true,
  teamsList,
  assignableUsers,
  requesterOptions,
  onSaveSuccess,
  onError,
  onClose,
  drawerMode = false,
}: {
  filters: TicketFilters;
  setFilters: (updates: Partial<TicketFilters>) => void;
  clearFilters: () => void;
  hasActiveFilters: boolean;
  showTeamFilter?: boolean;
  teamsList: TeamRef[];
  assignableUsers: UserRef[];
  requesterOptions: UserRef[];
  onSaveSuccess?: () => void;
  onError?: (message: string) => void;
  onClose?: () => void;
  drawerMode?: boolean;
}) {
  const teamOptions: MultiSelectOption[] = teamsList.map((t) => ({
    value: t.id,
    label: t.name,
  }));
  const assigneeOptions: MultiSelectOption[] = assignableUsers.map((u) => ({
    value: u.id,
    label: u.displayName,
  }));
  const requesterSelectOptions: MultiSelectOption[] = requesterOptions.map(
    (u) => ({
      value: u.id,
      label: u.displayName,
    }),
  );

  function toggleValue(list: string[], value: string) {
    return list.includes(value)
      ? list.filter((item) => item !== value)
      : [...list, value];
  }

  if (drawerMode) {
    return (
      <div className="space-y-6">
        <div>
          <label className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Status
          </label>
          <div className="mt-2 space-y-2">
            {STATUS_OPTIONS.map((option) => (
              <label
                key={option.value}
                className="flex items-center gap-2 text-[13px] text-foreground"
              >
                <input
                  type="checkbox"
                  checked={filters.statuses.includes(option.value)}
                  onChange={() =>
                    setFilters({
                      statuses: toggleValue(filters.statuses, option.value),
                    })
                  }
                  className="custom-checkbox mt-0.5"
                />
                <span>{option.label}</span>
              </label>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Priority
          </label>
          <div className="mt-2 space-y-2">
            {PRIORITY_OPTIONS.map((option) => (
              <label
                key={option.value}
                className="flex items-center gap-2 text-[13px] text-foreground"
              >
                <input
                  type="checkbox"
                  checked={filters.priorities.includes(option.value)}
                  onChange={() =>
                    setFilters({
                      priorities: toggleValue(filters.priorities, option.value),
                    })
                  }
                  className="custom-checkbox mt-0.5"
                />
                <span>{option.label}</span>
              </label>
            ))}
          </div>
        </div>

        {showTeamFilter ? (
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Team
            </label>
            <select
              value={filters.teamIds[0] ?? ""}
              onChange={(event) =>
                setFilters({
                  teamIds: event.target.value ? [event.target.value] : [],
                })
              }
              className="custom-select mt-2 w-full"
            >
              <option value="">All Teams</option>
              {teamOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        <div>
          <label className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Assignee
          </label>
          <select
            value={filters.assigneeIds[0] ?? ""}
            onChange={(event) =>
              setFilters({
                assigneeIds: event.target.value ? [event.target.value] : [],
              })
            }
            className="custom-select mt-2 w-full"
          >
            <option value="">All Assignees</option>
            {assigneeOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Requester
          </label>
          <select
            value={filters.requesterIds[0] ?? ""}
            onChange={(event) =>
              setFilters({
                requesterIds: event.target.value ? [event.target.value] : [],
              })
            }
            className="custom-select mt-2 w-full"
          >
            <option value="">All Requesters</option>
            {requesterSelectOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            SLA Status
          </label>
          <div className="mt-2 space-y-2">
            {SLA_STATUS_OPTIONS.map((option) => (
              <label
                key={option.value}
                className="flex items-center gap-2 text-[13px] text-foreground"
              >
                <input
                  type="checkbox"
                  checked={filters.slaStatus.includes(
                    option.value as (typeof filters.slaStatus)[number],
                  )}
                  onChange={() =>
                    setFilters({
                      slaStatus: toggleValue(
                        filters.slaStatus,
                        option.value,
                      ) as typeof filters.slaStatus,
                    })
                  }
                  className="custom-checkbox mt-0.5"
                />
                <span>{option.label}</span>
              </label>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Created Date
          </label>
          <div className="mt-2 space-y-2">
            <input
              type="date"
              value={filters.createdFrom}
              onChange={(event) =>
                setFilters({ createdFrom: event.target.value })
              }
              className="h-10 w-full rounded-md border border-border px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-blue-500/30"
            />
            <input
              type="date"
              value={filters.createdTo}
              onChange={(event) =>
                setFilters({ createdTo: event.target.value })
              }
              className="h-10 w-full rounded-md border border-border px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-blue-500/30"
            />
          </div>
        </div>

        <div>
          <label className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Updated Date
          </label>
          <div className="mt-2 space-y-2">
            <input
              type="date"
              value={filters.updatedFrom}
              onChange={(event) =>
                setFilters({ updatedFrom: event.target.value })
              }
              className="h-10 w-full rounded-md border border-border px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-blue-500/30"
            />
            <input
              type="date"
              value={filters.updatedTo}
              onChange={(event) =>
                setFilters({ updatedTo: event.target.value })
              }
              className="h-10 w-full rounded-md border border-border px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-blue-500/30"
            />
          </div>
        </div>

        <div>
          <label className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Due Date
          </label>
          <div className="mt-2 space-y-2">
            <input
              type="date"
              value={filters.dueFrom}
              onChange={(event) => setFilters({ dueFrom: event.target.value })}
              className="h-10 w-full rounded-md border border-border px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-blue-500/30"
            />
            <input
              type="date"
              value={filters.dueTo}
              onChange={(event) => setFilters({ dueTo: event.target.value })}
              className="h-10 w-full rounded-md border border-border px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-blue-500/30"
            />
          </div>
        </div>

        <div>
          <label className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Contains
          </label>
          <input
            type="text"
            value={filters.q}
            onChange={(event) => setFilters({ q: event.target.value })}
            placeholder="Subject or description..."
            className="mt-2 h-10 w-full rounded-xl border border-border bg-popover px-3 text-[13px] text-foreground shadow-sm transition-all focus:outline-none focus:ring-2 focus:ring-blue-500/30"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-[20px] border border-border bg-popover p-5 shadow-[0_4px_15px_rgb(0,0,0,0.04)] ring-1 ring-border">
      <div className="flex flex-wrap items-center gap-2">
        <div>
          <h4 className="text-[15px] font-semibold text-foreground tracking-tight">
            Advanced filters
          </h4>
          <p className="text-[13px] text-muted-foreground mt-0.5">
            Refine by status, ownership, SLA, and dates.
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {hasActiveFilters ? (
            <button
              type="button"
              onClick={clearFilters}
              className="inline-flex items-center gap-1 rounded-full border border-border bg-popover px-3 py-1.5 text-[13px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            >
              <X className="h-4 w-4" />
              Clear all
            </button>
          ) : null}
          {onClose ? (
            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center gap-1 rounded-full border border-border bg-popover px-3 py-1.5 text-[13px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            >
              Close
            </button>
          ) : null}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        <MultiSelectFilter
          label="Status"
          options={STATUS_OPTIONS}
          selected={filters.statuses}
          onChange={(statuses) => setFilters({ statuses })}
          placeholder="All statuses"
          searchable
        />
        <MultiSelectFilter
          label="Priority"
          options={PRIORITY_OPTIONS}
          selected={filters.priorities}
          onChange={(priorities) => setFilters({ priorities })}
          placeholder="All priorities"
          searchable={false}
        />
        <MultiSelectFilter
          label="SLA Status"
          options={SLA_STATUS_OPTIONS}
          selected={filters.slaStatus}
          onChange={(slaStatus) =>
            setFilters({ slaStatus: slaStatus as typeof filters.slaStatus })
          }
          placeholder="Any SLA status"
          searchable={false}
        />
        {showTeamFilter ? (
          <MultiSelectFilter
            label="Team"
            options={teamOptions}
            selected={filters.teamIds}
            onChange={(teamIds) => setFilters({ teamIds })}
            placeholder="All teams"
          />
        ) : null}
        <MultiSelectFilter
          label="Assignee"
          options={assigneeOptions}
          selected={filters.assigneeIds}
          onChange={(assigneeIds) => setFilters({ assigneeIds })}
          placeholder="All assignees"
        />
        <MultiSelectFilter
          label="Requester"
          options={requesterSelectOptions}
          selected={filters.requesterIds}
          onChange={(requesterIds) => setFilters({ requesterIds })}
          placeholder="All requesters"
        />
        <DateRangeFilter
          label="Created Date"
          from={filters.createdFrom}
          to={filters.createdTo}
          onFromChange={(createdFrom) => setFilters({ createdFrom })}
          onToChange={(createdTo) => setFilters({ createdTo })}
          placeholder="Any created date"
        />
        <DateRangeFilter
          label="Updated Date"
          from={filters.updatedFrom}
          to={filters.updatedTo}
          onFromChange={(updatedFrom) => setFilters({ updatedFrom })}
          onToChange={(updatedTo) => setFilters({ updatedTo })}
          placeholder="Any updated date"
        />
        <DateRangeFilter
          label="Due Date"
          from={filters.dueFrom}
          to={filters.dueTo}
          onFromChange={(dueFrom) => setFilters({ dueFrom })}
          onToChange={(dueTo) => setFilters({ dueTo })}
          placeholder="Any due date"
        />
        <TextFilterDropdown
          label="Contains"
          value={filters.q}
          onChange={(q) => setFilters({ q })}
          placeholder="Any text"
          inputPlaceholder="Subject or description..."
        />
        <div className="min-w-[180px] self-end">
          <SavedViewsDropdown
            currentFilters={filters}
            onApplyFilters={setFilters}
            onSaveSuccess={onSaveSuccess}
            onError={onError}
          />
        </div>
      </div>
    </div>
  );
}
