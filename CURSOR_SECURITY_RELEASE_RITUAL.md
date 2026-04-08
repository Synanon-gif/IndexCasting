# Security release ritual (compact)

Reusable steps for small hardening waves (SECDEF, storage, upload parity). Pair with [docs/SECURITY_RELEASE_TEMPLATE.md](docs/SECURITY_RELEASE_TEMPLATE.md).

## Before merge

1. **Local CI:** `npm run typecheck && npm run lint && npm test -- --passWithNoTests --ci`
2. **SQL:** New DDL only in `supabase/migrations/YYYYMMDD_*.sql`; no reliance on root `supabase/*.sql` as production truth
3. **Touch list:** Confirm do-not-touch list (AuthContext, App, admin/login RPCs) is respected
4. **Diff review:** For SECDEF changes — internal guards + caller scope; no broad SELECT without verified parameters

## After deploy (live)

1. **Function drift:** `SELECT pg_get_functiondef(oid)` for each changed routine; grep body for legacy columns / forbidden patterns
2. **Optional catalog:** `proconfig` includes `row_security=off` when the function reads RLS-protected tables under SECDEF (if that was the intent of the change)
3. **Policy spot-checks** (if RLS/storage changed): see `.cursor/rules/auto-review.mdc` §2b queries

## Login matrix (manual smoke)

| Role | Check |
|------|--------|
| Admin | Login → admin dashboard |
| Agency | Login → agency context loads |
| Client | Login → client context loads |
| Model | Login → model profile |

Failure with `42P17` on `profiles` / `models` / storage path → stop and treat as RLS recursion regression.

## SQL verification snippets

```sql
-- Example: confirm SECDEF + row_security on a function by name
SELECT proname, prosecdef, proconfig::text
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'your_function_name';
```

```sql
-- Example: function body (normal functions only, prokind = 'f')
SELECT pg_get_functiondef(p.oid)
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'your_function_name' AND p.prokind = 'f';
```
