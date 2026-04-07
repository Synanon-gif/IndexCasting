# Full-Stack Consistency Audit — 2026-04-07

## Live database (project `ispkfdqzjrfrilosoklu`)

| Check | Result |
|--------|--------|
| `FOR ALL` on watchlist tables (`model_embeddings`, `model_locations`, `model_agency_territories`, `calendar_entries`, `model_minor_consent`) | **0 rows** |
| Policies with `profiles.is_admin = true` in `qual` | **0 rows** |
| `model_agency_territories` policies with `self_mat` / `FROM public.model_agency_territories` self-join | **0 rows** |
| `add_model_to_project` `proconfig` after fix | **`search_path=public, row_security=off`** |

## SECURITY DEFINER inventory

- Many `public` SECURITY DEFINER functions omit `row_security=off` in `proconfig` (~110). This is **not** automatically a defect: triggers, narrow helpers, and admin RPCs that call `assert_is_admin()` first use different risk profiles.
- **Hardened in this audit:** `add_model_to_project` — reads `organization_members`, `client_projects`, `models`, `client_agency_connections` under caller context; **`SET row_security TO off`** added via migration `20260421_add_model_to_project_row_security_off.sql` (internal guards unchanged).

## Edge Function `send-invite`

- **Change:** Optional body field `organization_id`. If present and valid UUID, membership must match a row from `get_my_org_context()`; otherwise **403** `not_member_of_organization`.
- If omitted and the user has multiple orgs, behaviour remains oldest-first with a **server warning**; clients updated to pass `organization_id` where the active org is known (`ClientOrganizationTeamSection`, `AgencyControllerView` org + model claim).
- **Deployed** to production Supabase project.

## Frontend state sync (`refreshProfile`)

| Flow | Refresh behaviour |
|------|---------------------|
| Dissolve organization (`ClientWebApp`, `AgencyControllerView`) | `void refreshProfile()` after success (already present) |
| Account deletion / personal deletion | `signOut()` immediately — no profile refresh needed |
| Invite accept / model claim (`AuthContext` sign-in/sign-up) | `loadProfile` in auth flow (already present) |
| Cancel deletion | Not wired in UI; when added, call `refreshProfile()` after successful RPC |

## Optimistic updates (spot check)

- **Documented exception:** `addModelToProject` in `ClientWebApp` uses snapshot rollback per `system-invariants.mdc` / `.cursorrules` — do not refactor to inverse-op without product review.
- Other flows: follow inverse-operation rollback + locks per project rules.

## Follow-ups (non-blocking)

- Periodically re-run `pg_policies` / SECDEF queries after migrations.
- Reduce legacy `supabase/*.sql` noise by relying on `supabase/migrations/` as canonical (see `SUPABASE_LEGACY_SQL_INVENTORY.md`).
