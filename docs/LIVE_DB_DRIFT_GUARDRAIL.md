# Live DB & Root-SQL Drift — Guardrail

This document is the **project-level** companion to `.cursor/rules/system-invariants.mdc` (LIVE-DB SOURCE OF TRUTH). It exists so humans and tools share one concise mental model.

## What is deploy truth?

- **`supabase/migrations/*.sql`** — Only these files are meant to be applied by the Supabase migration pipeline to reach the expected remote schema. Treat them as the **authoritative definition of intent** in the repo.
- **Live PostgreSQL** — After deploy, the **actual** behavior is whatever ran last on the database. If a migration was skipped, failed, or was edited after apply, **production wins** over any file in git.
- **`supabase/*.sql` outside `migrations/`** — Legacy archive, one-off scripts, diagnostics, and historical snapshots. They are **not** automatically deployed. They are **not** a reliable picture of production by themselves.

## On conflict between Root-SQL and migrations

If the same function or policy name appears in both a root `supabase/foo.sql` and `supabase/migrations/YYYYMMDD_*.sql`:

- **Do not assume** the root file matches production.
- **Do assume** you need either a **new migration** (if the change is not yet live) or **live verification** (if you need to know what is actually running).

## After every security-relevant SQL change to an existing routine

When you change `SECURITY DEFINER` logic, storage helpers, RLS-adjacent functions, or any function that enforces tenancy:

1. Ship the change **only** via a new dated file under `supabase/migrations/`.
2. On the **live** database, verify with `pg_get_functiondef(oid)` (or equivalent) for the affected routine. For catalog scans over `pg_proc`, restrict to normal functions (`prokind = 'f'`), not aggregates.
3. Search the function body for **legacy column names**, removed branches, or forbidden patterns referenced in project rules (e.g. old guard columns).

This closes the gap between “merged to main” and “running in production.”

## Root-SQL hygiene (no mass deletes)

- **Do not** bulk-delete root SQL files as “cleanup”; history and grep context matter.
- **Do not** add **new** `CREATE FUNCTION`, `CREATE POLICY`, or other deployable definitions under `supabase/` **outside** `migrations/` unless the file is clearly marked at the top as **non-deployed diagnostic / scratch** and is not a substitute for a migration.

Example header for a diagnostic-only file:

```sql
-- DIAGNOSTIC ONLY — NOT A MIGRATION — DO NOT RELY ON THIS FOR PRODUCTION STATE
-- For real changes, add supabase/migrations/YYYYMMDD_description.sql
```

## Related

- `.cursor/rules/system-invariants.mdc` — MIGRATIONS-DEPLOYMENT, LIVE-DB SOURCE OF TRUTH
- `.cursor/rules/rls-security-patterns.mdc` — SQL source of truth note
- `.cursor/rules/supabase-auto-deploy.mdc` — project deploy workflow (when enabled)

## Example: `calendar_entries` RLS (canonical migration)

All `public.calendar_entries` policies (SELECT scoped, agency write/update/delete, model self, **client scoped UPDATE** for `booking_details` / Booking Brief) are defined in **`supabase/migrations/20260502_calendar_entries_rls_canonical_client_update.sql`**. Do not reintroduce deploy-only root-SQL as the sole source for this table; extend behavior only via new dated migrations after live verification.
