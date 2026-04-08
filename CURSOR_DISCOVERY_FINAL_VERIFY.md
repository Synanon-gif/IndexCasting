# CURSOR_DISCOVERY_FINAL_VERIFY.md

## Migration deploy

- [x] `source .env.supabase` + POST `…/database/query` with full migration file → **HTTP 201**
- [x] Live verification query: `position('COALESCE(m.chest, m.bust)' in pg_get_functiondef(oid))` for:
  - [x] `get_discovery_models` — non-zero
  - [x] `get_models_near_location` — non-zero
  - [x] `get_models_by_location` — non-zero

## Example verification SQL (read-only)

```sql
SELECT p.proname,
       position('COALESCE(m.chest, m.bust)' IN pg_get_functiondef(p.oid)) > 0 AS has_chest_coalesce
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('get_discovery_models', 'get_models_near_location', 'get_models_by_location')
  AND p.prokind = 'f';
```

## Local quality gate

```bash
cd /Users/rubenjohanneselge/Desktop/Final_IndexC/IndexCasting && npm run typecheck && npm run lint && npm test -- --passWithNoTests --ci
```

- [x] Record exit status in commit / team channel (all must be 0).

## Not touched (per plan)

- AuthContext, bootstrapThenLoadProfile, get_my_org_context  
- Admin-RPCs, Paywall core, Invite/Claim  
- `calendar_entries` RLS, booking_brief trust model  

---

**DISCOVERY FINAL HARDENING + FIXES APPLIED**
