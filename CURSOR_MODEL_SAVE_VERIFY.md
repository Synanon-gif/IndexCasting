# Model save incident — verification

## Automated

```bash
cd /Users/rubenjohanneselge/Desktop/Final_IndexC/IndexCasting && \
npm run typecheck && npm run lint && npm test -- --passWithNoTests --ci
```

## Live DB (already executed after deploy)

- Migration push: **HTTP 201** for `20260429_agency_update_model_full_model_scoped_guard.sql`.
- `SELECT pg_get_functiondef(...) ILIKE '%v_model_agency_id%'` → **true**.

## Manual (Agency)

1. **Single save:** Open a model in My Models, set territories, change profile fields, **Save settings** — expect success banner; no 400 on `agency_update_model_full` in network tab.
2. **Bulk (territories only):** Select multiple models → **Assign Territories** — still works; no bulk current location (removed by product rule). See [CURSOR_BULK_LOCATION_REMOVAL_VERIFY.md](CURSOR_BULK_LOCATION_REMOVAL_VERIFY.md) and [docs/MODEL_SAVE_LOCATION_CONSISTENCY.md](docs/MODEL_SAVE_LOCATION_CONSISTENCY.md).
3. **Completeness banner:** Model without visible portfolio still shows warning; save can still succeed (by design).
4. **Import / sync:** Run one Mediaslide or import merge on a test model — profile update RPC should succeed when user is member of that model’s agency.
5. **Admin:** Sign in as admin — login and dashboard unchanged (no Auth edits).

## Regression guard

- No edits to `AuthContext`, `App.tsx`, `get_my_org_context`, paywall ordering, or `assert_is_admin` / `get_own_admin_flags` definitions.
