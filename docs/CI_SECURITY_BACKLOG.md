# CI / security backlog (not in default PR pipeline)

The main workflow intentionally keeps PR feedback fast. The following are **candidates** for separate jobs or schedules:

| Item | Suggestion |
|------|------------|
| **npm audit** | Dedicated workflow or Dependabot; `npm audit` has noise; consider `--audit-level=high` with triage. |
| **E2E (Playwright)** | `workflow_dispatch`, nightly, or optional label-triggered job; needs app URL + test credentials / secrets. |
| **RLS / live DB checks** | Run watchlist SQL (e.g. `pg_policies`, FOR ALL on watchlist tables) only when `SUPABASE_ACCESS_TOKEN` (or branch DB URL) is configured; otherwise skip with a clear log line. |
| **Supply chain** | OSV / SCA tool integration if product requires it beyond npm audit. |

See also `docs/CI_AUDIT_AND_BASELINE.md` for what **is** enforced on every PR to `main`.
