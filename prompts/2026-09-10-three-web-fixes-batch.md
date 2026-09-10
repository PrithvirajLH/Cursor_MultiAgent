# Implementation Prompt — three fixes, in order

**Date:** 2026-09-10
**Repo:** `Ticketing System Quality Review` (branch `ui-redesign-and-api-hardening`)
**Cards:** 1.66, 1.61, 1.65 (its remaining half) — **in that order**

**One commit per card. Three commits.** Work straight through. Do not check in
between cards, and do not ask permission.

> ## ⚠️ Read this before you touch anything: two other workstreams are in this tree
>
> As of writing, **cards 1.62 and 1.65 are both UNCOMMITTED**, from two different
> sessions. **Check `git status` first.**
>
> - **If 1.62 is still uncommitted, commit it first** with explicit paths —
>   `apps/api/src/inbound-mailbox/*`, `graph-mail.http-client.ts`,
>   `tickets.service.ts`, `test/integration/inbound-mailbox.spec.ts`. It is
>   **GREEN** (verified 2026-09-10).
> - **If 1.65's first half is still uncommitted, commit it separately** —
>   `apps/web/src/api/is-abort-error.*`, `client.ts`, `TicketsPage.tsx`,
>   `TriageBoardPage.tsx`.
> - ⚠️ **Never `git add -A` in this repo right now.** The two sets do not overlap;
>   explicit paths keep the history honest. A misattributed commit is a lie the
>   log tells for years.
>
> **§3 is blocked until 1.65's first half is committed.** If it is not, do §1 and
> §2 and say so.

---

## 0. Before anything

- **Read `CLAUDE.md`.** Its baseline block now says explicitly which numbers came
  from which uncommitted workstream. **Re-measure rather than trusting it** —
  it has been stale twice this week, both times because the tree moved.
- ⚠️ **Before any integration run, kill surviving jest processes.** A harness
  reporting a run as killed is **not** evidence it stopped. **Exit 127 with no
  summary is a spawn failure, not a test failure.** `repo-landmines.md`.
- **No migrations in this batch.** Count must stay at **60**. If you think you
  need one, **stop and report**.
- **Trust a live run over this document.** This planner's handoffs have carried a
  wrong line number, a stale premise, a fix instruction that would not have
  worked, an instruction impossible because of an index I had not read, and — on
  card 1.53 — a description of one list where there were two. **Say where this one
  is wrong.**

---

## 1 — Card 1.66: a trimmed reply can truncate an agent's own note (XS)

**Do this first, because card 1.62 is about to ship and this is a defect it
introduces.**

1.62 wired `stripQuotedReply` into **`listMessages`** (`tickets.service.ts:1203`)
— the single message-read path — so it now runs on **every displayed message,
including ones an agent typed.** Two of its six markers are things a person
writes:

```
/^_{5,}\s*$/m      five or more underscores on a line
/^--[ \t]?$/m      a bare "--"
```

An agent using either sees their note **silently truncated on screen.** The
stored body is intact, so this is display-only — but an agent seeing their own
words cut short is bad enough.

### The fix: delete markers 5 and 6. No migration, nothing lost.

1.62's implementer thought this needed a way to tell agent-authored from inbound,
hence a migration — `TicketMessage` has only `authorId` and `type`, no origin
column, and `InboundEmailReceipt.messageId` is an RFC id rather than a foreign
key. **All true, and all avoidable.**

- [ ] **The argument, and it is complete.** `stripQuotedReply` cuts at the
      **earliest** match across all six markers. So markers 5 and 6 can only
      change the outcome when they match **earlier than** markers 1–4, or when
      **none of 1–4 match at all.** Markers 1–4 — our own
      `----- Reply above this line -----`, `-----Original Message-----`, `From:`
      followed by `Sent:`/`Date:`, and `On … wrote:` — are unambiguous email
      artefacts that a genuine reply essentially always carries. **So 5 and 6 only
      ever bite a message with no email signal whatsoever, which is precisely an
      agent's note.**
- [ ] **Checked against the real message.** In
      `inbound-mailbox/__fixtures__/outlook-reply.html`, markers 5 and 6 match
      **zero** times; the trimming is done by markers 1 and 3. **They contribute
      nothing to the case the util was built for.**
- [ ] **Marker 6 contradicts the util's own stated principle.** 1.62's implementer
      wrote that *"the util declines to guess at signature blocks, which its own
      comment argues for"* — while marker 6 **is** a signature delimiter. Removing
      it makes the code agree with its own documentation.

### Two tests will fail, and how you update them matters

- [ ] **`:64` "cuts an underscore rule".** Body is
      `['Done.', '', '____…', 'From: x']`. ⚠️ **Note that `From: x` does NOT match
      marker 3**, which requires `Sent:`/`Date:` on the following line. **So with
      marker 5 gone this body has no email signal at all and is returned
      unchanged** — and that is the honest new expectation. **This fixture is
      itself an example of the ambiguity the card is about.** Say so in the test.
- [ ] **`:69` "cuts the RFC signature delimiter".** Body is
      `['Thanks for the help.', '', '-- ', 'Sarah Chen', 'Service Desk']`. With
      marker 6 gone the signature stays, which is what the util claims to do
      anyway.
- [ ] ⚠️ **Do not just delete those two tests.** Rewrite them to assert the new
      behaviour, so the decision stays visible. A deleted test is a decision
      nobody can find later.
- [ ] **`:80` and `:93` should still pass untouched** — `:80` already guards
      against treating a long dash rule as a signature, and `:93`'s body uses
      markers 2 and 4. **If either changes, stop: something else is going on.**
- [ ] **Add one test for the case this card exists for:** an agent's note
      containing a divider line comes back **byte-identical**.

---

## 2 — Card 1.61: the sidebar's system views cannot be hidden (S)

**The handoff is already written:
`prompts/2026-09-10-1-61-system-views-are-not-hideable.md`. Follow it.**

Found by the **owner** within an hour of card 1.53 reaching production, trying to
hide *Follow-ups due today* on Payroll.

**This is the planner's error, and worth knowing so you trust the card over my
1.53 handoff:** I described the sidebar presets as **one** list. There are **two**.
Card 1.53's hiding reaches the six in `SAVED_VIEWS`
(`components/shell/saved-views.ts`). The four rows above them come from
elsewhere — *Assigned to Me* from `App.tsx` nav children, and **Watching,
Mentions and Follow-ups due today defined inline in
`SidebarSavedViews.tsx:172-189`** — verified, they are not in `SAVED_VIEWS` at all.

- [ ] **The panel is not lying.** It says *"6 of 6 shown"* and that is true of the
      list it controls. It simply does not control the others — **which is worse
      than an error, because it looks like it worked.**
- [ ] ⚠️ **My own 1.53 worked example used two of the hideable six** (*SEV1 today*,
      *Awaiting reply > 24h*), **so the card passed while the owner's first real
      attempt failed.** That is why this slipped, and it is worth remembering the
      next time a card's example is drawn from the same place as its fix.
- [ ] **No migration.** `Team.hiddenPresetIds` already exists from migration 59
      and is a plain string array — these four need **ids in it**, not a new
      column.
- [ ] **The regression assertion:** hiding one of the four hides it **for that team
      only** and leaves every other team untouched. That is the same shape 1.53's
      test used; extend it rather than writing a parallel one.

---

## 3 — Card 1.65: the remaining sweep (S) — **only after its first half is committed**

Another session part-fixed 1.65: the shared cause and the two lists the owner
actually uses are done. **The sweep is not.** The same bare-catch shape — a
`catch` that special-cases nothing and renders a generic failure — is in about
fifteen more places:

```
AdminTagsPage:90        AgentProfilePage:106      AgentsDirectoryPage:92
AutomationRulesPage:1285  ManagerViewsPage:812
SlaSettingsPage:1401/1432/1447
TeamPage:455/472/490/510
TriageBoardPage:605     TagAnalyticsPanel:22
```

**Planner spot-checked four of those and they are exactly that shape.**

- [ ] ⚠️ **Judge each one. Do not `sed` the list.** That instruction is the other
      session's and it is right: **a one-shot load that cannot be superseded is
      fine as it is.** The bug bites where a request can be *cancelled* — which
      means navigation away mid-flight — not everywhere a catch is broad.
- [ ] **Say which you changed and which you deliberately did not, and why.** A
      list of fifteen with no reasoning is not a review.
- [ ] ⚠️ **A timeout must keep reaching the user.** `fetchWithTimeout` aborts on
      its own deadline but rethrows as `ApiError(…, 408)` — **a real failure.** The
      abort is the *mechanism*, not the *meaning*. The other session left a test
      specifically to stop a later "simplification" swallowing it; **do not
      swallow it.**
- [ ] **Reuse `isAbortError`** from `apps/web/src/api/is-abort-error.ts`. Do not
      write a second one — the whole reason 1.65 happened is that the knowledge
      existed privately in `client.ts` and the list could not reach it.

---

## 4 — What to report back

1. **Three commit SHAs** (or two, if §3 was blocked) and `git diff --stat` each.
2. Every `Tests:` line, both `tsc`, vitest, and **the migration count, which must
   still be 60.**
3. The answers:
   - **1.66 —** how you rewrote the two failing tests, and confirmation that `:80`
     and `:93` passed untouched.
   - **1.61 —** the ids you gave the four system rows, and how a stale id is
     handled.
   - **1.65 —** which of the ~15 sites you changed, which you left, **and why for
     each.**
4. **For each card, the specific assertion that would fail if the bug came back.**
5. ⚠️ **Whether you had to commit anyone else's work to get a clean tree**, and if
   so exactly what. **Say it loudly** — this batch starts with two other sessions'
   changes sitting in the tree.
6. Anything that did not match. **This document is wrong somewhere.**

## 5 — Browser pass

- [ ] **1.66** — type an internal note containing a line of underscores, save it,
      and confirm it **displays in full**.
- [ ] **1.61** — as a team admin, hide *Follow-ups due today*. Confirm it goes for
      that team and **stays for another team**.
- [ ] **1.65** — open a ticket from the list and navigate straight back, twice.
      Confirm **no** *"Unable to load tickets"* and that the rows stay on screen.

**Stop and report instead of improvising** if 1.66's change makes `:80` or `:93`
fail, if 1.61 appears to need a migration or a second hiding mechanism, if 1.65's
sweep would mean weakening the 408 timeout path, or if you cannot separate the
uncommitted work in the tree.
