# Implementation Prompt — 1.36 A staff member's own ticket

**Date:** 2026-09-02
**Repo:** `Ticketing System Quality Review` (branch `ui-redesign-and-api-hardening`)
**Card:** 1.36 in `prompts/2026-08-26-restart-master-plan.md`
**Closes:** three faults with one cause — the app decides what someone may see or
do on a ticket from their **rank** or their **roster row**, never from their
actual relationship to the ticket.

**Cost:** none. **No migration.** Faults A and B are API-only; Fault C is a
one-line disagreement between the web and the API.

| | Fault | State |
|---|---|---|
| A | A staff requester reads the internal notes written about them | latent — 0 of 46 tickets raised by staff |
| B | A staff member cannot see a ticket they raised into another team | dormant — only one staffed team exists |
| C | UI requires a roster row where the API accepts `primaryTeamId` | **hit in production 2026-09-02**, worked around |

> ⚠️ This document describes a live weakness in a running system, and both GitHub
> remotes are public. Same handling as `docs/security-audit-2026-08.md` — think
> before pushing it outward.

---

## 1. Why this exists

Found on 2026-09-02 while verifying the email pipeline batch. The owner asked a
plain question — *"why is an internal note visible to the requester in-app?"* —
and the honest answer turned out to be *"it isn't, but only by luck."*

Nothing has gone wrong yet. All 46 production tickets arrived from floor staff
through the Power Automate intake, and **zero** were raised by a staff account.
The moment one is, both faults below become real on the same ticket.

## 2. Fault A — a staff requester reads the internal notes about themselves

`apps/api/src/tickets/tickets.service.ts:1026`, the message-list query:

```ts
const where: Prisma.TicketMessageWhereInput = {
  ticketId,
  ...(user.role === UserRole.EMPLOYEE ? { type: MessageType.PUBLIC } : {}),
};
```

The only question asked is *are you an EMPLOYEE?* Anyone who is not sees every
`INTERNAL` message on every ticket they can open — **including a ticket they
raised themselves**.

### The scenario, with real accounts

Every staff account is on **payroll**, and payroll is the only team receiving
tickets:

| Account | Role | Team |
|---|---|---|
| `phulgur@` | AGENT | payroll |
| `vle@` | LEAD | payroll |
| `gweitzer@` | TEAM_ADMIN | payroll |
| `grblake@`, `itbot@`, `zmeraz@` | OWNER | none — `roleFilter` returns `{}` |

1. Vi Le (LEAD, payroll) has a problem with **her own** paycheck and files a
   ticket. It routes to payroll — necessarily her own team, since it is the only
   team she is on.
2. Grant writes an internal note: *"Vi's been overpaid since June — check with
   Finance before we reply to her."*
3. Vi opens her ticket. She is a LEAD, not an EMPLOYEE, so the filter does not
   apply. **She reads the note.**

No one misused anything. The system never asked whether she was the requester.

**The obvious mitigation does not hold.** "Agents will not raise tickets to their
own department" fails here because payroll is the only department that
operationally exists — there is nowhere else for a staff ticket to go. And it
never applied to the three OWNER accounts, whose `roleFilter` returns `{}`.

### The fix

Hide internal messages when the viewer **is the ticket's requester**, whatever
their rank — the same shape as the fix card 1.22 applied to the send path. Rank
still governs everything else.

```ts
// sketch, not final: the requester of a ticket never sees its internal notes,
// however senior they are elsewhere in the system.
const isRequester = ticket.requesterId === user.id;
...(user.role === UserRole.EMPLOYEE || isRequester
  ? { type: MessageType.PUBLIC }
  : {}),
```

`tickets.service.ts:1026` is the list query and the one that matters. **Check for
sibling reads** before calling this done — any other path that returns messages
(single-message fetch, search, export, the AI pipeline's context builder) needs
the same condition, or it becomes the next hole.

## 3. Fault B — a staff member cannot see their own ticket at all

`apps/api/src/common/access-control.service.ts`, `roleFilter`:

```ts
if (user.role === UserRole.EMPLOYEE) {
  return { requesterId: user.id };
}
...
// AGENT / LEAD: team scope only — no requesterId clause
return { OR: teamScope.flatMap(teamId => [
  { assignedTeamId: teamId },
  { accessGrants: { some: { teamId } } },
]) };
```

EMPLOYEE gets `{ requesterId: user.id }`. AGENT and LEAD get **team scope only**.
TEAM_ADMIN gets `primaryTeamId` only.

So a staff member who raises a ticket to a team they are not on **cannot see it**:
not in their list, not by URL, no reply, no confirmation it was resolved. It is
simply gone.

**Dormant today** — every staff account and every ticket is on payroll, so the
team clause happens to match. It switches on the first time a second staffed team
exists. An IT agent filing a payroll ticket about her own paycheck loses it
immediately.

### The fix

Add the requester relationship to the AGENT, LEAD and TEAM_ADMIN branches:

```ts
{ OR: [ ...teamScopeClauses, { requesterId: user.id } ] }
```

Note the interaction: this **widens** ticket access, which is exactly what makes
Fault A worth fixing in the same change. Landing B without A means a staff
requester can suddenly reach a ticket *and* read its internal notes. **Do A first,
or both together — never B alone.**

## 3b. Fault C — the UI and the API disagree about what a team is

**Observed live on 2026-09-02**, and the only one of the three that has actually
cost anyone time.

`phulgur@` (AGENT) had `primaryTeamId = payroll` but **no `TeamMember` row**. The
agent could open payroll tickets but the assign control never appeared — and no
request reached the server, because the UI never rendered it.

The two layers answer "is this person on the team?" differently:

| Layer | Rule |
|---|---|
| API — `auth.guard.ts:116` | `membership?.teamId ?? user.primaryTeamId ?? null`, then `operationalTeamIds` falls back to that `teamId` |
| Web — `TicketDetailPage.tsx:333` | `teamMembers.some(m => m.user.email === currentEmail)` — roster rows **only** |

So the API accepts `primaryTeamId` as team scope; the UI requires a roster row.
An account configured with one and not the other looks fully functional and can
silently do nothing. `canAssignTicket` would have allowed the assignment on any
of the 53 unassigned tickets.

**Resolved in production** by adding the roster row; verified afterwards that no
account is left with a `primaryTeamId` and no matching `TeamMember`.

### The fix

Pick one definition and use it in both places. Either the web mirrors the guard's
fallback, or `primaryTeamId` stops being accepted as team scope without a roster
row. A cheap guard either way: fail loudly — or refuse to save — when an account
is given a primary team it is not a member of, rather than letting it half-work.

## 4. What to verify

Unit tests are the right level for both; neither needs a browser.

1. A LEAD/AGENT/TEAM_ADMIN/OWNER who is the **requester** gets `PUBLIC` messages
   only.
2. The same person on a ticket they did **not** raise still sees `INTERNAL` — no
   regression to the agent's normal working view.
3. An EMPLOYEE requester is unchanged.
4. An AGENT can see a ticket they raised into another team (Fault B), **and**
   sees only public messages on it (A and B together).
5. An AGENT still cannot see an unrelated ticket on another team.
6. Sweep for sibling message reads (§2) and cover each one found.

Baselines to hold: **405 unit / 43 suites**, **457 integration + 1 skipped**,
web **70 / 18**, both typechecks clean.

## 5. Priority

Below **1.35** (every email preview currently reads
`- Reply above this line - [pilot mode...`, so the inbox is unreadable) and below
the **1.31 verification gap** (the agent-name From line has never been seen,
because every ticket is on payroll and payroll keeps the generic identity).

Above nothing urgent — but both faults here are one condition each, they share a
cause, and Fault A is the kind of thing that is embarrassing to explain after it
happens rather than before.
