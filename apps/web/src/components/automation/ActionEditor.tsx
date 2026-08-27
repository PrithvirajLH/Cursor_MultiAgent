import type { AutomationAction } from "../../api/client";

const ACTION_TYPES = [
  { value: "assign_team", label: "Assign to team" },
  { value: "assign_user", label: "Assign to user" },
  { value: "set_priority", label: "Set priority" },
  { value: "set_status", label: "Set status" },
  { value: "notify_team_lead", label: "Notify team lead" },
  { value: "notify_requester", label: "Notify requester (in-app)" },
  { value: "add_internal_note", label: "Add internal note" },
  { value: "add_tag", label: "Add tags" },
  { value: "remove_tag", label: "Remove tags" },
  { value: "set_category", label: "Set category" },
  { value: "add_follower", label: "Add follower" },
  { value: "send_email", label: "Send email" },
] as const;

const PRIORITIES = ["SEV1", "SEV2", "SEV3", "SEV4"];
const STATUSES = [
  "NEW",
  "TRIAGED",
  "ASSIGNED",
  "IN_PROGRESS",
  "WAITING_ON_REQUESTER",
  "WAITING_ON_VENDOR",
  "RESOLVED",
  "CLOSED",
  "REOPENED",
];
const MAX_TAGS = 5;
const FOLLOWER_TARGETS = [
  { value: "requester", label: "Requester" },
  { value: "assignee", label: "Assignee" },
  { value: "user", label: "Specific person" },
];
const EMAIL_RECIPIENTS = [
  { value: "requester", label: "Requester" },
  { value: "assignee", label: "Assignee" },
  { value: "team_leads", label: "Team leads" },
  { value: "address", label: "Email address" },
];
const EMAIL_HINT =
  "Placeholders: {{ticket.displayId}}, {{ticket.subject}}, {{requester.displayName}}. Only the ticket subject is exposed — never descriptions or messages; an external address still receives that subject.";

/** Extra action parameters accepted by the API (card 1.4); not yet on the shared client type. */
type RuleAction = AutomationAction & {
  tags?: string[];
  categoryId?: string;
  target?: string;
  to?: string;
  address?: string;
  subject?: string;
};

type Props = {
  action: AutomationAction;
  onChange: (a: AutomationAction) => void;
  onRemove: () => void;
  teams: { id: string; name: string }[];
  users: { id: string; displayName: string; email: string }[];
  categories?: { id: string; name: string }[];
};

function parseTags(raw: string): string[] {
  return raw
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean)
    .slice(0, MAX_TAGS);
}

export function ActionEditor({
  action,
  onChange,
  onRemove,
  teams,
  users,
  categories = [],
}: Props) {
  const rich = action as RuleAction;
  const type = rich.type ?? "assign_team";
  const followerMode = rich.userId ? "user" : (rich.target ?? "requester");
  const recipient = rich.to ?? "requester";
  const inputClass =
    "rounded border border-border bg-card px-2 py-1 text-xs min-w-[160px]";
  const selectClass = "rounded border border-border bg-card px-2 py-1 text-xs";
  const update = (patch: Partial<RuleAction>) => {
    const next: RuleAction = { ...rich, ...patch };
    onChange(next);
  };

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/50 p-2 text-sm">
      <select
        className={selectClass}
        value={type}
        onChange={(e) => onChange({ type: e.target.value })}
      >
        {ACTION_TYPES.map((a) => (
          <option key={a.value} value={a.value}>
            {a.label}
          </option>
        ))}
      </select>
      {type === "assign_team" && (
        <select
          className={selectClass}
          value={rich.teamId ?? ""}
          onChange={(e) => update({ teamId: e.target.value })}
        >
          <option value="">Select team</option>
          {teams.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      )}
      {type === "assign_user" && (
        <select
          className={`${selectClass} min-w-[140px]`}
          value={rich.userId ?? ""}
          onChange={(e) => update({ userId: e.target.value })}
        >
          <option value="">Select user</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.displayName}
            </option>
          ))}
        </select>
      )}
      {type === "set_priority" && (
        <select
          className={selectClass}
          value={rich.priority ?? ""}
          onChange={(e) => update({ priority: e.target.value })}
        >
          <option value="">Select</option>
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      )}
      {type === "set_status" && (
        <select
          className={selectClass}
          value={rich.status ?? ""}
          onChange={(e) => update({ status: e.target.value })}
        >
          <option value="">Select</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s.replace(/_/g, " ")}
            </option>
          ))}
        </select>
      )}
      {(type === "notify_team_lead" ||
        type === "notify_requester" ||
        type === "add_internal_note") && (
        <input
          type="text"
          className={inputClass}
          placeholder={
            type === "add_internal_note"
              ? "Note text"
              : type === "notify_requester"
                ? "Reminder text (optional)"
                : "Message (optional)"
          }
          value={rich.body ?? ""}
          onChange={(e) => update({ body: e.target.value })}
        />
      )}
      {(type === "add_tag" || type === "remove_tag") && (
        <input
          type="text"
          className={inputClass}
          placeholder="Tags, comma-separated (max 5)"
          value={(rich.tags ?? []).join(", ")}
          onChange={(e) => update({ tags: parseTags(e.target.value) })}
        />
      )}
      {type === "set_category" && (
        <select
          className={`${selectClass} min-w-[160px]`}
          value={rich.categoryId ?? ""}
          onChange={(e) => update({ categoryId: e.target.value })}
        >
          <option value="">Select category</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      )}
      {type === "add_follower" && (
        <>
          <select
            className={selectClass}
            value={followerMode}
            onChange={(e) =>
              update(
                e.target.value === "user"
                  ? { target: undefined, userId: "" }
                  : { target: e.target.value, userId: undefined },
              )
            }
          >
            {FOLLOWER_TARGETS.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
          {followerMode === "user" && (
            <select
              className={`${selectClass} min-w-[140px]`}
              value={rich.userId ?? ""}
              onChange={(e) => update({ userId: e.target.value })}
            >
              <option value="">Select user</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.displayName}
                </option>
              ))}
            </select>
          )}
        </>
      )}
      {type === "send_email" && (
        <>
          <select
            className={selectClass}
            value={recipient}
            onChange={(e) => update({ to: e.target.value, address: undefined })}
          >
            {EMAIL_RECIPIENTS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
          {recipient === "address" && (
            <input
              type="email"
              className={inputClass}
              placeholder="name@example.com"
              value={rich.address ?? ""}
              onChange={(e) => update({ address: e.target.value })}
            />
          )}
          <input
            type="text"
            className={inputClass}
            placeholder="Subject"
            maxLength={200}
            value={rich.subject ?? ""}
            onChange={(e) => update({ subject: e.target.value })}
          />
          <input
            type="text"
            className={`${inputClass} flex-1`}
            placeholder="Body"
            maxLength={4000}
            value={rich.body ?? ""}
            onChange={(e) => update({ body: e.target.value })}
          />
          <span className="w-full text-[11px] text-muted-foreground">
            {EMAIL_HINT}
          </span>
        </>
      )}
      <button
        type="button"
        onClick={onRemove}
        className="rounded border border-border bg-card px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
      >
        Remove
      </button>
    </div>
  );
}
