# CURSOR_AUTO_AUDIT_REPORT.md

**Generated:** 2026-04-07 (UTC)  
**Repository:** IndexCasting (local workspace)  
**Mode:** Read-only static audit; **no** migrations executed, **no** deploys, **no** edits to existing application sources.

---

## 1. Executive Summary

| Item | Status |
|------|--------|
| **Audit scope** | `src/`, `supabase/migrations/`, `supabase/*.sql`, `supabase/functions/`, `.cursor/rules/*`; cross-check hints from `CHATGPT_*` exports |
| **Live DB** | **Not verified:** `SUPABASE_ACCESS_TOKEN` was **not** available in the audit environment. [`CHATGPT_LIVE_DB_STATE.txt`](CHATGPT_LIVE_DB_STATE.txt) remains stub + SQL appendix. |
| **Repo audit** | **Completed** (static). |
| **SQL checks prepared** | [`CURSOR_AUTO_AUDIT_SQL_CHECKS.sql`](CURSOR_AUTO_AUDIT_SQL_CHECKS.sql) |
| **Artefacts** | [`CURSOR_AUTO_AUDIT_FINDINGS.json`](CURSOR_AUTO_AUDIT_FINDINGS.json), [`CURSOR_AUTO_AUDIT_GREP_CHECKS.txt`](CURSOR_AUTO_AUDIT_GREP_CHECKS.txt), [`CURSOR_AUTO_AUDIT_LOGIN_SAFETY.md`](CURSOR_AUTO_AUDIT_LOGIN_SAFETY.md) |
| **Live appendix** | **Not produced** (token missing). Run `node scripts/fetch-live-db-state.mjs` when token is set, then compare output to migrations. |

**Overall judgment (static):** The codebase **aligns well** with documented invariants for **admin bootstrap isolation**, **admin-before-`effectiveRole` routing**, and **token-based model claim**. SQL migrations show **intentional** hardening for RLS recursion, territory self-reference, location multi-row, and storage SECDEF helpers. **Residual risk** is concentrated in **SECURITY DEFINER + `row_security=off`** helpers (must be verified on **live** DB with prepared SQL) and **heuristic** frontend async patterns (see section 9).

---

## 2. Login Safety Summary

| Persona | Finding (static) |
|---------|------------------|
| **Admin** | `signIn` → isolated `bootstrapThenLoadProfile` → `loadProfile` (multi-layer admin flags) → `App.tsx` `isAdmin()` before `effectiveRole`. **Appears login-safe.** |
| **Agency** | Same bootstrap; org via `get_my_org_context` for agent role. |
| **Client** | Same; paywall/activation after legal gates in `App.tsx`. |
| **Model** | No `get_my_org_context` in model path; claim token isolated after bootstrap. |
| **Guest / invite / claim** | Invite accept and `linkModelByEmail` after Step 1; claim token isolated. |

Detail: [`CURSOR_AUTO_AUDIT_LOGIN_SAFETY.md`](CURSOR_AUTO_AUDIT_LOGIN_SAFETY.md).

---

## 3. Critical Findings (BLOCKER)

**No confirmed BLOCKER** in static analysis that proves broken admin login, broken user login, org leak, or definite 42P17 in production.

**BLOCKER candidates** (require **live** `pg_policies` / `pg_proc` confirmation — not proven from repo alone):

- Drift between **last-applied migration** and **production** (unknown without token).
- Any **new** policy introducing `model_agency_territories` self-join (`self_mat` pattern) — repo contains explicit fix migration [`20260414_fix_mat_client_policy_self_ref_regression.sql`](supabase/migrations/20260414_fix_mat_client_policy_self_ref_regression.sql).

---

## 4. High / Medium / Low Findings

### High (review priority — not all are defects)

- **SECDEF + `row_security=off`:** 16 functions flagged **high** by heuristic in [`CURSOR_AUTO_AUDIT_FINDINGS.json`](CURSOR_AUTO_AUDIT_FINDINGS.json) (e.g. roster/chat/assignment helpers). Each must be read against **caller guard + resource binding** rules (see `.cursorrules` §21–23).
- **Redefinition density:** Functions redefined across **3–4** migration files (e.g. `bulk_*_territories`, `has_platform_access`) — **last file wins**; verify final definition on live DB.

### Medium

- **Legacy admin guard style:** Some older `admin_*` definitions may still reference `profiles.is_admin` inside SECURITY DEFINER (column may be REVOKEd for callers — **policy uses RPC**, not the same as RLS). Prefer **`assert_is_admin()`** as canonical first line for new changes.
- **`link_model_by_email`:** Still called from `AuthContext` Step 2 — documented deprecated; not a login blocker but **tenant-safety** topic for future removal.

### Low

- **Org UI:** Multi-org users: deterministic first membership — documented product limitation.
- **Grep:** `const snapshot` — **no matches** under `src/`; [`src/web/ClientWebApp.tsx`](src/web/ClientWebApp.tsx) documents **inverse-operation** rollback for add/remove project models (aligned with updated invariant docs).

---

## 5. Security Definer Matrix

- **174** `SECURITY DEFINER` functions extracted from `supabase/migrations/*.sql` + root `supabase/*.sql`.
- **Summary** (see JSON `summary`): high / medium / low counts are **heuristic**; field-level detail per function: [`CURSOR_AUTO_AUDIT_FINDINGS.json`](CURSOR_AUTO_AUDIT_FINDINGS.json).
- **Admin RPC guard styles** recorded: `perform_assert_is_admin`, `is_current_user_admin`, `legacy_profiles_is_admin`, etc.

---

## 6. RLS / Policy Findings (repo static)

- **FOR ALL splits:** Documented fixes in [`20260406_fix_for_all_calendar_mmc.sql`](supabase/migrations/20260406_fix_for_all_calendar_mmc.sql), [`20260406_fix_mat_self_ref_recursion.sql`](supabase/migrations/20260406_fix_mat_self_ref_recursion.sql), [`20260411_model_embeddings_policies_finalize.sql`](supabase/migrations/20260411_model_embeddings_policies_finalize.sql).
- **`model_claim_tokens`:** [`20260413_fix_c_model_claim_tokens.sql`](supabase/migrations/20260413_fix_c_model_claim_tokens.sql) uses `FOR ALL` **only** for `admin_full_access_model_claim_tokens` with `is_current_user_admin()` — **allowed** (admin-only FOR ALL).
- **Self-reference:** Regression documented and fixed in `20260414_*` / `20260413_fix_a_territory_unique_constraint.sql` comments; anti-regression checks belong in [`CURSOR_AUTO_AUDIT_SQL_CHECKS.sql`](CURSOR_AUTO_AUDIT_SQL_CHECKS.sql).
- **models RLS vs profiles:** Client access uses SECURITY DEFINER helpers (e.g. [`20260413_fix_d_models_rls_client_secdef.sql`](supabase/migrations/20260413_fix_d_models_rls_client_secdef.sql)) — aligns with “no direct profiles.role in models policy” rule.

---

## 7. Org / Multi-Tenant Findings

- **Safe pattern:** Comments in [`AgencyDashboardScreen.tsx`](src/screens/AgencyDashboardScreen.tsx) / [`AgencyControllerView.tsx`](src/views/AgencyControllerView.tsx): `profile.agency_id` only — no `agencies[0]` / email match (grep hits are **comments** stating the rule).
- **Model ↔ agency SoT:** `model_agency_territories` enforced in migrations and docs; `organization_members` for models is **not** supported by design.
- **Services:** Defense-in-depth `eq('agency_id', …)` patterns in recruiting/options services (per historical fixes).

---

## 8. Location / Storage / Invite / GDPR Findings

- **Location:** Multi-row [`20260406_location_multirow_priority.sql`](supabase/migrations/20260406_location_multirow_priority.sql); `DISTINCT ON` restored [`20260423_get_models_near_location_restore_distinct_on.sql`](supabase/migrations/20260423_get_models_near_location_restore_distinct_on.sql); agency GPS preservation in upsert migrations.
- **Storage:** SECDEF helpers in [`20260406_fix_storage_policies_secdef.sql`](supabase/migrations/20260406_fix_storage_policies_secdef.sql); chat bucket hardening [`20260425_chat_files_storage_insert_hardening.sql`](supabase/migrations/20260425_chat_files_storage_insert_hardening.sql).
- **Invite / claim:** Token tables + `claim_model_by_token` / `generate_model_claim_token` migrations; Edge `send-invite` referenced in rules (multi-org `organization_id` — verify in function code when changing).
- **GDPR / delete:** Row-security fixes in [`20260419_request_account_deletion_row_security_off.sql`](supabase/migrations/20260419_request_account_deletion_row_security_off.sql), [`20260420_gdpr_rpc_row_security_account_delete_membership.sql`](supabase/migrations/20260420_gdpr_rpc_row_security_account_delete_membership.sql) — **live test** delete/export flows after any change.

---

## 9. Frontend Async / Contract Findings

- **ClientWebApp:** Explicit **inverse-operation** rollback comments and `.then(ok)` patterns for `addModelToProjectOnSupabase`; unexpected `.catch` logged (handles rare rejection).
- **Global search:** `const snapshot` grep — **0** hits in `src/` (current tree).
- **Service contract:** Mixed Option A (`boolean`/`[]`) and `ServiceResult` may coexist **across** files — per-function mixing is the actual invariant violation; full cross-file audit not exhaustive; spot-check when touching services.
- **`.catch(() =>`:** Present in multiple files — each callsite must be checked against **Option A vs throwing** (see [`CURSOR_AUTO_AUDIT_GREP_CHECKS.txt`](CURSOR_AUTO_AUDIT_GREP_CHECKS.txt) samples).

---

## 10. Drift / Duplication Findings

- **Many migrations** restate the same RPC/policy for hardening (expected April 2026 incident response). **Risk:** local `supabase/migration_*.sql` root files may **not** match deployed order — **migrations/** is source of truth for CLI deploy.
- **Duplicate definitions:** JSON lists `redefinition_count` and `defined_in_files` per SECDEF function — use for code review and live diff.

---

## 11. Fix Recommendations (minimal-invasive, ordered)

Each item: **only after** live SQL_CHECKS + login smoke tests.

1. **Run live verification** using [`CURSOR_AUTO_AUDIT_SQL_CHECKS.sql`](CURSOR_AUTO_AUDIT_SQL_CHECKS.sql) and refresh [`CHATGPT_LIVE_DB_STATE.txt`](CHATGPT_LIVE_DB_STATE.txt) via `scripts/fetch-live-db-state.mjs`.  
   - *Risk reduced:* Drift detection.  
   - *Why login stays safe:* Read-only queries.  
   - *Test:* N/A (read-only).

2. **Manual pass on 16 high-heuristic SECDEF functions** (JSON): confirm each has auth + membership + resource scope.  
   - *Risk reduced:* Broad-access via `row_security=off`.  
   - *Why login stays safe:* Changes only inside guarded RPCs; avoid touching `get_own_admin_flags` / `loadProfile` order without triple fallback.  
   - *Test:* Role matrix RPC smoke + unit tests for guards.

3. **Plan removal of `linkModelByEmail` from Step 2** after agencies migrate to claim tokens.  
   - *Risk reduced:* Email-collision / takeover (Gefahr 9).  
   - *Why login stays safe:* Remove **only** from Step 2 after token coverage; never merge into Step 1.  
   - *Test:* Model signup/login + legacy model linking.

4. **Centralize admin RPC guard to `PERFORM assert_is_admin()`** when touching any legacy `admin_*` still using `profiles.is_admin` in-body check.  
   - *Risk reduced:* Consistent UUID+email pin.  
   - *Why login stays safe:* Keep `loadProfile` triple fallback until RPC stability proven.  
   - *Test:* Admin login + AdminDashboard list users.

---

## 12. Do-Not-Touch List (without dedicated change plan)

| Area | Reason |
|------|--------|
| `AuthContext.tsx` `signIn` Step 1 / Step 2 boundary | Admin login invariant |
| `App.tsx` admin branch before `effectiveRole` | Prevents admin → AuthScreen |
| `src/types/roles.ts` `isAdmin()` | Dual OR for `is_admin` / `role` |
| `get_own_admin_flags` / `is_current_user_admin` semantics | Admin detection layers |
| `handle_new_user` allowlist / `one_admin_only` | Escalation prevention |
| Watchlist RLS tables’ FOR ALL reintroduction | 42P17 risk |

---

## Closing note

- **Login-safe (static):** Yes — structure matches documented patterns.  
- **Admin-safe (static):** Yes — routing + bootstrap isolation present; DB side needs **live** confirmation.  
- **Further fixes:** Only with a **small change plan**, `CURSOR_AUTO_AUDIT_SQL_CHECKS.sql` on prod/staging, and **role-based** regression tests (admin, agency, client, model).
