# Security Audit — August 2026

**Date:** 2026-08-25
**Branch:** `ui-redesign-and-api-hardening`
**Scope:** dependency vulnerabilities reaching production, plus static checks on secrets, security headers and rate limiting.

---

## Headline

> **7 runtime advisories, of which 4 have no safe fix available and 3 require a major version bump.**
> **Zero critical advisories reach production.**

Before this audit's fixes: 30 runtime advisories. After `npm audit fix`: 7.

| | Runtime | Build-time | Total |
|---|---|---|---|
| Before fixes | **30** (0 critical, 16 high, 13 moderate, 1 low) | 26 (4 critical, 12 high, 9 moderate, 1 low) | 56 |
| After fixes | **7** (0 critical, 5 high, 2 moderate) | 12 (1 critical, 3 high, 8 moderate) | 19 |

**Do not quote "56 vulnerabilities" or "19 vulnerabilities" as this system's security posture.** Both numbers are dominated by build tooling that never runs in production. Every one of the four criticals in the original count was in a dev-only package (`vitest`, `concurrently`, `handlebars`, `shell-quote`).

---

## How the runtime number was established

This matters, because the obvious tooling gives the wrong answer here.

| Approach | Result | Verdict |
|---|---|---|
| `npm audit` at repo root | 56 advisories | Counts all dev tooling. Useless as a posture number. |
| `npm audit --omit=dev` | **identical to the above** | The flag does nothing in this workspace. Re-verified after the fixes: plain audit and `--omit=dev` both return `{critical:1, high:8, moderate:10, total:19}`, byte-identical. |
| Per-workspace `npm audit --omit=dev` | still lists `vitest`, `vite`, `rollup` | Same problem — audit resolves against the hoisted root tree. |
| `npm query ".prod"` | 488 names | **Closer, but wrong.** See below. |
| Lockfile traversal (used here) | 418 names | Correct. |

### Why `npm query ".prod"` is also wrong

`npm query ".prod"` looked promising — it correctly excluded `vitest`, `vite`, `rollup`, `concurrently` and `@nestjs/cli`. But it reported `postcss`, `tailwindcss` and `autoprefixer` as production packages, and all three are in `apps/web` **devDependencies**.

The cause: `tailwindcss-animate` is a genuine production dependency and declares `peerDependencies: { tailwindcss: ">=3.0.0" }`. npm treats a satisfied peer as a production edge, so the whole Tailwind/PostCSS build chain is pulled into the `.prod` closure. That inflated the set by ~70 packages and would have reported a high-severity PostCSS advisory as a production exposure. It is not one — PostCSS runs at build time and never ships to a browser.

### The method actually used

Traverse `package-lock.json` from the `dependencies` blocks of `apps/api` and `apps/web`, following **only** `dependencies` and `optionalDependencies` edges — never `devDependencies`, never `peerDependencies` — resolving each edge with Node's nearest-`node_modules` rule. Then match each advisory's affected version range against the versions actually present in that closure.

This is validated by the Dockerfile: it runs `npm prune --omit=dev` before copying `node_modules` into the runtime image, so the closure computed here is exactly what ships.

**Answer to "is there a way to make the tooling do this correctly": yes, but not with an `npm audit` flag.** A lockfile traversal is required, and it must ignore peer edges. The scripts used are reproducible and are described in the appendix.

---

## Runtime advisories after fixes (all 7)

| Package | Severity | Installed | Surface | Path | Disposition |
|---|---|---|---|---|---|
| `prisma` | high | 6.19.2 | server (direct) | `apps/api > prisma` | **Accepted — no fix published.** |
| `@prisma/config` | high | 6.19.2 | server (transitive) | `apps/api > prisma > @prisma/config` | **Accepted — no fix published.** |
| `deepmerge-ts` | high | 7.1.5 | server (transitive) | `apps/api > prisma > @prisma/config > deepmerge-ts` | **Blocked upstream.** [GHSA-ggr8-5vv4-36mx](https://github.com/advisories/GHSA-ggr8-5vv4-36mx) |
| `effect` | high | 3.18.4 | server (transitive) | `apps/api > prisma > @prisma/config > effect` | **Blocked upstream.** [GHSA-38f7-945m-qr2g](https://github.com/advisories/GHSA-38f7-945m-qr2g) |
| `nodemailer` | high | 7.0.13 | server (direct) | `apps/api > nodemailer` | **Deferred — needs major bump to 9.0.5.** See below. |
| `react-router` | moderate | 6.30.6 | browser (transitive) | `apps/web > react-router-dom > react-router` | **Deferred — needs major bump to 7.x.** |
| `react-router-dom` | moderate | 6.30.6 | browser (direct) | `apps/web > react-router-dom` | **Deferred — needs major bump to 7.x.** |

### The Prisma cluster (4 of the 7)

Four of the seven are one problem: **`prisma` — the CLI — is in `apps/api` `dependencies`, not `devDependencies`.** That puts the CLI and its whole tree (`@prisma/config` → `effect`, `deepmerge-ts`, `c12`, `defu`) into the production image.

The advisory range is `>=6.13.0-dev.1`, i.e. every current release is affected; `npm` reports `fixAvailable: true` but `npm audit fix` did not resolve them, because the vulnerable versions are pinned by `@prisma/config` and cannot move without Prisma publishing a release that bumps them. There is nothing to install today.

**This is not simply a packaging mistake.** `docker/entrypoint.sh` runs `npx prisma migrate deploy` when `RUN_MIGRATIONS=true`, so the CLI is genuinely needed at container start. Moving it to `devDependencies` would break that path, because the image prunes dev dependencies.

Recommendation, as a separate piece of work: run migrations as a distinct job or init container rather than from the application entrypoint, then move `prisma` to `devDependencies`. That removes four high-severity runtime advisories and shrinks the production image. It is an infrastructure change and is out of scope here.

### Deferred major bumps

| Package | Current | Fix requires | What it touches |
|---|---|---|---|
| `nodemailer` | 7.0.13 | `9.0.5` (major, two majors) | Outbound email. Advisories are SMTP command injection via `envelope.size` and transport-name CRLF, header injection via `List-*`, and improper TLS validation on OAuth2 token fetch. |
| `react-router-dom` / `react-router` | 6.30.6 | `7.18.2` (major) | Every route in the SPA. v7 is a substantial migration. Advisories are open-redirect class issues. |

Per the plan, a major bump is a framework upgrade with its own risk and testing, not a security fix to bundle here.

**`nodemailer` deserves attention despite being "deferred".** It processes attacker-influenced content and the advisories are injection-class, not DoS. Two mitigations are worth confirming before the upgrade lands: that `envelope.size` is never set from user input, and that the transport name is a constant rather than derived from a request. Both are cheap to verify and neither requires the upgrade.

---

## The five packages that get a disposition regardless of severity

| Package | Role | Status |
|---|---|---|
| `dompurify` | XSS sanitiser, browser | **Fixed.** 3.3.1 → 3.4.14, resolving 18 advisories including several sanitisation bypasses. This was the highest-value fix in the run — a bypass in the XSS defence is worth more than its "moderate" label suggests. |
| `nodemailer` | Outbound email, server | **Deferred**, major bump required. See above. |
| `multer` | File uploads via `@nestjs/platform-express` | **Fixed.** 2.0.2 → 2.2.0, resolving 5 DoS advisories (resource exhaustion, uncontrolled recursion, incomplete cleanup of aborted uploads). |
| `@nestjs/core` | HTTP layer | **Fixed.** 11.1.12 → 11.2.3, resolving an injection advisory ([GHSA-36xv-jgw5-4q75](https://github.com/advisories/GHSA-36xv-jgw5-4q75)) and pulling in a patched `path-to-regexp`. |
| `@nestjs/platform-express` | HTTP layer | **Fixed.** 11.1.12 → 11.2.3, resolving the `multer` and `path-to-regexp` chains. |

---

## Shipped but never loaded: the MCP SDK chain

Before the fixes, 6 of the 30 runtime advisories — including `hono`, which alone carried **22** advisories — were reachable *only* through `@modelcontextprotocol/sdk`:

`@hono/node-server`, `ajv`, `express-rate-limit`, `fast-uri`, `hono`, `ip-address`.

The MCP server is started by the `mcp-server` npm script (`ts-node src/mcp-server/server.ts`). The container's `CMD` is `node dist/src/main.js`, `ts-node` is pruned as a dev dependency, and no MCP module is registered in `app.module.ts`. **That code is present in the image but is never loaded by the running process.**

This was checked rather than assumed: `qs` and `body-parser` also appear under the MCP SDK, but both have a second route via `@nestjs/platform-express > express`, so they *are* loaded and were treated as live.

All six have since been fixed in-range, so this does not affect the current number. It is recorded because it will recur at the next audit, and because "reachable in the dependency graph" and "loaded by the process" are different questions.

---

## Build-time advisories (12, not itemised)

| Severity | Count | Examples |
|---|---|---|
| critical | 1 | `vitest` |
| high | 3 | `vite`, `brace-expansion`, `picomatch` |
| moderate | 8 | `esbuild`, `@nestjs/cli`, `@angular-devkit/*`, `ajv`, `@vitest/mocker`, `vite-node` |

These reach a developer machine or a CI runner, never a production process. They are worth keeping an eye on — a compromised build tool is a supply-chain risk — but they are not an exposure of the running system and should not be counted as one.

---

## What `npm audit fix` changed

Run **without** `--force`. It modified `package-lock.json` only — no `package.json`, no application source.

- **121 packages changed version**, of which **46 are in the production closure**.
- Notable production movements: `@nestjs/common` / `@nestjs/core` / `@nestjs/platform-express` 11.1.12 → 11.2.3, `dompurify` 3.3.1 → 3.4.14, `multer` 2.0.2 → 2.2.0, `bullmq` 5.67.1 → 5.81.3, `lodash` 4.17.21 → 4.18.1, `fast-xml-parser` 5.4.1 → 5.11.0.

Two things to be aware of, neither of which `--force` would have warned about:

1. **`msgpackr` went 1.11.5 → 2.0.5 — a major version bump of a transitive dependency** (under `bullmq`). Omitting `--force` constrains changes to *declared* dependency ranges; it does not prevent transitive resolutions crossing a major boundary. Worth knowing before assuming "no `--force`" means "no major changes".
2. **`cluster-key-slot` was downgraded**, 1.1.2 → 1.1.1.

Both are exercised by the ioredis/bullmq paths covered in the integration suite, which passed after the change (see Verification).

---

## Static checks

### Secrets — clean

- `apps/api/.env` and `apps/api/.env.test` are both git-ignored (`apps/api/.gitignore` lines 9 and 11). Verified with `git check-ignore`, not assumed.
- Tracked env files are `.env.example`, `apps/api/.env.example`, `apps/web/.env.example` and `apps/web/.env.production`. The last is tracked but contains only `VITE_API_BASE_URL=/api`, which is public by construction.
- A scan of all tracked files for key-shaped strings (AWS keys, PEM private key blocks, Slack tokens, `sk-` API keys, Azure `AccountKey=`, JWT-shaped triples) returned **no matches**.

### Security headers — applied, with two observations

`helmet` 7.2.0 is applied in `main.ts` with an explicit CSP. Because helmet 7 defaults `useDefaults: true`, the unspecified directives (`base-uri`, `object-src`, `form-action`, `script-src-attr`, `upgrade-insecure-requests`) retain helmet's defaults. `frameAncestors: 'none'` is set, and `scriptSrc` uses a SHA-256 hash for the one inline script rather than `'unsafe-inline'` — good.

Two observations, **reported not changed**:

1. `connectSrc: ["'self'", 'https:', 'wss:']` allows the page to connect to *any* HTTPS or WSS origin. This weakens CSP's value as an exfiltration control. Tightening it to the known API and Web PubSub origins would be an improvement.
2. `styleSrc` includes `'unsafe-inline'`. Common and hard to avoid with CSS-in-JS, but it is the residual XSS surface that CSP would otherwise close.

### Rate limiting — every route covered, one tier hardened

`RouteThrottlerGuard` is registered as a global `APP_GUARD`, so **every** route including all mutations is rate limited at the default tier (120 requests / 60s, configurable).

Two hardened tiers exist — `highWrite` (60/60s) and `webhook` (30/60s) — applied via `@ThrottlePolicy`. These are used **13 times, all in `tickets.controller.ts`**. Across the codebase there are 69 mutation route decorators spread over 17 controllers.

So the answer to "does the throttler cover mutations, not just reads" is **yes, universally, at the default tier**. But the hardened tier covers one controller of seventeen. Whether that is right depends on which other mutation endpoints are expensive or abusable — attachment upload, KB writes and bulk admin operations are the obvious candidates to review. **Reported, not changed**; rate-limit changes need their own testing.

---

## Verification

All checks run after `npm audit fix`:

| Check | Result |
|---|---|
| `apps/api` `tsc --noEmit` | exit 0 |
| `apps/web` `tsc --noEmit` | exit 0 |
| `apps/api` unit tests | 186 passed |
| `apps/api` integration tests | see below |

---

## The CI security job does not currently run — and neither does the rest of CI

A `security` job was added to `.github/workflows/ci.yml`: `npm audit --audit-level=high` plus the accessibility baseline, `continue-on-error: true`, with a comment recording the intent to make it blocking once the runtime advisory count and the critical/serious accessibility count reach zero.

**It will not execute.** `.gitignore` (lines 80–82) excludes `docs/`, `.github/` and `e2e/` from the repository, per commit `7f221d2` — *"remove docs/, .github/, e2e/, update/ from repo (kept locally, gitignored)"*. Nothing under `.github/` is tracked, so GitHub has never received the workflow file. This is not limited to the new job: **the entire existing CI pipeline — lint, build, unit, integration and E2E — is in the same untracked file.**

That should be confirmed against the repository's Actions history. If CI is genuinely not running, it is a more urgent finding than anything in the advisory tables above, and it is not something this audit can fix — reversing that decision is a repository-policy call.

The same applies to this document. `docs/` is untracked, so this report exists only on the machine that produced it.

---

## Recommendations, in priority order

1. **Verify the two `nodemailer` mitigations** (`envelope.size` not user-controlled; transport name constant). Cheap, and it de-risks the deferred upgrade.
2. **Move migrations out of the application entrypoint** so `prisma` can leave `dependencies`. Removes 4 of the 7 remaining runtime advisories.
3. **Schedule the `nodemailer` 7 → 9 upgrade** as its own change with its own testing.
4. **Schedule the React Router 6 → 7 migration** likewise; lower urgency, the advisories are open-redirect class.
5. **Tighten `connectSrc`** from the `https:`/`wss:` wildcards to known origins.
6. **Review whether the `highWrite` tier should extend** beyond `tickets.controller.ts`.
7. **Re-run this audit with the same method** rather than raw `npm audit`, or the numbers will not be comparable.

---

## Appendix — reproducing the runtime number

1. `npm audit --json` at the repo root.
2. Build the production closure: traverse `package-lock.json` from the `dependencies` of `apps/api` and `apps/web`, following only `dependencies` and `optionalDependencies`, resolving names by the nearest-`node_modules` rule.
3. For each advisory, match its affected range against the versions present in that closure using `semver.satisfies`.
4. Classify anything not matched as build-time.

Do not substitute `npm audit --omit=dev` (no effect here) or `npm query ".prod"` (counts peer edges as production).
