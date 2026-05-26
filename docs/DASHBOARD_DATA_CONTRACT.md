# Dashboard data contract (Agency + Client)

## Summary chips (`DashboardSummaryBar`)

**Source of truth:** RPC `get_dashboard_summary(p_org_id, p_user_id)` via `getDashboardSummary()` in `src/services/dashboardSupabase.ts`.

| Chip | Meaning | DB rule |
|------|---------|---------|
| Open Requests | Active negotiations | `option_requests.status = 'in_negotiation'` — **excludes** `rejected`, `confirmed`, deleted rows |
| Unread chats | Distinct conversations with unread incoming messages | B2B + agency-model direct; **excludes** booking messages with `metadata.status` in `deleted`, `rejected` |
| Today's Events | Org-visible calendar rows for **today** | `user_calendar_events.date = CURRENT_DATE`; **not** `cancelled`; manual rows **or** synced rows with live non-rejected `option_request` |

**Client org scoping (open requests):** `COALESCE(client_organization_id, organization_id) = p_org_id` (migration `20261333`).

**Agency org scoping (open requests):** `agency_id = organizations.agency_id`.

**Not included:** Recruiting thread unread, option-request thread unread (separate Messages UI sections).

## Lifecycle → chip behaviour (must stay consistent)

| Event | Open Requests | Today's Events | Unread |
|-------|---------------|----------------|--------|
| **Created** (`in_negotiation`) | +1 if org-scoped | +1 when confirmed sync creates `user_calendar_events` for today | — |
| **Availability confirmed** (`final_status = option_confirmed`) | unchanged if still `in_negotiation` | +1 (sync trigger) | — |
| **Rejected** (`status → rejected`) | −1 (no longer `in_negotiation`) | −1 (`user_calendar_events.status = cancelled` + RPC excludes `rejected` link) | booking cards → `metadata.status = rejected` (excluded from unread) |
| **Deleted** (`delete_option_request_full`) | −1 (row removed) | −1 (`user_calendar_events` deleted) | booking cards → `metadata.status = deleted` |
| **Job confirmed** (`final_status = job_confirmed`) | −1 when `status` leaves `in_negotiation` | still counts today (job row, not cancelled) | — |
| **Counter accepted / price settled** | unchanged unless status changes | unchanged | — |

DB triggers: `fn_cancel_calendar_on_option_rejected`, `delete_option_request_full`, `sync_user_calendars_on_option_confirmed`, `sync_user_calendars_on_option_job_confirmed` (with `organization_id` — migration `20261332`).

## Action required — Billing

**Widget:** `BillingAttentionWidget` → `useBillingTabBadge` (`mode: detailed` on dashboard).

**Not the same as** Open Requests.

## Refresh triggers (frontend)

1. `dashboardSummaryReloadKey` bump (tab return to dashboard, negotiation success, delete/reject, mark-all-read, calendar create).
2. `useFocusVisibilityRefresh` in `DashboardSummaryBar` (window/tab focus).
3. `useOrgDashboardRealtimeBump` while org context is active (`option_requests`, `messages`, `manual_invoices`, `user_calendar_events`) — client listens on **both** `organization_id` and `client_organization_id`.

## RPC failure

`DashboardSummaryBar` keeps the last good summary when `getDashboardSummary` returns `null` (does not show fake zeros).

## Migrations (order)

1. `20261307` — unread workspace parity  
2. `20261332` — today events `organization_id` + sync triggers  
3. `20261333` — client org COALESCE + lifecycle filters for today/open  
