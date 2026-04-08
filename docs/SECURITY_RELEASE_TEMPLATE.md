# Security / Hardening Release — Template

Use this checklist for any change touching **Supabase SQL** (especially `SECURITY DEFINER`), **storage policies**, or **upload-hardened services**. Copy the section into the PR description or a one-off release note.

## 1. Scope

- **What changed:** (one short paragraph: feature, fix, or hardening wave)
- **Tracking:** issue / ticket ID (optional)

## 2. Explicitly NOT changed (safety boundary)

Confirm that this release does **not** modify unless the task explicitly requires it:

- `src/context/AuthContext.tsx`, `App.tsx`
- `signIn`, `bootstrapThenLoadProfile`, `loadProfile`
- `get_own_admin_flags`, `is_current_user_admin`, `assert_is_admin`, `get_my_org_context`
- Admin routing, invite/claim/guest core navigation
- Blanket edits to all `SECURITY DEFINER` functions or mass RLS rewrites

## 3. Affected surfaces

| Area | Details |
|------|---------|
| SQL functions / migrations | List `public.*` routines or `supabase/migrations/YYYYMMDD_*.sql` files |
| Policies (RLS / storage) | Table/bucket names |
| Upload / storage clients | `src/services/*` paths using `storage.upload` or new validation |

## 4. Mandatory checks before merge

- [ ] `npm run typecheck`
- [ ] `npm run lint`
- [ ] `npm test -- --passWithNoTests --ci`
- [ ] If SQL changed: migration exists only under `supabase/migrations/` (not deploy-truth in root `supabase/*.sql` alone)
- [ ] If SQL changed: **live DB verification** after apply — see [LIVE_DB_DRIFT_GUARDRAIL.md](./LIVE_DB_DRIFT_GUARDRAIL.md) (`pg_get_functiondef` for edited routines; policy spot-checks from `.cursor/rules/auto-review.mdc` §2b where relevant)

## 5. Mandatory checks after deploy

- [ ] Targeted SQL: e.g. `proconfig` contains `row_security=off` for edited SECDEF helpers (if applicable)
- [ ] **Login matrix (smoke):** Admin, Agency, Client, Model — sign-in succeeds; no `42P17` on `profiles`
- [ ] Feature smoke for the touched area (e.g. storage listing RPC, upload path, option/booking flow)

## 6. Drift guardrail

After changing an existing `public` function: compare **live** definition to repo intent — not only the file diff. See **LIVE-DB SOURCE OF TRUTH** in `.cursor/rules/system-invariants.mdc` and [LIVE_DB_DRIFT_GUARDRAIL.md](./LIVE_DB_DRIFT_GUARDRAIL.md).

## 7. Rollback note

How to revert (migration down / follow-up migration / feature flag) — one sentence minimum.
