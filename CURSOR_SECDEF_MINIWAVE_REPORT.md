# SECDEF Mini-Wave Report — IndexCasting

## Executive summary

- **Live DB scan:** Many `public` functions are `SECURITY DEFINER` with `proconfig` containing only `search_path` (no `row_security=off`). A blanket campaign to add `row_security=off` everywhere is **out of scope** and risky without per-function guard review (Rule 21 / Risiko 4).
- **Applied fix:** One focused migration added `SET row_security TO off` to **two** storage-path listing RPCs that already had explicit caller guards and no admin/login coupling: `get_chat_thread_file_paths`, `get_model_portfolio_file_paths`.
- **Why login/admin stayed safe:** No changes to `AuthContext`, `App.tsx`, admin RPCs, `assert_is_admin`, `get_my_org_context`, or RLS policies. The two RPCs are agency-scoped storage metrics helpers; behavior is unchanged except stable reads under PG15+ RLS inside the function body.

## Reviewed candidates (5)

| Function | Notes | Outcome |
|----------|--------|---------|
| `get_chat_thread_file_paths` | Reads `organization_members`, `conversations`, `messages`, `storage.objects`; guards: agency org + conversation belongs to org | **Fixed** — `row_security=off` added |
| `get_model_portfolio_file_paths` | Reads org, `models`, `model_photos`, `storage.objects`; guards: agency org + model.agency_id | **Fixed** — `row_security=off` added |
| `assert_is_admin` | Admin core | **Do not touch** — excluded |
| `get_my_org_context` | Org resolution core | **Do not touch** — excluded |
| `check_calendar_conflict` (example from long tail) | Option/booking-adjacent SECDEF without `row_security` in live `proconfig` | **MANUAL_REVIEW_REQUIRED** — needs dedicated review before any change |

Additional live candidates without `row_security=off` include many `admin_*`, triggers (`fn_*`, `trg_*`), `handle_new_user`, `match_models`, etc. — **not** modified in this wave.

## Migration

- **File:** [supabase/migrations/20260408_secdef_row_security_storage_path_helpers.sql](supabase/migrations/20260408_secdef_row_security_storage_path_helpers.sql)
- **Live deploy:** Applied via Management API; HTTP 201.
- **Verify:** `proconfig` for both functions includes `row_security=off` (confirmed post-deploy).

## Machine-readable companion

See [CURSOR_SECDEF_MINIWAVE_PLAN.json](CURSOR_SECDEF_MINIWAVE_PLAN.json).

## Outcome label

**SAFE SECDEF MINI-WAVE APPLIED**
