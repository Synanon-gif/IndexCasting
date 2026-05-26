# Supabase SQL deploy log

Append-only audit trail for **live** applies of `supabase/migrations/*.sql`.  
Updated automatically by `scripts/supabase-push-verify-migration.sh` (or manually when using `--record-only`).

| Column | Meaning |
|--------|---------|
| **Migration** | File under `supabase/migrations/` |
| **Deployed (UTC)** | When SQL was applied to live |
| **Method** | `management_api`, `cli_linked`, or `manual+record-only` |
| **Verify** | Short description or SQL snippet result |
| **schema_migrations** | `version` recorded in `supabase_migrations.schema_migrations` |

---

## Entries

| Migration | Deployed (UTC) | Method | Verify | schema_migrations |
|-----------|----------------|--------|--------|-------------------|
| `20260524_fix_account_deletion_purge_eligibility.sql` | 2026-05-24 (CLI deploy); log + `schema_migrations` finalized 2026-05-24 | `cli_linked` | Deletion RPCs: `is_active=false` on request, `is_active=true` on cancel | `20260524` ✅ |

**Note:** Deploy used CLI because Management API token in `.env.supabase` returned HTTP 401. Use `bash scripts/supabase-push-verify-migration.sh` for all future migrations (auto-fallback + log + `schema_migrations`).
