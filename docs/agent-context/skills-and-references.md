# Skills and reference documents

## The `atm-*` skills

`.claude/skills/atm-system-architect/` and `.claude/skills/atm-qa-tester/` are
**bespoke** skills — never published to skills.sh. They hold the architecture
decision records (ADRs), project context and testing specs that the plans in
`prompts/` cite by number.

They were copied here on 2026-08-25 from
`C:\Users\PHulgur\Downloads\newticket\.claude\skills\`, which had in turn copied
them from `C:\Users\PHulgur\Downloads\AI Ticket Master\.claude\` (where they are
named `system-architect/` and `qa-tester/`, without the `atm-` prefix).

**Why they are here:** three committed plans in `prompts/` cite them —
`2026-08-24-quality-findings-remediation.md`,
`2026-08-25-ai-accuracy-harness.md` and
`2026-08-25-per-department-business-hours.md`. The last one is built entirely on
*ADR-008* ("Business hours calendar per department… Holiday and timezone
aware"). Before the copy, those citations pointed at nothing from this repo, so
a session working here could not read the reference it was told was binding.

⚠️ **`.claude/` is gitignored in this repo** (`.gitignore` line 24), so these
files are local-only and will not survive a fresh clone. If they go missing, copy
them again from either source folder above.

## What is *not* here, deliberately

`C:\Users\PHulgur\Downloads\newticket\AGENTS.md` is a large, detailed spec for
**AI Ticket Master** — a greenfield Next.js 16 / Azure SQL / MCP-server build of
the same product idea. **It does not govern this repo and was deliberately not
copied.** This repo is a different, existing implementation: NestJS + Prisma +
Vite, with its conventions in `.cursorrules`.

Copying that file in would create a second, contradictory set of instructions —
it mandates Next.js App Router, Aceternity UI, a 6-step AI pipeline behind an MCP
tool boundary, and row-level security, none of which describe this codebase.
Read it only if you are working in the `newticket` folder.

The same source folder also holds four skills nothing here references
(`fullstack-developer`, `senior-backend`, `senior-frontend`, `project-lead`) and
`Plan Docs/` with `AI_Ticket_Master_SRS_v2.docx` and
`AI_Ticket_Master_Project_Plan.docx` — the SRS and sprint plan the architect
skill says to cite by section. Those are `.docx` and have never been read.

## A known inconsistency in the architect reference

`atm-system-architect/references/project-context.md` lists the frontend as
"Next.js, TypeScript, Tailwind CSS, shadcn/ui". That describes the greenfield
project, not this one, and it omits Aceternity UI even for that project. Treat
the reference as authoritative for **decisions and ADRs**, and this repo's actual
code as authoritative for **what the stack is**.

(There is a second conflict recorded against the greenfield project — Next 16
renamed middleware to `proxy.ts` and its own docs warn against putting
authorization there, while that AGENTS.md mandates auth in middleware. It is
noted here only so it is not lost; it has no bearing on this repo, which has no
Next.js.)

## Reports and runbooks produced in this repo

| Document | What it is |
|---|---|
| [`docs/DEPLOYMENT.md`](../DEPLOYMENT.md) | **Deployment runbook.** Read before any deploy. |
| [`docs/security-audit-2026-08.md`](../security-audit-2026-08.md) | Dependency advisories separated into runtime vs build-time. Headline: 30 runtime → 7 after safe fixes, zero critical. Names live weaknesses — mind where it gets published. |
| [`docs/accessibility-audit-2026-08.md`](../accessibility-audit-2026-08.md) | WCAG 2.1 AA baseline for the four core flows, plus the manual pass. Carries a status update for what has since been fixed. |
| [`docs/azure-app-service-setup.md`](../azure-app-service-setup.md) | One-time infrastructure creation — a different job from deploying. |
| `prompts/*.md` | The implementation plans, newest last. |
