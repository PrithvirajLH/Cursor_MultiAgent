# Search performance against production — card 0.9

**Measured:** 2026-09-09, read-only, against `csh-ticketing-db.postgres.database.azure.com`.
**Script:** `apps/api/prod-search-timing.mjs` (re-runnable; no apply mode, no writes).
**Requirement:** sub-500 ms for ticket and knowledge-base search.

## Verdict, in one paragraph

**The requirement is met with two orders of magnitude of headroom, and the
measurement does not tell us the thing it was supposed to.** Every query lands
at 17–27 ms round-trip, against a 500 ms budget. But production holds **332
tickets, 22 messages and zero KB articles**, and at that size PostgreSQL
correctly ignores the six trigram GIN indexes and sequentially scans the table
instead. Server-side execution is **0.875 ms**; essentially all of the 21 ms is
network latency to Azure. So the numbers say the product is fast today, and say
nothing whatever about whether the indexes work — which is what the card wanted
to know. **No code changed, and no gate is worth building yet.** The reasoning
for that is below, because "we did not add a test" deserves an argument.

## The numbers

Fifteen iterations each, after one untimed warm-up call so the p50 is not paying
for a cold pooled connection. p50 and worst-of-N; averages hide the tail and the
tail is what people complain about.

| Query | p50 | worst | best | Budget |
|---|---|---|---|---|
| Ticket list, first page (no search) | 20.1 ms | 25.6 ms | 18.0 ms | ✅ 500 ms |
| Ticket search, text term (`%Termination%`, 333 matches) | 20.9 ms | 26.6 ms | 18.9 ms | ✅ |
| Knowledge-base search | 17.1 ms | 22.3 ms | 16.1 ms | ⚠️ see below |

**Production volumes at time of measurement:** 332 tickets (331 live), 22
messages, **0 KB articles**, 119 users.

⚠️ **The first term I measured with, `%password%`, matched nothing.** Timing a
query that returns zero rows measures the scan and not the result handling, so
the run was repeated with `%Termination%`, which matches 333 of the 332 live
rows (the filter also inspects `description` and `displayId`). The figures above
are the second run.

⚠️ **The KB row is not a real measurement.** `KbArticle` is empty in production,
so that query returns in 0.03 ms because there is nothing to look at. It is
reported for completeness and should not be read as evidence of anything.

## Which index the plan actually used: none

```
Ticket search:
  Limit  (cost=47.98..48.10 rows=50 width=45) (actual time=0.840..0.847 rows=50 loops=1)
    ->  Sort  (cost=47.98..48.76 rows=315 width=45)
          Sort Key: "updatedAt" DESC
          Sort Method: top-N heapsort  Memory: 30kB
          ->  Seq Scan on "Ticket"  (cost=0.00..37.51 rows=315 width=45)
                Filter: (("deletedAt" IS NULL) AND (((subject)::text ~~* '%Termination%')
                         OR (description ~~* '%Termination%')
                         OR ("displayId" ~~* '%Termination%')))
                Rows Removed by Filter: 1
  Planning Time: 1.034 ms
  Execution Time: 0.875 ms

KB search:
  Limit  (cost=0.00..11.05 rows=1 width=32) (actual time=0.007..0.008 rows=0 loops=1)
    ->  Seq Scan on "KbArticle"  (cost=0.00..11.05 rows=1 width=32)
  Planning Time: 0.217 ms
  Execution Time: 0.030 ms
```

**Both plans are sequential scans.** That is not a fault — reading 332 rows
costs less than consulting an index and then fetching them — but it means the
trigram indexes are carrying no load today and their behaviour under real volume
is **unverified**.

### The six indexes do exist

Worth stating separately, because the migration row is misleading. In production
`_prisma_migrations` marks `20260220150000_add_ticket_search_trigram_indexes` as
**rolled back**, which reads like the indexes are absent. They are not. The
catalogue is the honest answer:

```
KbArticle.KbArticle_content_trgm_idx      Ticket.Ticket_description_trgm_idx
KbArticle.KbArticle_summary_trgm_idx      Ticket.Ticket_displayId_trgm_idx
KbArticle.KbArticle_title_trgm_idx        Ticket.Ticket_subject_trgm_idx
```

All six present. Anyone auditing this from the migration table alone would reach
the wrong conclusion, which is why `prod-search-timing.mjs` queries `pg_indexes`
directly.

## Recommendation on a gate: don't build one

The card asks for a decision either way. Mine is **no**, for three reasons, and
I would rather state them than leave a silent gap:

1. **It would pass with the indexes dropped.** The plan is a sequential scan, so
   deleting all six trigram indexes right now would change these numbers by
   approximately nothing. A threshold test on this dataset cannot detect the
   regression it exists to detect — which is exactly the *"a test that passes
   with the bug present is not a test"* problem this repo keeps rediscovering
   (cards 1.45, 1.48, 1.49 all had a version of it).
2. **A duration assertion against a shared remote database is flaky by
   construction.** 18–27 ms here is dominated by network round-trip, not query
   cost, and a noisy neighbour or a pooler hiccup would fail a build for reasons
   nobody can act on. A flaky gate is worse than none: it gets skipped, and then
   it is not a gate.
3. **The measurement it would guard is not yet meaningful.** With 332 tickets
   and no KB articles, there is no performance signal to protect.

### What would change that answer

Two things, and it is worth writing them down now while the reasoning is fresh:

- **Volume.** The crossover where a GIN trigram index beats a sequential scan on
  `ILIKE '%term%'` is in the low tens of thousands of rows, not hundreds. Once
  production carries real traffic — the first onboarded team, per
  `docs/azure-env-inventory.md` — re-run `prod-search-timing.mjs` and read the
  plan. **When it stops saying `Seq Scan`, a gate starts being able to fail for
  a real reason.**
- **A cheaper gate that works today.** If something is wanted before then, assert
  the *plan*, not the *duration*: a test that runs `EXPLAIN` and fails when the
  six indexes are absent from `pg_indexes` would catch the actual regression this
  card is worried about — an unedited `prisma migrate dev` dropping them, which
  `repo-landmines.md` documents as a live hazard. That is deterministic, fast,
  and immune to network noise. It is not written here because the card scoped
  this to measurement, but it is the version I would build.

## Re-running this

```bash
cd apps/api && node prod-search-timing.mjs
```

Read-only: every statement is a `SELECT` or an `EXPLAIN` of one. `EXPLAIN
ANALYZE` does execute its query — that is how a real plan and a real timing are
obtained — but the query it executes is a `SELECT`. Requires `az` logged in; the
connection string is read from the App Service settings, never stored here.
