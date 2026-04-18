# Organization Dissolve Hardening — Two-Stage GDPR Model

This document describes the canonical, GDPR-compliant flow for **soft-dissolving** an organization (Stage 1) and the **scheduled hard-purge** that follows 30 days later (Stage 2). It complements [`GDPR_DELETE_FLOW.md`](./GDPR_DELETE_FLOW.md) (per-user account deletion) and [`DELETE_ORG_ACCOUNT_FLOW_AUDIT.md`](./DELETE_ORG_ACCOUNT_FLOW_AUDIT.md) (audit baseline).

> **Scope.** Owner-initiated dissolution of a Client- or Agency-organization. Personal account deletion remains separate and is what former members do **after** Stage 1 to satisfy Art. 17 for their own profile.

---

## 1. Architectural overview

```
Owner clicks "Dissolve organization"
        │
        ▼
┌────────────────────────────────────────────────────────────┐
│ STAGE 1 — Soft-Dissolve (immediate)                        │
│   RPC public.dissolve_organization(p_organization_id)      │
│     • organizations.dissolved_at  := now()                 │
│     • organizations.dissolved_by  := auth.uid()            │
│     • organizations.scheduled_purge_at := now() + 30 days  │
│     • DELETE organization_members  (all rows for the org)  │
│     • DELETE invitations           (all pending for org)   │
│     • organization_subscriptions.status := 'canceled'      │
│     • notifications: organization_dissolved (per member,   │
│       personal scope, includes scheduled_purge_at)         │
│                                                            │
│ Frontend follow-up:                                        │
│     • cancelDissolvedOrgStripeSubscription(org_id)         │
│       → Edge function stripe-cancel-dissolved-org          │
│       (fail-tolerant; Stripe error does NOT undo Stage 1)  │
└────────────────────────────────────────────────────────────┘
        │
        │  30-day grace period
        │  (former members can log in,
        │   download personal data,
        │   delete personal account)
        │
        ▼
┌────────────────────────────────────────────────────────────┐
│ STAGE 2 — Hard-Purge (automated, daily cron)               │
│   pg_cron: 'purge_dissolved_organizations_daily'           │
│     SELECT public.run_scheduled_purge_dissolved_orgs(25);  │
│       └── public.purge_dissolved_organization_data(org)    │
│             • Per-table DELETEs in dependency-safe order   │
│             • DELETE organizations row → FK CASCADE        │
│             • Audit/security_events keep org_id = NULL     │
└────────────────────────────────────────────────────────────┘
```

---

## 2. GDPR mapping

| GDPR article | Requirement | How the system satisfies it |
|---|---|---|
| **Art. 5** (data minimization) | Personal data not kept longer than necessary. | 30-day window after Soft-Dissolve, then irrevocable hard-purge of B2B referencing data. |
| **Art. 7(1)** (demonstrate consent) | Evidence of past consent must be retainable for legal-defense purposes. | `image_rights_confirmations` keeps consent rows with `org_id → NULL`; user-bound consent is removed when the user themselves deletes their account (separate flow). |
| **Art. 15** (right of access) | Subjects must be able to obtain a copy of their personal data. | During the 30-day grace period, former members keep login access and can trigger personal data export via the **OrgDissolvedBanner → Settings → Download personal data** path. |
| **Art. 17** (right to erasure) | Personal data must be deleted on request. | Stage 1 removes membership, invitations and Stripe linkage immediately. Stage 2 removes all org-referencing B2B data. Personal account deletion (separate flow) removes the auth row + user-scoped data. |
| **Art. 30** (records of processing) | Processing activities must be auditable. | `admin_logs`, `audit_trail`, `security_events` retain rows with `org_id = NULL` after purge — sufficient for processing record without personal identifiers. |
| **Art. 32** (security of processing) | Appropriate technical safeguards. | All RPCs `SECURITY DEFINER` + `row_security off` + explicit auth/owner/admin guards (see [`admin-security.mdc`](../.cursor/rules/admin-security.mdc) and [`rls-security-patterns.mdc`](../.cursor/rules/rls-security-patterns.mdc)). RLS hides dissolved orgs from non-admin SELECTs. |

`used_trial_emails` is intentionally untouched (hashed marker only — no PII; required for trial-abuse prevention).

---

## 3. The 30-day flow (former member experience)

1. Owner triggers dissolve. Stage 1 runs atomically in the database.
2. Each former member receives an `organization_dissolved` notification on their personal `notifications.user_id`. The notification is **org-scoped to the dissolved org via `organization_id`**, but reads via the user's own personal RLS path remain after Stage 1 because:
   - `organization_members` row is gone, but `notifications.user_id = auth.uid()` is sufficient for the user's own `notifications_select_self` policy.
3. On next login, `App.tsx` reads the latest unread `organization_dissolved` personal notification and mounts the `OrgDissolvedBanner` (above the workspace shell).
4. The banner presents three actions:
   - **Download personal data** → emits `download_data` on `orgDissolvedActionBus` → workspace view (`ClientWebApp.tsx` / `AgencyControllerView.tsx`) opens its Settings panel/tab. Inside Settings the user uses the canonical `exportUserData()` flow.
   - **Delete account** → emits `delete_account` → same Settings panel/tab → canonical "Delete my account" UI.
   - **Dismiss** → marks the notification as read; does not block the user from later re-triggering download/delete from Settings.
5. Paywall guards (`ClientPaywallGuard`, `AgencyPaywallGuard`) **do not block** former members because `getMyOrgAccessStatus()` returns `org_type: null` for users without an `organization_id`, and the routing in `App.tsx` keeps `effectiveRole` resolvable via the persisted profile role.
6. The dissolved organization itself is hidden from the user via `organizations_select_hide_dissolved_restrictive` (RESTRICTIVE policy). Admin reads remain unaffected.

---

## 4. Per-table hard-purge order (Stage 2)

`public.purge_dissolved_organization_data(p_organization_id)` deletes referencing data in a deterministic, dependency-safe order **before** removing the `organizations` row so that FK CASCADE handles only the leaf data. The order is:

1. `option_request_messages` (depends on `option_requests`)
2. `calendar_entries` referencing the org's `option_requests` / `booking_events`
3. `option_requests` (the org's own + any where the org is the agency or client)
4. `booking_events`
5. `recruiting_chat_messages` → `recruiting_chat_threads` (org-owned)
6. `client_project_models` → `client_projects` (org-owned)
7. `agency_event_groups` (NO ACTION FK — must be cleaned manually)
8. `conversations` where the org appears in `client_organization_id` / `agency_organization_id`
9. `image_rights_confirmations.organization_id → NULL` (consent evidence preserved per Art. 7(1))
10. `audit_trail.organization_id → NULL`, `security_events.organization_id → NULL`
11. `organization_subscriptions` (defensive — usually already canceled in Stage 1)
12. `DELETE FROM public.organizations WHERE id = p_organization_id` → CASCADE handles whatever remains.

Each per-table DELETE is wrapped in a sub-block so a single failing table cannot abort the whole purge — counts and warnings are returned in the JSON response. Re-running the function on an already-purged org is a no-op (idempotent).

---

## 5. Stripe cancellation

Stage 1's database transaction does **not** call Stripe (no network I/O inside SECURITY DEFINER PL/pgSQL). The frontend immediately follows with:

```ts
const dissolveRes = await dissolveOrganization(orgId);
if (dissolveRes.ok) {
  // Fail-tolerant: Stripe error does not undo Stage 1.
  await cancelDissolvedOrgStripeSubscription(orgId);
}
```

Edge function: [`supabase/functions/stripe-cancel-dissolved-org/index.ts`](../supabase/functions/stripe-cancel-dissolved-org/index.ts)

- Verifies the caller's JWT and admin/owner status indirectly (only an authenticated user whose dissolve already succeeded can usefully reach it).
- Loads `organization_subscriptions.stripe_subscription_id` for the org.
- Calls `stripe.subscriptions.cancel(...)` and updates `organization_subscriptions.status` accordingly.
- Returns `{ ok, stripe_subscription_id, stripe_status, note? }`.

If Stripe fails (network, missing customer, already canceled), the local soft-dissolve state remains intact. Ops can reconcile manually via the Stripe dashboard or by re-invoking the function.

---

## 6. Cron job (Stage 2)

Migration C ([`20260418_purge_dissolved_organizations_cron.sql`](../supabase/migrations/20260418_purge_dissolved_organizations_cron.sql)) installs the `pg_cron` job:

```sql
cron.schedule(
  'purge_dissolved_organizations_daily',
  '17 3 * * *',                                   -- daily 03:17 UTC (off-peak)
  $job$ SELECT public.run_scheduled_purge_dissolved_organizations(25); $job$
);
```

- **Idempotent**: re-running the migration unschedules the previous job and reschedules under the same name.
- **Skips cleanly** when `pg_cron` is not installed (warning + manual trigger note).
- Manual trigger for ops: `SELECT public.run_scheduled_purge_dissolved_organizations(50);`

---

## 7. Verification (live DB)

Per [`LIVE_DB_DRIFT_GUARDRAIL.md`](./LIVE_DB_DRIFT_GUARDRAIL.md), the canonical state lives on the live database, not in repo SQL. After each migration in this stack, verify with:

```sql
-- 1. Soft-dissolve columns + indexes exist
SELECT column_name FROM information_schema.columns
 WHERE table_schema='public' AND table_name='organizations'
   AND column_name IN ('dissolved_at','dissolved_by','scheduled_purge_at');

-- 2. RPCs are SECURITY DEFINER + row_security off
SELECT proname, prosecdef, proconfig
  FROM pg_proc
 WHERE pronamespace = 'public'::regnamespace
   AND proname IN ('dissolve_organization',
                   'purge_dissolved_organization_data',
                   'run_scheduled_purge_dissolved_organizations');

-- 3. Cron job present
SELECT jobname, schedule, command FROM cron.job
 WHERE jobname = 'purge_dissolved_organizations_daily';

-- 4. RLS policy hides dissolved orgs from non-admin SELECTs
SELECT policyname, cmd, qual FROM pg_policies
 WHERE schemaname='public' AND tablename='organizations'
   AND policyname='organizations_select_hide_dissolved_restrictive';
```

---

## 8. DPO sign-off checklist

Before each material change to this flow, the DPO (or delegated reviewer) confirms:

- [ ] **Stage 1 transactional integrity** — membership removal, invitation removal, notification fan-out and `dissolved_at`/`scheduled_purge_at` write happen in one transaction. No partial state on RPC failure.
- [ ] **Owner-only enforcement** — `dissolve_organization` rejects non-owners with `forbidden_not_owner`. Verified for both Client and Agency org types.
- [ ] **Personal-data access during grace period** — manual login as a former member confirms: banner shows, Download personal data and Delete account routes succeed, dissolved org does not appear in any list.
- [ ] **Stripe cancellation** — verified end-to-end in a sandbox: subscription transitions to `canceled`; failure path leaves Stage 1 state intact.
- [ ] **Hard-purge dependency order** — manual `purge_dissolved_organization_data` on a seeded org leaves zero rows in any of the listed tables; audit/security_events keep rows with `org_id = NULL`; `image_rights_confirmations` keeps rows with `organization_id = NULL`; `used_trial_emails` untouched.
- [ ] **Idempotency** — re-running the purge RPC on an already-purged org returns `ok: true` and does not error.
- [ ] **Cron observability** — `cron.job_run_details` shows green runs daily; ops alerts wired for failed runs.
- [ ] **Notification copy** — `uiCopy.accountDeletion.dissolveOrgBanner*` keys reflect the actual scheduled purge date (`{purgeDate}` substitution).
- [ ] **No regression of `system-invariants.mdc` PAYWALL & ORG-WIDE ACCESS** — paywall continues to be org-resolved at the database; former members without an org are not blocked at the gate.

---

## 9. Files reference

| Concern | Path |
|---|---|
| Stage 1 RPC + schema columns + RLS | [`supabase/migrations/20260418_dissolve_organization_v2_softdissolve.sql`](../supabase/migrations/20260418_dissolve_organization_v2_softdissolve.sql) |
| Stage 2 hard-purge RPCs | [`supabase/migrations/20260418_purge_dissolved_organization_data.sql`](../supabase/migrations/20260418_purge_dissolved_organization_data.sql) |
| Daily cron job | [`supabase/migrations/20260418_purge_dissolved_organizations_cron.sql`](../supabase/migrations/20260418_purge_dissolved_organizations_cron.sql) |
| Stripe cancellation Edge function | [`supabase/functions/stripe-cancel-dissolved-org/index.ts`](../supabase/functions/stripe-cancel-dissolved-org/index.ts) |
| Frontend service wrappers | [`src/services/organizationsInvitationsSupabase.ts`](../src/services/organizationsInvitationsSupabase.ts) (`dissolveOrganization`, `cancelDissolvedOrgStripeSubscription`) |
| Banner component | [`src/components/OrgDissolvedBanner.tsx`](../src/components/OrgDissolvedBanner.tsx) |
| Action bus (decouples banner from workspace) | [`src/utils/orgDissolvedActionBus.ts`](../src/utils/orgDissolvedActionBus.ts) |
| Banner mount + notification fetch | [`App.tsx`](../App.tsx) |
| Workspace settings handlers | [`src/web/ClientWebApp.tsx`](../src/web/ClientWebApp.tsx), [`src/views/AgencyControllerView.tsx`](../src/views/AgencyControllerView.tsx) |
| UI copy keys | [`src/constants/uiCopy.ts`](../src/constants/uiCopy.ts) — `accountDeletion.dissolveOrg*` |
| Service unit tests | [`src/services/__tests__/organizationsInvitationsSupabase.test.ts`](../src/services/__tests__/organizationsInvitationsSupabase.test.ts) |

---

## 10. Related documents

- [`GDPR_DELETE_FLOW.md`](./GDPR_DELETE_FLOW.md) — Per-user account deletion (Edge function `delete-user`).
- [`DELETE_ORG_ACCOUNT_FLOW_AUDIT.md`](./DELETE_ORG_ACCOUNT_FLOW_AUDIT.md) — Pre-hardening audit of the dissolve & account deletion flow.
- [`GDPR_AUDIT_MEMO_2026.md`](./GDPR_AUDIT_MEMO_2026.md) — Full GDPR audit memo for 2026.
- [`DATA_RETENTION_POLICY.md`](./DATA_RETENTION_POLICY.md) — Project-wide retention windows.
- [`PAYWALL_SECURITY_SUMMARY.md`](./PAYWALL_SECURITY_SUMMARY.md) — How paywall resolution interacts with org membership.
