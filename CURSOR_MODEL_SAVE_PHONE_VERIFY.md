# CURSOR_MODEL_SAVE_PHONE_VERIFY

Concrete checks after deploy:

1. **Agency single save:** My Models → one model → at least one territory → **Save settings** → success; no RPC error in network tab.
2. **No 42703:** Response must not contain `column "phone" does not exist` / PostgreSQL code `42703` for `agency_update_model_full`.
3. **Territories / photos / visibility:** Same flow as before migration 20260430; territory step still succeeds; portfolio warning non-blocking; categories → visibility flags unchanged.
4. **No auth/admin/login/paywall regression:** Do not retest full matrix here — this change does not touch those paths. Spot-check admin login still works.
5. **Phone behaviour:** There is no `models.phone` storage; user phone for accounts remains on `profiles` via admin flows if applicable. No product data was persisted via `p_phone` before (no column).

**Live SQL (optional):** `pg_get_functiondef` for `agency_update_model_full` must not contain `phone = COALESCE` in the `UPDATE public.models` block.
