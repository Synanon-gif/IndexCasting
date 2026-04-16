# Delete Organization & Delete Account — Maximum audit (2026)

Read-only architecture and operations reference. **Does not** execute destructive SQL. **Live DB** truth requires operator-run verification (see section 4).

## 1. UI entry points (canonical)

| Action | Surfaces | RPC / service |
|--------|----------|---------------|
| Delete organization (owner) | `AgencyControllerView.tsx`, `ClientWebApp.tsx` | `dissolveOrganization` → `dissolve_organization` |
| Delete account (owner / model org user) | Same + `ModelProfileScreen.tsx` | `requestAccountDeletion` → `request_account_deletion` |
| Delete account (booker / employee) | `AgencyControllerView.tsx`, `ClientWebApp.tsx` | `requestPersonalAccountDeletion` → `request_personal_account_deletion` |

Cross-platform UX: `showConfirmAlert` / `showAppAlert` (`src/utils/crossPlatformAlert.ts`). Error mapping for dissolve: `messageForDissolveOrganizationError` (`src/utils/accountDeletionFeedback.ts`).

## 2. P0 / P1 inventory — `Alert.alert` multi-button & web-fragile confirms

**P0 (org / account deletion)** — migrated earlier: owner dissolve, account delete, personal delete on `AgencyControllerView`, `ClientWebApp`, `ModelProfileScreen`.

**P1 (destructive / revoke — same web reliability class)** — migrated in this audit pass:

| Area | File | Pattern |
|------|------|---------|
| Calendar feed revoke | `ClientWebApp.tsx`, `AgencySettingsTab.tsx`, `ModelProfileScreen.tsx` | `showConfirmAlert` |
| Calendar feed created (long body) | `ClientWebApp.tsx`, `AgencySettingsTab.tsx`, `ModelProfileScreen.tsx` | `showAppAlert` |
| Consent withdraw (native branch) | `AgencySettingsTab.tsx` | `showConfirmAlert` |
| Manual calendar event delete | `AgencyControllerView.tsx` | `showConfirmAlert` |
| End representation (model) | `AgencyControllerView.tsx` | `showConfirmAlert` |
| Model location remove | `ModelProfileScreen.tsx` | `showConfirmAlert` |
| Billing address delete (native) | `BillingDetailsForm.tsx` | `showConfirmAlert` (unified with web) |
| Media delete confirm (native) | `ModelMediaSettingsPanel.tsx` | `showConfirmAlert` (unified) |
| Org logo / gallery remove | `AgencyOrgProfileScreen.tsx`, `ClientOrgProfileScreen.tsx` | `showConfirmAlert` + `showAppAlert` |
| Admin purge user | `AdminDashboard.tsx` | `showConfirmAlert` |
| Admin org type convert (native async confirm) | `AdminDashboard.tsx` | `showConfirmAlert` |
| Admin storage unlimited / reset | `AdminDashboard.tsx` | `showConfirmAlert` |

**P2 / informational** (single-button or non-destructive): many remaining `Alert.alert` calls for validation messages, success toasts, etc. — lower priority unless product reports web issues.

**Grep maintenance:** `rg "Alert\\.alert\\(" src` after changes to destructive flows.

## 3. Semantics: `dissolve_organization` vs `delete_organization_data`

| Area | `dissolve_organization` (current UI) | `delete_organization_data` (GDPR-style purge in repo root SQL) |
|------|--------------------------------------|----------------------------------------------------------------|
| Org row | Deleted when FK chain allows | Deleted after purge |
| `organization_members` / `invitations` | Yes | Yes |
| B2B messenger (org-scoped) | Not targeted by dissolve | Intended in GDPR SQL |
| Option/casting + related | Not targeted | Client branch in SQL (see section 3.1) |
| Agency models / photos | Not targeted | Intended in SQL |
| `organization_subscriptions` | Not targeted | Intended in SQL |
| Member soft-delete (`deletion_requested_at`) | No | Yes (all members) |

**Product decision (2026, documented): Option A** — UI stays on **`dissolve_organization`**. Copy describes that the **workspace shell** (org row, memberships, invites) is removed; **linked business data** may remain or **block** delete via FKs. Full data purge is **not** implied. **Option B** (wire UI or dissolve to verified `delete_organization_data` or successor RPC) requires live verification, `supabase/migrations/YYYYMMDD_*.sql`, and explicit product sign-off — **not shipped** in this audit.

### 3.1 Drift risk — `option_requests.client_id`

Historical GDPR SQL may filter client option rows by `client_id` tied to `clients` / org client id. Newer product paths may store **`auth.uid()`** in `option_requests.client_id`. **Before** changing purge logic, on **live** DB verify:

- Column semantics (`information_schema.columns` + sample rows).
- `pg_get_functiondef('public.delete_organization_data'::regproc)` (or current name).

## 4. Live verification checklist (operator — not automated)

Run in Supabase SQL editor or Management API against **production** or staging mirror:

```sql
-- 4.1 Deployed routines
SELECT proname, pg_get_functiondef(oid)
FROM pg_proc
WHERE pronamespace = 'public'::regnamespace
  AND proname IN ('dissolve_organization', 'delete_organization_data');

-- 4.2 FKs referencing organizations
SELECT
  tc.constraint_name,
  kcu.table_name AS referencing_table,
  kcu.column_name
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
  ON tc.constraint_name = kcu.constraint_name
  AND tc.table_schema = kcu.table_schema
JOIN information_schema.constraint_column_usage ccu
  ON ccu.constraint_name = tc.constraint_name
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND ccu.table_name = 'organizations'
ORDER BY kcu.table_name;

-- 4.3 option_requests.client_id — sample interpretation (adjust LIMIT)
SELECT client_id, COUNT(*) FROM public.option_requests GROUP BY 1 ORDER BY 2 DESC LIMIT 20;
```

Document findings in internal runbook; do not assume root `supabase/*.sql` matches live (see `docs/LIVE_DB_DRIFT_GUARDRAIL.md`).

## 5. Delete account path (current)

1. **UI:** `request_account_deletion` or `request_personal_account_deletion` sets **`profiles.deletion_requested_at`** (soft schedule).
2. **Edge `delete-user`:** hard auth + storage purge path exists; **not** invoked by the Settings delete-account buttons documented here.
3. **Gaps:** `conversations.participant_ids` staleness, `used_trial_emails`, email reuse — see `docs/GDPR_DELETE_FLOW.md`.

## 6. Operational runbook — test org reset

**Goal:** Client or agency org “gone” for re-testing.

- **`dissolve_organization` alone** often **does not** remove projects, options, subscriptions, etc. Delete may **fail** if FKs reference `organizations`.
- **Option A:** Support-assisted cleanup, admin tools, or manual SQL in **non-prod** only.
- **Option B (future):** verified purge RPC + migration + UI copy — only after section 4 checks.

## 7. Manual QA matrix (extended)

| # | Case | Expected |
|---|------|----------|
| 1 | Owner dissolves org (web) | `window.confirm` via `showConfirmAlert`; success or mapped FK/owner error |
| 2 | Owner dissolves org (native) | Native confirm; same |
| 3 | Non-owner | No dissolve control |
| 4 | Dissolve blocked (FK) | User-visible English message (`dissolveOrgFailedDependencies` / mapped) |
| 5 | Owner schedules account delete | Soft-delete RPC; scheduled message; sign-out |
| 6 | Booker/employee personal delete | `request_personal_account_deletion` |
| 7 | Calendar feed revoke (web) | Confirm visible; revoke runs |
| 8 | Billing address delete (web) | Confirm; row removed |
| 9 | Org logo remove (web) | Confirm; logo cleared |
| 10 | Model removes location | Confirm; only model-owned source |

## 8. Automated tests

- `src/utils/__tests__/accountDeletionFeedback.test.ts` — dissolve error mapping.
- `src/services/__tests__/organizationsInvitationsSupabase.test.ts` — `dissolveOrganization` RPC outcomes.
- `src/utils/__tests__/crossPlatformAlert.test.ts` — web `confirm` / native `Alert.alert` wiring.

## 9. Residual risks

- Root SQL vs `migrations/` drift for `delete_organization_data`.
- Soft-delete vs hard `delete-user` / email reuse.
- Multi-party data: counterparties may retain rows by design until product-defined purge.

## 10. Reliability statement

Delete organization / delete account / P1 destructive confirms use **`showConfirmAlert`** or **`showAppAlert`** so **web** users get working **`window.confirm` / `window.alert`** semantics instead of unreliable multi-button `Alert.alert`.
