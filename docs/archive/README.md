# Archive — superseded documents

Everything in this folder describes an **earlier state** of the project and contradicts the code in
places. It is kept because the history is useful and greppable, not because anything here is guidance.
Moved here on 2026-08-26 during the restart clean-up.

**Do not plan from these files.** Current entry points: `CLAUDE.md` → `docs/agent-context/` →
`prompts/2026-08-26-restart-master-plan.md`. The code-verified review of 2026-08-26 ("Ticketing
Restart Review") explains, file by file, what each of these got wrong.

| File | Date | Why it is here |
|---|---|---|
| `gaps-and-roadmap.md` | early 2026 | Says realtime, idempotency, rate limiting, tags, business hours, correlation IDs and inbound email do not exist. All do. |
| `sprint-status.md` | 2026-02-09 | Marks inbound email, business hours and CI as pending; all shipped. |
| `slas.md` | 2026-02-09 | Says business-hours/holiday calendars are not implemented; they are, per team, since 2026-08-25. |
| `feature-comparison.md` | 2026-05-04 | Compares against the deleted `/tickets-revamp` prototype and marks linked tickets, merge, message edit/delete and forward as present — none exist in the API. |
| `zendesk-gap-implementation.md` | 2026-01-27 | Phased plan; most phases delivered. |
| `zendesk-gap-reduction.md` | 2026-02-06 | Phased plan; most phases delivered. |
| `unified-status-and-backlog-2026-02-09.md` | 2026-02-25 | Feb backlog; ATT-01, PERF-02, OBS-01 listed as pending have since shipped. |
| `next-sprint-backlog-2026-02-09.md` | 2026-02-09 | Feb backlog; superseded by the master plan. |
| `Backend-Engineer-Meeting-Report.html` | early 2026 | Meeting write-up; point in time. |
| `Tickets.txt` | 2026-03-10 | 29 fix tickets from the March hardening pass, all completed. |
| `test-suite-validation-report-2026-03-03.md` | 2026-03-03 | Test-suite state before the August baseline was established. |
| `frontend-interaction-latency-issues.md` | 2026-02 | Superseded by `update/performance-findings-2026-02-06.md` and master-plan card 0.9. |

Root-level files that were never in git (`ToDo Ticketing.docx`, `BUgs.txt`, `sprint.md`, generated
HTML/PDF exports) were moved out of the working tree on the same day; see `README-SUPERSEDED.md`.
