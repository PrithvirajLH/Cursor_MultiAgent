# Implementation Prompt — 1.37 An agent cannot see whether their own message was internal

**Date:** 2026-09-02
**Repo:** `Ticketing System Quality Review` (branch `ui-redesign-and-api-hardening`)
**Card:** 1.37 in `prompts/2026-08-26-restart-master-plan.md`
**Closes:** both signals that mark a message as internal — the amber bubble and
the `Internal` badge — are suppressed on the author's **own** messages. An agent
reading their own screen cannot tell whether what they wrote went to the
requester or stayed private.

**Cost:** none. **Web only.** No API change, no schema, no migration.

> Found in production on 2026-09-02, within an hour of the email pipeline batch
> going live, by the owner using the app normally as `phulgur@` (AGENT).

---

## 1. The evidence

Six messages on `PA_20260902_046`. Database truth:

```
19:04:00  PUBLIC    itbot@      "Test reply one …"
19:04:48  PUBLIC    itbot@      "Test reply two …"
19:05:44  INTERNAL  itbot@      "Internal note — card 1.33 check …"
19:35:50  INTERNAL  phulgur@    "This is an agent message, should be sent as an email …"
19:36:26  INTERNAL  phulgur@    "now ?"
19:36:32  INTERNAL  phulgur@    "Test 4"
```

All three of `phulgur@`'s messages are `INTERNAL`. Two views of the same data:

| Viewer | What the three messages looked like |
|---|---|
| `itbot@` (OWNER — someone else's messages) | all three amber, one `Internal` badge on the group header — **correct** |
| `phulgur@` (the author) | all three in the ordinary blue "sent" bubble, `Internal` badge on **one** of them — **wrong** |

The author wrote three internal notes believing they were public replies, and
reasonably concluded the email pipeline was broken when nothing arrived. Nothing
was broken: card 1.33 correctly sends no email for an internal note.

## 2. Fault A — the bubble colour never signals internal to the author

`apps/web/src/components/ticket-detail/TicketConversation.tsx`, bubble styling:

```ts
isCurrentUser  ? "border-primary bg-primary text-primary-foreground"   // checked FIRST
: isInternal   ? "border-amber-300 bg-amber-50 …"                      // unreachable for own
: "border-border bg-card text-foreground"
```

`isCurrentUser` short-circuits before `isInternal` is considered, so an author's
own internal note always renders in the ordinary blue "sent" style. The amber
treatment exists and works — but only for *other people's* internal notes, which
is the case that needs it least.

**Fix.** Internal-ness must survive the `isCurrentUser` branch. Give the author's
own internal messages a distinct treatment — the amber border/tint applied over
the sent-bubble shape, or an amber ring on the blue bubble. Do not simply reorder
the ternary: that would make an agent's own internal notes look like someone
else's, losing the left/right sent/received distinction the layout relies on.

## 3. Fault B — the badge is gated on group start

Same file, line ~297:

```ts
{isGroupStart ? ( …author name + Internal badge + timestamp… ) : null}
```

with

```ts
const isGroupStart = !previousIsSameSender;   // same author, same type, within 5 minutes
```

Consecutive messages from one author collapse into a group with a single header,
so only the first message of a run carries the `Internal` badge. Every later
message in that run is visually indistinguishable from a public reply.

Note the grouping predicate already includes `previousMessage.type ===
message.type`, so a group is never mixed — which means the badge is *safe* to
render per-message, and the honest fix is not to hide it at all.

**Fix.** Show the internal marker on **every** internal message, not only on
group starts. It does not have to be the full header — a small inline marker on
the bubble itself is enough, and keeps the grouped layout tidy.

## 4. Fault C — nothing confirms what is about to be sent

Contributing, lower severity. `TicketDetailPage.tsx:182`:

```ts
const [messageType, setMessageType] = useState<"PUBLIC" | "INTERNAL">("PUBLIC");
```

The default is correct — `PUBLIC` on mount, **not** sticky across page loads. But
once switched to Internal it stays there for the rest of the session, and the
only indication is the composer chip. Combined with faults A and B, an agent can
switch to Internal once, write five messages, and see nothing anywhere on screen
telling them those five never reached the requester.

**Fix (suggestion, owner's call).** Either surface the pending mode more
strongly at the moment of sending, or reset to `PUBLIC` after an internal note is
posted so Internal is always a deliberate per-message choice. Prefer the first if
agents habitually write runs of internal notes.

## 5. Why this ranks above 1.36

Today's failure was harmless — the owner expected public, got internal, and no
email was sent. **The mirror image is the real risk:** an agent believes the
toggle is on Internal, writes a candid note about a requester, and it goes to
that requester's inbox. Same blind spot, opposite direction, and now that card
1.23 actually delivers email, that message really does leave the building.

Related and deliberately separate:

- **1.36** is about *who may read* a message. This card is about *whether the
  author can tell what they sent*.
- **1.28** ("the agent cannot see who a reply will reach") is the same theme —
  the audience for a message is invisible. 1.28 and this card should probably be
  designed together even if shipped apart.

## 6. What to verify

Component tests are the right level; none of this needs a browser.

1. An author's own `INTERNAL` message is visually distinct from their own
   `PUBLIC` message.
2. Every message in a grouped run of internal messages carries the marker, not
   just the first.
3. Another user's internal message still renders amber with the badge — no
   regression to the view that is currently correct.
4. Public messages are unchanged in both views.
5. If Fault C is fixed by resetting: posting an internal note returns the
   composer to `PUBLIC`.

Baselines to hold: web **70 tests / 18 files**, both typechecks clean; API
untouched at **405 unit / 43 suites** and **457 integration + 1 skipped**.
