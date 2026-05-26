# Supabase SQL migrations — deploy & documentation

Canonical guide for applying files under `supabase/migrations/` to the **live** project `ispkfdqzjrfrilosoklu` (Index Casting).

Repo intent lives in git; **runtime truth** is whatever PostgreSQL actually runs. See also [LIVE_DB_DRIFT_GUARDRAIL.md](./LIVE_DB_DRIFT_GUARDRAIL.md).

---

## One command (required after every new migration)

From the project root:

```bash
bash scripts/supabase-push-verify-migration.sh \
  "supabase/migrations/YYYYMMDD_description.sql" \
  "SELECT ... AS verify_ok"
```

The script will:

1. **Deploy** SQL (Management API if token works, else **Supabase CLI `--linked`** fallback).
2. **Verify** with your query (same dual path).
3. **Record** `version` + `name` in `supabase_migrations.schema_migrations` (if missing).
4. **Append** a row to [SUPABASE_SQL_DEPLOY_LOG.md](./SUPABASE_SQL_DEPLOY_LOG.md).

Never merge a migration to `main` without running this (or equivalent documented steps) and updating the log.

---

## Auth paths (two connections)

| Path | Credential | Used for |
|------|------------|----------|
| **Management API** | `SUPABASE_ACCESS_TOKEN` in `.env.supabase` (Dashboard → Account → Access Tokens) | `POST …/v1/projects/ispkfdqzjrfrilosoklu/database/query` |
| **Supabase CLI linked** | `supabase login` + `supabase link --project-ref ispkfdqzjrfrilosoklu` | `npx supabase db query --linked` |

If the access token returns **401**, the deploy script **automatically falls back** to CLI. Fix the token when convenient — do not block deploys on it.

CLI link state: `supabase/.temp/linked-project.json` (ref `ispkfdqzjrfrilosoklu`).

### CLI 401 / “login role Unauthorized”

If `npx supabase db query --linked` fails:

```bash
npx supabase login
npx supabase link --project-ref ispkfdqzjrfrilosoklu
# optional if prompted:
export SUPABASE_DB_PASSWORD='…'   # Dashboard → Project Settings → Database
```

Then re-run `scripts/supabase-push-verify-migration.sh`.

---

## Verify queries (examples)

**New RPC / function change:**

```sql
SELECT pg_get_functiondef(p.oid) LIKE '%expected_snippet%'
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'my_function';
```

**New table:**

```sql
SELECT to_regclass('public.my_table') IS NOT NULL AS table_exists;
```

**Policy:**

```sql
SELECT count(*) FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'my_table' AND policyname = 'my_policy';
```

Prefer **object-specific** checks over `SELECT now()`.

---

## What does *not* deploy SQL

- **GitHub `deploy.yml` / Vercel** — frontend only.
- **`.github/workflows/supabase-edge-functions.yml`** — Edge Functions only; comment states SQL is not applied there.
- **Root `supabase/*.sql` outside `migrations/`** — legacy/diagnostic; not auto-deployed.

---

## Manual fallback

1. Supabase Dashboard → **SQL Editor** → paste migration file → Run.
2. Run verify query from the migration PR/commit notes.
3. Backfill history:

```bash
bash scripts/supabase-push-verify-migration.sh \
  "supabase/migrations/YYYYMMDD_description.sql" \
  "SELECT …" \
  --record-only
```

(`--record-only` skips SQL deploy; records log + `schema_migrations` if deploy was done manually.)

---

## Agent / Cursor rule

`.cursor/rules/supabase-auto-deploy.mdc` points here. After each new `supabase/migrations/*.sql` file: run the script, confirm log entry, report verify result.

---

## Related

- [SUPABASE_SQL_DEPLOY_LOG.md](./SUPABASE_SQL_DEPLOY_LOG.md) — append-only deploy audit trail
- [EDGE_FUNCTION_DEPLOY_VERIFY.md](./EDGE_FUNCTION_DEPLOY_VERIFY.md) — Edge Functions (separate)
- [DATA_RETENTION_POLICY.md](./DATA_RETENTION_POLICY.md) / [GDPR_DELETE_FLOW.md](./GDPR_DELETE_FLOW.md) — deletion RPCs (`20260524_…`)
