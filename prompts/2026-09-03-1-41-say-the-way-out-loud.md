# Implementation Prompt — 1.41 Say the way out where people can read it

**Date:** 2026-09-03
**Repo:** `Ticketing System Quality Review` (branch `ui-redesign-and-api-hardening`)
**Card:** 1.41 in `prompts/2026-08-26-restart-master-plan.md`
**Closes:** card 1.38 stops an agent sending a public reply that would be silently
stored as private. It then explains what to do instead **in a hover tooltip on a
non-focusable element**, so most people never see it.

**Cost:** none. **Web only.** No API, no schema, no migration. Size **XS**.

> Found by the implementer during the browser pass for card 1.30, on live
> production code (1.38 is deployed in `8511152`).

---

## 1. What is wrong

`TicketConversation.tsx:492-501`. When an agent cannot post publicly, the footer
shows a chip reading **"Internal note only"**, and the explanation is a `title`
attribute:

```tsx
<span
  className="… rounded-full border border-amber-300 …"
  title={isUnassigned
    ? "Assign this ticket to yourself to reply to the requester. Until then anything you write is an internal note."
    : "You can only leave internal notes on tickets assigned to a teammate. …"}
>
  <Shield … /><span>Internal note only</span>
</span>
```

**The wording is good. Its placement makes it invisible.**

| | Why it fails |
|---|---|
| Hover-only | Nothing on a touch device or a trackpad-averse user's screen ever shows it |
| On a `<span>`, not a control | The element is **not focusable**, so a keyboard user cannot reach it to trigger the tooltip at all |
| `title` on a non-interactive element | Screen-reader support is inconsistent; several ignore it entirely |
| Visible text is "Internal note only" | Says *what*, never *why* or *what to do about it* |

So the agent sees a chip telling them their message is private, with no way to
learn that **assigning the ticket to themselves is the fix** — which is the whole
point of what card 1.38 landed.

## 2. The fix, and where to put it

**Do not just widen the chip.** The composer footer is a tight right-aligned row
and card 1.39 (`a225a4d`, committed, awaiting deploy) deliberately reclaims space
in this region.

**Put it in the audience line instead** — the quiet line card 1.28 already renders
directly above the composer, which today reads *"Internal note — staff only, no
email sent."* That line already exists, is already visible, already sits exactly
where someone is about to type, and needs no new layout.

- [ ] When the agent is blocked because the ticket is **unassigned**, make that
      line say so and name the way out — e.g. **"Assign this ticket to yourself to
      reply to the requester — until then anything you write is an internal
      note."**
- [ ] When they are blocked because it is **assigned to a teammate**, keep the
      existing distinction: they may only leave internal notes. Do **not**
      collapse the two cases into one message; card 1.38's owner ruling turns on
      the difference.
- [ ] Keep the chip. It is a useful at-a-glance state marker, and it is what makes
      the composer's mode obvious without reading a sentence.
- [ ] **Consider making the sentence's key action a real control** rather than
      prose. The sidebar already has a **Me** button beside Assignee; if wiring the
      same action inline is genuinely small, do it and say so. If it means lifting
      state through two components, **do not** — prose that names the button is
      already a large improvement over a tooltip.
- [ ] Leave the `title` attributes in place if you like, but they must no longer be
      the only place the information exists.

## 3. Not a defect — checked, and the report was wrong

The same pass reported that the recipient disclosure has no `aria-expanded`.
**It does:** `MessageAudience.tsx:81` sets `aria-expanded={expanded}` on the
toggle. Nothing to do. Recorded so nobody spends time on it.

## 4. Tests

- [ ] Web: on an **unassigned** ticket, an AGENT sees the assign-yourself wording
      **as text in the document**, not only in a `title` attribute. Assert the
      rendered text, and assert it is **not** inside a `title=`.
- [ ] Web: on a ticket assigned to a **teammate**, the wording is the
      internal-notes-only one, and the two cases are distinguishable.
- [ ] Web: a `LEAD` on an unassigned ticket still sees the normal
      Public/Internal toggle and none of this wording — card 1.38's rule is
      `AGENT`-only and must not widen.
- [ ] Follow `renderToStaticMarkup`, as the existing web tests do.
- [ ] Targeted, then the **full** suite. The API is untouched, so the integration
      suite is **not** required for this card unless you commit it alongside
      something that touches the API.

## 5. Verification

```bash
cd "/c/Users/PHulgur/Downloads/Ticketing System Quality Review/apps/web"
npx tsc --noEmit && npx vitest run
cd ../api && npx tsc --noEmit && npx jest --silent
```

**Baselines**, verified 2026-09-03 at `5ed1159`: api `tsc` 0, unit **468 / 47**,
web `tsc` 0, vitest **123 / 24**. Integration is **512 + 1 skipped, 55 of 56** if
you do need to run it.

## 6. Acceptance criteria

1. An agent blocked from replying publicly can read **why** and **what to do**
   without hovering anything.
2. The two blocked cases stay distinguishable.
3. A `LEAD` is unaffected.
4. The composer's layout does not grow — this reuses the line card 1.28 already
   renders.
5. `tsc` clean both sides; vitest and API unit at or above §5.

## 7. What to report back

1. Commit SHA and `git diff --stat`.
2. `tsc` both sides, vitest, API unit.
3. **A screenshot of the composer on an unassigned ticket as an AGENT**, showing
   the wording without a hover.
4. Whether you made the action a real control or left it as prose naming the
   **Me** button, and why.
5. Anything that did not match. Handoffs from this planner have carried a wrong
   line number, a stale premise, an invented file reference, a dead CSS class
   quoted as live, a Tailwind trap, an unconditional status transition that would
   have lost inbound mail, and a mislabelled verdict. **Say so plainly.**
