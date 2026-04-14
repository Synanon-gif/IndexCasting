# Post-Hardening Baseline — 2026-04-14

## Purpose

This document defines the **post-hardening baseline** for IndexCasting.
It marks the completion of the initial security, workflow, and UX hardening
phase and serves as a reference point for all future changes.

Any regression against this baseline is a release-blocker.

---

## Baseline identity

| Field             | Value                                        |
|-------------------|----------------------------------------------|
| Tag               | `post-hardening-baseline-2026-04`            |
| Branch            | `main`                                       |
| Commit            | `7675a3a529f661ffd8193b4305f865db2c646b55`   |
| Date              | 2026-04-14                                   |
| Migrations        | 208 (`20260404_fix_admin_column_security` – `20260818_fix_invite_zombie_org`) |
| Total commits     | 410                                          |

---

## What is considered baseline

### 1. Admin access

- Triple-layer admin detection (RPC + RPC + role fallback), UUID+email pinned.
- `signIn()` bootstrap isolation: `bootstrapThenLoadProfile` in separate
  try-catch from side-effects.
- Admin routing before `effectiveRole` check in `App.tsx`.
- `one_admin_only` unique index.
- `handle_new_user` role allowlist (client/agent/model/guest only).

### 2. RLS / security architecture

- No `profiles.is_admin = true` in any RLS policy.
- No email-matching in any RLS policy.
- No FOR ALL policies on watchlist tables (`model_embeddings`,
  `model_locations`, `model_agency_territories`, `calendar_entries`,
  `model_minor_consent`).
- No self-referencing RLS policies.
- All SECDEF functions called from policies have `SET row_security TO off`.
- All SECDEF RPCs with `row_security=off` have 3-layer internal guards
  (auth, membership, resource ownership).
- Storage policies decoupled from `models` RLS via SECDEF helpers.
- `assert_is_admin()` on every admin RPC.

### 3. Organization / multi-tenant

- Org context via `get_my_org_context()` (multi-row, no LIMIT 1).
- Defense-in-depth: explicit `org_id` filter in service functions + RLS.
- `assertOrgContext()` for all audit-log writes.
- No email-based org lookup in frontend or backend.
- Invite-before-bootstrap invariant (3-layer zombie-org prevention).
- Agency seat limits enforced by DB trigger.

### 4. Territory system

- `UNIQUE(model_id, country_code)` on `model_agency_territories`.
- Territory lookup exclusively from `model_agency_territories`, never
  `model_assignments`.
- Near Me MAT dedup via `first_territory` CTE with DISTINCT ON.
- Discovery ranked with `mat.country_code = p_iso` filter.

### 5. Location system

- `UNIQUE(model_id, source)` — three independent rows per model.
- Source priority: `live` > `current` > `agency` (immutable).
- Agency writes never overwrite model GPS.
- Geocoding-fail guard (no null-coordinate writes).
- Canonical city display: `effective_city ?? city`.

### 6. Option / casting / job lifecycle

- Two-axis separation: price (Axis 1) independent from availability (Axis 2).
- Agency-only flow with INSERT+UPDATE pattern for calendar triggers.
- Model confirmation 4-condition gate.
- Non-retroactive model approval (E-0).
- Status transition trigger formalized in migrations.
- Rejection cascade via `fn_reset_final_status_on_rejection`.
- Full-delete via `delete_option_request_full` RPC.
- Inflight guards (`beginCriticalOptionAction`/`endCriticalOptionAction`)
  on all store mutations.
- DB-refresh after every successful RPC mutation.

### 7. Smart Attention

- Single canonical pipeline (`attentionSignalsFromOptionRequestLike` →
  derive functions → header labels).
- All call-sites carry `isAgencyOnly`.
- Messages-tab-dot, calendar badges, and thread headers derive from
  same source.
- No parallel heuristics.

### 8. Chat / messaging

- System messages via `insert_option_request_system_message` (SECDEF,
  `from_role = 'system'`).
- Optimistic message send with `.then(ok)` rollback pattern.
- Realtime subscriptions wired in all thread views.
- B2B conversation org-pair invariant enforced.
- Model-safe message filtering (3-layer: API, server, client).

### 9. Frontend / UX

- Responsive: mobile-first, WhatsApp-like chat, compact headers.
- Calendar: strict view isolation, lifecycle dedup, semantic colors.
- Image pipeline: `normalizeDocumentspicturesModelImageRef` + `StorageImage`.
- PDF export: web-only, scope-limited, dynamic import.
- Measurement: "Chest" (never "Bust") in user-facing UI.
- Inverse-operation rollback for all optimistic updates (no snapshots).
- Per-id inflight locks on all async mutations.

### 10. Upload / media

- Upload technical parity across all paths (MIME, magic bytes, extension,
  HEIC, sanitized names, `upsert: false`).
- EXIF stripping on upload.
- Polaroids restricted to packages/guest links.
- Storage negative cache + dedup.

### 11. Paywall / billing

- `can_access_platform()` as single source of truth.
- Order: `admin_override` → `trial_active` → `subscription_active` → deny.
- Owner-only checkout (server-enforced).
- Stripe webhook → DB → UI (frontend never sets subscription status).
- Fail-closed on paywall errors.

### 12. Scalability

- Discovery RPC optimized.
- Option requests RLS deduped.
- Near Me bbox-before-distinct.
- Calendar entries RLS via SECDEF helper.
- Missing indexes added.
- Keyset pagination for location.
- Advisory locks for option requests.

---

## What was verified

- All 208 migrations deployed via `supabase-push-verify-migration.sh`.
- Verification queries from `rls-security-patterns.mdc` §Verifizierungs-Queries
  executed (no FOR ALL on watchlist, no `is_admin=true` in policies, no
  self-references on MAT, SECDEF functions have `row_security=off`).
- `npm run typecheck`, `npm run lint`, `npm test` pass.
- Admin login functional with triple-layer detection.
- Login for all roles (admin, owner, booker, employee, model) verified.

---

## What remains intentionally out of scope

| Area | Status | Notes |
|------|--------|-------|
| Multi-org UI switching | Deferred | Oldest membership used with warning; no user-facing org switcher |
| `link_model_by_email` removal | Deprecated | Still in `signIn`/`signUp` fallback; isolated try-catch |
| Swipe legacy (`getModelsPagedFromSupabase`) | Legacy-tolerant | Uses `models.city`; ranked discovery is the replacement path |
| Data retention automated enforcement | Partially staged | Orchestrator migration exists; full automation pending |
| Stripe live cutover | Planned | Go-live checklist and verify matrix exist in `docs/` |
| CI pipeline formalization | Backlog | `docs/CI_SECURITY_BACKLOG.md` and `docs/CI_AUDIT_AND_BASELINE.md` track open items |
| End-to-end test suite | Not started | Manual regression checklists exist in cursor rules |

---

## Regression testing against this baseline

Future changes MUST be tested against the following checklist (derived from
`auto-review.mdc` §2d and `system-invariants.mdc` §12):

1. **Login** — All roles can sign in without 500/42P17
2. **Admin** — Admin always reaches AdminDashboard
3. **Org isolation** — No cross-tenant data visible
4. **Discover** — Models visible with correct territory/city context
5. **Chat** — Agency↔Client B2B chat without connection requirement
6. **Add-to-Project** — Works from discover, package, project
7. **Option Request** — From discover, package, project; correct agency resolution
8. **Casting Request** — Same paths as option
9. **Agency sees request** — Correct org context, attention signals
10. **Model with account** — Confirmation gate, availability → model action
11. **Model without account** — Auto-approved, no waiting_for_model signal
12. **Smart Attention** — Consistent across header, list, tab-dot, calendar
13. **Calendar** — Lifecycle dedup, correct badges, deeplinks work
14. **Package** — Portfolio and polaroid; media loads; guest link works
15. **PDF export** — Web-only, correct scope

### Automated checks (run before every commit)

```bash
npm run typecheck && npm run lint && npm test -- --passWithNoTests --ci
```

### Verification queries (run after security-relevant migrations)

See `rls-security-patterns.mdc` §Verifizierungs-Queries and
`auto-review.mdc` §2b.

---

## Document history

| Date       | Change |
|------------|--------|
| 2026-04-14 | Initial baseline created |
