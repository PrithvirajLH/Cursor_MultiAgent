# Superseded planning files

Older planning documents that describe an earlier state of the project and contradict the code live
in **`docs/archive/`** (see its README for a file-by-file explanation). They are history, not guidance.

Three root-level files that were **never tracked in git** (all gitignored, so they exist only on the
original development machine) are stale and are slated for removal from the working tree; deleting
them changes nothing in the repository:

| File | Why it was stale |
|---|---|
| `ToDo Ticketing.docx` | Said the SLA engine, reports, inbound email and attachments did not exist. All do. |
| `BUgs.txt` | 142-issue audit later found inflated; `BUGS_VERIFIED.md` (still at the root, gitignored) is the corrected view. |
| `sprint.md` | January 2026 sprint plan. |

The generated exports `CSH_User_Manual.html`, `SQL_Migration_Guide.html` and `SQL_Migration_Guide.pdf`
(also gitignored) are disposable; their sources `USER_MANUAL.md` and `DATABASE.md` remain.

Current entry points: `CLAUDE.md` → `docs/agent-context/` → `prompts/2026-08-26-restart-master-plan.md`.
