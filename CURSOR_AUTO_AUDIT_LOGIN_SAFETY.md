# CURSOR_AUTO_AUDIT_LOGIN_SAFETY.md

**Scope:** Static review of repository sources (no live DB queries in this run).  
**Related:** [`CURSOR_AUTO_AUDIT_REPORT.md`](CURSOR_AUTO_AUDIT_REPORT.md), [`CURSOR_AUTO_AUDIT_FINDINGS.json`](CURSOR_AUTO_AUDIT_FINDINGS.json).

---

## 1. Admin login data flow

1. **Auth:** `supabase.auth.signInWithPassword` in [`src/context/AuthContext.tsx`](src/context/AuthContext.tsx) (`signIn`).
2. **Step 1 (mandatory):** `bootstrapThenLoadProfile(userId)` runs in its **own** `try/catch`. Failures that throw result in **sign-out** and `loginFailed` (session must not exist without profile).
3. **Inside bootstrap:** RPC/bootstrap attempts, then `loadProfile(userId)`.
4. **`loadProfile` admin detection (three layers):**
   - RPC `get_own_admin_flags` (primary).
   - RPC `is_current_user_admin()` (secondary).
   - Tertiary: `data.role === 'admin'` log + `is_admin` / `is_super_admin` from profile row.
5. **Routing:** [`App.tsx`](App.tsx) calls `isAdmin(profile)` **before** `effectiveRole` gate. `isAdmin` is defined in [`src/types/roles.ts`](src/types/roles.ts) as `profile.is_admin === true || profile.role === 'admin'`.
6. **Why order matters:** `roleFromProfile('admin')` yields no `effectiveRole`; without the early admin branch the admin would hit `AuthScreen`.

**LOGIN_BLOCKER:** None identified in static review for the current code ordering. Any change that runs `linkModelByEmail`, invite accept, or other side effects **inside** the same `try` as `bootstrapThenLoadProfile` would be a **LOGIN_BLOCKER** (matches documented invariant).

---

## 2. Agency login data flow

- Same `signIn` Step 1 bootstrap.
- `loadProfile` loads org context via `get_my_org_context()` for `client` / `agent` roles (not for models per project rules).
- Multi-org: code paths log when multiple memberships exist; uses deterministic first row (documented limitation until multi-org UI).

**LOGIN_BLOCKER:** None from static structure. **Risk:** implicit org choice if multiple orgs — data-leak class issue, not admin-login.

---

## 3. Client login data flow

- Same as agency for B2B roles (`role === 'client'`).
- Paywall / activation gates in `App.tsx` after legal acceptance.

**LOGIN_BLOCKER:** None identified statically.

---

## 4. Model login data flow

- Bootstrap + `loadProfile`; org context RPC is **not** used for models (`get_my_org_context` skipped for model role).
- Model–agency truth: `model_agency_territories` (DB + services).
- **Claim path:** `claimModelByToken` invoked from isolated `try` blocks in `signUp` / `signIn` after bootstrap (does not wrap Step 1).

**LOGIN_BLOCKER:** None identified statically.

---

## 5. Guest / invite / claim special paths

- **Invite:** `acceptOrganizationInvitation` in Step 2 `try` after bootstrap (`signIn`); failure does not skip Step 1.
- **Deprecated:** `linkModelByEmail` in separate `try` after Step 1 (sign-in and sign-up paths) — must remain non-blocking for admin bootstrap.
- **Claim token:** `claimModelByToken` + `loadProfile` refresh in isolated `try`.

**LOGIN_BLOCKER:** Moving invite or `linkModelByEmail` into Step 1 `try` would be **LOGIN_BLOCKER**.

---

## 6. C5 — Hypothetical change simulation (static)

| Hypothetical change | Security gain | Admin login risk | Agency/Client/Model risk | Affected areas | Tests before merge |
|---------------------|---------------|------------------|---------------------------|----------------|--------------------|
| Unify `get_own_admin_flags` only | Clearer single RPC | **High** if RPC errors propagate to empty profile | Low if fallback kept | `AuthContext.loadProfile` | Login E2E admin + unit mocks for RPC failure |
| Add guards inside SECDEF helpers | Narrower blast radius | **Low** unless guard rejects admin UUID/email pin | Medium if org membership mis-checked | `supabase/migrations/*` | RPC tests + role logins |
| Remove `LIMIT 1` from org context resolution | Fixes implicit org | N/A for admin | **High** if UI not ready for multiple rows | `get_my_org_context` consumers | Multi-org selection QA |
| Replace email-matching remnants | Tenant safety | Low | Medium for legacy invite flows | Services + SQL policies | Invite + agency directory flows |
| Tighten column REVOKE on `profiles` | Column-level security | **High** if admin flags read breaks | High if RLS depends on revoked cols | migrations | Admin + each role login |
| Split more policies (no FOR ALL) | Less 42P17 risk | Low if not on login path | Low–medium | watchlist tables | profiles SELECT smoke test |
| Centralize admin check in one function only | Consistency | **High** if single point fails | Low | `AuthContext` + DB | Keep triple fallback until proven redundant |

---

## 7. What must not be changed lightly

- [`src/context/AuthContext.tsx`](src/context/AuthContext.tsx): `signIn` Step 1 / Step 2 separation; `bootstrapThenLoadProfile` error → sign-out behavior; `loadProfile` admin triple detection.
- [`App.tsx`](App.tsx): `isAdmin(profile)` branch **before** `if (!effectiveRole)`.
- [`src/types/roles.ts`](src/types/roles.ts): `isAdmin()` semantics (`is_admin` OR `role === 'admin'`).
- DB: `get_own_admin_flags`, `is_current_user_admin`, `assert_is_admin`, UUID+email pin, `handle_new_user` allowlist, `one_admin_only` index (verify via SQL_CHECKS on live DB).

---

## 8. Conclusion (static)

- **Admin routing and bootstrap isolation** in the repo match the documented security rules.
- **No LOGIN_BLOCKER** found in code structure; live verification still requires running [`CURSOR_AUTO_AUDIT_SQL_CHECKS.sql`](CURSOR_AUTO_AUDIT_SQL_CHECKS.sql) against production.
