# SLA Definitions (Current Implementation + Open Gaps)

Updated: 2026-02-09
Canonical planning/status source: `docs/unified-status-and-backlog-2026-02-09.md`.

## Implemented Today
1. **SLA policy model is implemented** per team and priority (`P1` to `P4`).
2. **Per-ticket SLA tracking is implemented** (`SlaInstance`) with:
   - first response due
   - resolution due
   - pause state
   - next due pointer
   - at-risk / breached timestamps
3. **Breach and at-risk worker is implemented** (interval scanner) with escalation notifications.
4. **Pause/resume behavior is implemented** for:
   - `WAITING_ON_REQUESTER`
   - `WAITING_ON_VENDOR`
5. **Reopen behavior is implemented** (`REOPENED`) with resolution SLA reset.

## SLA Types
- **First Response SLA**: time from ticket creation to first public agent response.
- **Resolution SLA**: time from ticket creation/reopen cycle to resolved/closed completion.

## Default Priority Targets
Defaults are used when a team has not overridden policy values.

| Priority | First Response | Resolution |
|---------|----------------|------------|
| P1      | 1 hour         | 4 hours    |
| P2      | 4 hours        | 24 hours   |
| P3      | 8 hours        | 72 hours   |
| P4      | 24 hours       | 168 hours  |

## Escalation Behavior (Implemented)
- Notify team leads when SLA is at risk or breached.
- Optional on-call email notifications (`SLA_ON_CALL_EMAIL(S)`).
- Optional priority bump on breach (`SLA_PRIORITY_BUMP_ENABLED`).

## Not Implemented Yet
1. **Business-hours/holiday calendars** for SLA time calculations.
2. **Team-specific timezone calendar engine** (working-time-aware due-date computation).
3. **Delayed-job SLA scheduling** (current approach is interval scan).

## Open Product/Operations Decisions
1. Final business-hours definitions per team and timezone.
2. Holiday calendar source and ownership.
3. Production escalation policy (who gets at-risk vs breach notifications by severity).
