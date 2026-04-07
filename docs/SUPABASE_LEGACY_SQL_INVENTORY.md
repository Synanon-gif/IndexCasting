# Supabase SQL file inventory (2026-04-07)

Counts from repository (not deduplicated by content):

| Location | `.sql` files |
|----------|----------------|
| `supabase/migrations/` | 66 (canonical for `supabase db push` / tracked history) |
| `supabase/` root (maxdepth 1, excluding subdirs) | 225 |
| **All** `supabase/**/*.sql` | 292 |

## Interpretation

- **Production schema changes** must ship as new files under [`supabase/migrations/`](../supabase/migrations/) with a `YYYYMMDD_` prefix (project policy).
- Files in `supabase/` **outside** `migrations/` are **legacy references**, one-off scripts, or historical snapshots (e.g. [`schema.sql`](../supabase/schema.sql)). They are **not** applied automatically by the CLI migration pipeline.
- [`supabase/MIGRATION_ORDER.md`](../supabase/MIGRATION_ORDER.md) describes a **manual** ordering for greenfield installs; live Supabase is driven by applied migrations + API pushes.

## Maintenance

- Prefer **new migrations** over editing root SQL.
- When a root file is still referenced in docs, add a comment at the top pointing to the superseding migration.
