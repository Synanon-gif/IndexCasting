# Delete Organization & Delete Account — Architecture audit (2026)

This document inventories the **current** implementation after a UI reliability pass. It does **not** replace live DB verification (`pg_get_functiondef`, FK checks).

## Phase 1 — Inventory

### UI entry points

| Surface | Delete organization | Delete account (owner) | Delete account (non-owner / personal) |
|--------|---------------------|-------------------------|----------------------------------------|
| `src/views/AgencyControllerView.tsx` | Settings tab, owner only | Same | Bookers: personal RPC |
| `src/web/ClientWebApp.tsx` | Settings overlay, owner | Same | Employees: personal RPC |
| `src/screens/ModelProfileScreen.tsx` | — | Account tab (`request_account_deletion`) | — |

### Cross-platform feedback utilities

- `src/utils/crossPlatformAlert.ts` — `showAppAlert`, `showConfirmAlert` (web: `window.alert` / `window.confirm`; native: `Alert.alert`).
- `src/utils/accountDeletionFeedback.ts` — maps dissolve errors to safe `uiCopy` strings.

### Backend paths

| Action | Primary API | Notes |
|--------|-------------|--------|
| Delete organization (UI label) | `public.dissolve_organization(p_organization_id)` via `dissolveOrganization()` in `organizationsInvitationsSupabase.ts` | Removes `organization_members`, `invitations`, `organizations` row. **Does not** run the GDPR-wide `delete_organization_data` body from root `migration_gdpr_compliance_2026_04.sql` (that RPC is **not** in `supabase/migrations/`; live presence must be verified separately). |
| Delete account (owner / model) | `public.request_account_deletion()` via `accountSupabase.requestAccountDeletion` | Soft-delete: `profiles.deletion_requested_at`. Agent/client: blocks non-owners with `only_organization_owner_can_delete_account`. |
| Delete account (member) | `public.request_personal_account_deletion()` | Deletes caller’s `organization_members` rows; sets `deletion_requested_at`. |
| Hard auth + storage purge | Edge `supabase/functions/delete-user` | Service role; not triggered directly by these RPCs. |

### Architecture map (high level)

1. **Delete organization:** Button → `showConfirmAlert` → `dissolve_organization` → on success: local state `orgDissolved`, `refreshProfile`, optional success alert; on failure: mapped error message.
2. **Delete account:** Button → `showConfirmAlert` → `request_account_deletion` **or** `request_personal_account_deletion` → success alert → `signOut()`.

## Phase 2 — Root cause: “dead click” / silent failure

**Primary root cause (web):** Destructive flows used `Alert.alert` with multiple buttons. On **React Native Web**, that pattern is **unreliable**; the confirmation often does not appear, so handlers never run — perceived as dead click with no error.

**Fix applied:** All listed destructive buttons now use `showConfirmAlert` / `showAppAlert` for confirm, success, and errors.

**Secondary:** PostgREST errors from dissolve (e.g. FK violations) previously collapsed to a generic string; a small mapper surfaces **safe** user copy for known classes without leaking SQL.

## Phase 3–4 — Semantics & gaps (current behavior)

### `dissolve_organization` (canonical org delete in UI)

**Removes:** All members of the org, pending invitations, the `organizations` row (when DB allows the delete).

**May not remove:** Business rows that still reference the org with `ON DELETE RESTRICT` or legacy FKs — delete can **fail** with a FK error; UI now explains “related records still exist” in English.

**Contrast:** `delete_organization_data` (GDPR doc / `gdprComplianceSupabase.deleteOrganizationData`) describes a **much broader** purge (models, option threads, conversations scoped to org, etc.). The **product UI currently does not call** that function; aligning UI with full purge requires a **separate, explicit** product/DB decision and migration if the RPC is not on live.

### `request_account_deletion` / `request_personal_account_deletion`

- **Soft delete** only in-app; **auth user** remains until Edge/cron purge.
- **Email reuse** may still be blocked by `used_trial_emails` or auth lifecycle — operational, not fixed in this pass.
- **Multi-party threads:** Conversations use `participant_ids` arrays; see `docs/GDPR_DELETE_FLOW.md` for documented gaps after auth delete.

## Phase 5 — Org delete vs account delete

- **Expected UX:** Owner dissolves org first (when they have a B2B org), then schedules account deletion — UI copy guides this.
- **RPC:** Owner can still call `request_account_deletion` while org exists (soft-delete profile); hard auth removal later must respect `organizations.owner_id` **ON DELETE RESTRICT** (see `migration_fix_org_owner_delete_restrict.sql`).

## Phase 8 — Automated tests

- `src/utils/__tests__/accountDeletionFeedback.test.ts` — error mapping.

## Phase 9 — Manual QA matrix (condensed)

| # | Case | Steps | Expected backend | Expected UI |
|---|------|--------|------------------|-------------|
| 1 | Owner deletes org (web) | Open Settings → Delete organization → confirm | `dissolve_organization` ok | Browser confirm; then success alert or green banner; loading on button |
| 2 | Owner deletes org (native) | Same | Same | Native confirm; success alert |
| 3 | Non-owner | No dissolve button | — | — |
| 4 | Dissolve blocked (FK) | Org with blocking FKs (test env) | RPC error | English error, not silent |
| 5 | Owner schedules account delete | After dissolve (or model) → Delete account → confirm | `request_account_deletion` true | Confirm; “Deletion scheduled”; sign out |
| 6 | Booker/employee personal delete | Delete account → confirm | `request_personal_account_deletion` | Same feedback pattern |
| 7 | Non-owner hits owner-only path | N/A for models | Exception for agent/client non-owner | `ownerOnly` message |

## Phase 11 — Residual risks

- **Semantic gap** between **dissolve** (shell) and **full GDPR org purge** if product intends “all org data.”
- **Hard delete** and **storage** cleanup still depend on Edge/cron, not these buttons alone.
- **Counterparty** calendar/thread rows may remain by design; full multi-party erase needs `delete_option_request_full` / product policy.

## Reliability statement (post-fix)

- **Delete Organization / Delete Account buttons:** Confirmation and outcomes are **visible on web and native** using the cross-platform helpers; **no intentional silent no-op** from missing `Alert` on web.
- **End-to-end data purge:** **Not fully guaranteed** by `dissolve_organization` alone; operational completeness requires DB review and optional alignment with `delete_organization_data` or extended RPC, verified on **live** DB.
