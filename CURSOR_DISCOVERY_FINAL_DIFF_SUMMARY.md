# CURSOR_DISCOVERY_FINAL_DIFF_SUMMARY.md

| Path | Change |
|------|--------|
| [`supabase/migrations/20260508_discovery_chest_coalesce_and_canonical_rpc.sql`](supabase/migrations/20260508_discovery_chest_coalesce_and_canonical_rpc.sql) | **New.** Canonical `get_discovery_models` + `COALESCE(m.chest, m.bust)` chest filters in `get_models_near_location` and `get_models_by_location`; grants, comments, post-migration asserts. |
| [`supabase/migration_client_model_interactions_v2.sql`](supabase/migration_client_model_interactions_v2.sql) | Chest filter lines aligned with migration (root reference drift reduction). |
| [`CURSOR_DISCOVERY_FINAL_REPORT.md`](CURSOR_DISCOVERY_FINAL_REPORT.md) | **New.** Full validation write-up. |
| [`CURSOR_DISCOVERY_FINAL_DIFF_SUMMARY.md`](CURSOR_DISCOVERY_FINAL_DIFF_SUMMARY.md) | **New.** This file. |
| [`CURSOR_DISCOVERY_FINAL_VERIFY.md`](CURSOR_DISCOVERY_FINAL_VERIFY.md) | **New.** Checklist + commands. |
| [`CURSOR_DISCOVERY_FINAL_PLAN.json`](CURSOR_DISCOVERY_FINAL_PLAN.json) | **New.** Structured summary. |

**Live DB:** Same SQL applied via Management API (`HTTP 201`).
