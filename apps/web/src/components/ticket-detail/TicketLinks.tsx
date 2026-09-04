import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link2, Plus, X } from "lucide-react";
import { Link } from "react-router-dom";
import {
  fetchTickets,
  linkTicket,
  unlinkTicket,
  type TicketLinkRecord,
  type TicketLinkType,
} from "../../api/client";

const SEARCH_MIN_CHARS = 2;
const SEARCH_PAGE_SIZE = 5;
const SEARCH_STALE_MS = 30_000;

const LINK_TYPES: { value: TicketLinkType; label: string }[] = [
  { value: "RELATED", label: "Related to" },
  { value: "DUPLICATE_OF", label: "Duplicate of" },
  { value: "PARENT_OF", label: "Parent of" },
];

/**
 * What this link says, read from the ticket currently open.
 *
 * The server stores one row per relationship and tells us which end we are on,
 * so the inverse is derived here rather than stored. RELATED is symmetric and
 * reads the same either way; the other two do not, and a stored row that said
 * "duplicate of" in both directions would be actively wrong on one of them.
 */
export function linkLabel(
  type: TicketLinkType,
  direction: "outgoing" | "incoming",
): string {
  if (type === "RELATED") return "Related";
  if (type === "DUPLICATE_OF") {
    return direction === "outgoing" ? "Duplicate of" : "Duplicated by";
  }
  return direction === "outgoing" ? "Child" : "Parent";
}

/** How a linked ticket is named: its own id when readable, else just the number. */
export function linkReference(link: TicketLinkRecord): string {
  const { otherTicket } = link;
  if (otherTicket.visible && otherTicket.displayId) return otherTicket.displayId;
  return `#${otherTicket.number}`;
}

type TicketLinksProps = {
  ticketId: string;
  links: TicketLinkRecord[];
  canManage: boolean;
  onChanged: () => void;
};

/**
 * "Linked tickets" — the relationships this ticket has to others (card 1.6).
 *
 * A link whose target the reader cannot open is still listed, as a bare
 * reference with no subject. Hiding it outright would leave an agent unable to
 * see that the ticket was linked at all; showing the subject would leak the
 * content of a ticket they have no access to, and HR and payroll subjects carry
 * people's names. The server decides which of those applies — this component
 * only renders what it was given, and never has the subject in the first place.
 */
export function TicketLinks({
  ticketId,
  links,
  canManage,
  onChanged,
}: TicketLinksProps) {
  const [adding, setAdding] = useState(false);
  const [search, setSearch] = useState("");
  const [linkType, setLinkType] = useState<TicketLinkType>("RELATED");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trimmed = search.trim();
  const searchQuery = useQuery({
    queryKey: ["ticket-link-search", trimmed],
    queryFn: () =>
      fetchTickets({ q: trimmed, pageSize: SEARCH_PAGE_SIZE, statusGroup: "all" }),
    enabled: adding && trimmed.length >= SEARCH_MIN_CHARS,
    staleTime: SEARCH_STALE_MS,
  });
  // The ticket being viewed always matches its own subject search; it cannot be
  // linked to itself, so it never belongs in the candidate list.
  const candidates = (searchQuery.data?.data ?? []).filter(
    (row) => row.id !== ticketId,
  );
  async function handleLink(toTicketId: string) {
    setBusy(true);
    setError(null);
    try {
      await linkTicket(ticketId, toTicketId, linkType);
      setSearch("");
      setAdding(false);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not link the ticket");
    } finally {
      setBusy(false);
    }
  }
  async function handleUnlink(linkId: string) {
    setBusy(true);
    setError(null);
    try {
      await unlinkTicket(ticketId, linkId);
      onChanged();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not remove the link",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="rounded-xl border border-border bg-card shadow-card">
      <div className="flex items-center justify-between px-4 py-3">
        <h4 className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
          <Link2 className="h-3.5 w-3.5" />
          Linked tickets
          {links.length > 0 && (
            <span className="text-muted-foreground/70">({links.length})</span>
          )}
        </h4>
        {canManage && (
          <button
            type="button"
            onClick={() => {
              setAdding((open) => !open);
              setError(null);
            }}
            aria-expanded={adding}
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <Plus className="h-3 w-3" />
            Link
          </button>
        )}
      </div>
      {adding && (
        <div className="space-y-2 border-t border-border px-4 py-3">
          <div className="flex items-center gap-1.5">
            <label className="sr-only" htmlFor="ticket-link-type">
              Relationship
            </label>
            <select
              id="ticket-link-type"
              value={linkType}
              onChange={(event) =>
                setLinkType(event.target.value as TicketLinkType)
              }
              className="rounded-md border border-border bg-background px-2 py-1 text-[11px] text-foreground focus:outline-none focus:ring-2 focus:ring-ring/30"
            >
              {LINK_TYPES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search tickets…"
              aria-label="Search for a ticket to link"
              className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 text-[11px] text-foreground focus:outline-none focus:ring-2 focus:ring-ring/30"
            />
          </div>
          {trimmed.length >= SEARCH_MIN_CHARS && (
            <ul className="space-y-0.5">
              {candidates.map((row) => (
                <li key={row.id}>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void handleLink(row.id)}
                    className="w-full rounded-md px-2 py-1 text-left text-[11px] hover:bg-accent/40 disabled:opacity-60"
                  >
                    <span className="font-mono text-muted-foreground">
                      {row.displayId ?? `#${row.number}`}
                    </span>{" "}
                    <span className="text-foreground">{row.subject}</span>
                  </button>
                </li>
              ))}
              {!searchQuery.isLoading && candidates.length === 0 && (
                <li className="px-2 py-1 text-[11px] text-muted-foreground">
                  No matching tickets you can open.
                </li>
              )}
            </ul>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="px-4 pb-2 text-[11px] text-destructive">
          {error}
        </p>
      )}
      <div className="border-t border-border px-4 py-3">
        {links.length === 0 ? (
          <p className="text-[11px] text-muted-foreground">
            Not linked to any other ticket.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {links.map((link) => (
              <li
                key={link.id}
                className="flex items-start justify-between gap-2"
              >
                <div className="min-w-0">
                  <span className="mr-1.5 inline-block rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {linkLabel(link.type, link.direction)}
                  </span>
                  {link.otherTicket.visible ? (
                    <Link
                      to={`/tickets/${link.otherTicket.id}`}
                      className="text-[11px] text-foreground hover:underline"
                    >
                      <span className="font-mono text-muted-foreground">
                        {linkReference(link)}
                      </span>{" "}
                      {link.otherTicket.subject}
                    </Link>
                  ) : (
                    <span className="text-[11px] text-muted-foreground">
                      <span className="font-mono">{linkReference(link)}</span>{" "}
                      {link.otherTicket.deleted
                        ? "— deleted"
                        : "— you do not have access"}
                    </span>
                  )}
                </div>
                {canManage && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void handleUnlink(link.id)}
                    aria-label={`Remove the link to ${linkReference(link)}`}
                    title="Remove this link"
                    className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-60"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
