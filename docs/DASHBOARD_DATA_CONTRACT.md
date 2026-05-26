# Dashboard data contract (Agency + Client)

## Summary chips (`DashboardSummaryBar`)

**Source of truth:** RPC `get_dashboard_summary(p_org_id, p_user_id)` via `getDashboardSummary()` in `src/services/dashboardSupabase.ts`.

| Chip | Meaning | DB rule |
|------|---------|---------|
| Open Requests | Active negotiations | `option_requests.status = 'in_negotiation'` scoped by agency `agency_id` or client `organization_id` |
| Unread chats | Distinct conversations with unread incoming messages | B2B + agency-model direct; excludes terminal booking metadata `deleted`/`rejected` |
| Today's Events | Org-visible calendar rows for **today** | `user_calendar_events.date = CURRENT_DATE`, not cancelled; `organization_id = org` **or** legacy synced row party match (migration `20261332`) |

**Not included:** Recruiting thread unread, option-request thread unread (separate Messages UI sections).

## Action required — Billing

**Widget:** `BillingAttentionWidget` → `useBillingTabBadge` (`mode: detailed` on dashboard).

**Not the same as** Open Requests. Billing signals come from `deriveBillingAttention` / `get_billing_attention_counts` (invoices, profiles, settlements).

## Refresh triggers (frontend)

1. `dashboardSummaryReloadKey` bump (tab return to dashboard, negotiation success, mark-all-read, calendar create).
2. `useFocusVisibilityRefresh` in `DashboardSummaryBar` (window/tab focus).
3. `useOrgDashboardRealtimeBump` while dashboard tab active (option_requests, messages, manual_invoices, user_calendar_events).

## Common false “stale” reports

- **Today = 0 but Calendar shows events:** fixed by `20261332` (synced rows missing `organization_id`).
- **Unread = 0 while on Dashboard, message arrives:** fixed by org-level realtime bump (Messages tab unmounts per-thread subs).
- **Billing widget persists after fix:** bump `reloadKey` + refresh on dashboard tab; complete action in Billing tab then return to dashboard.
