# CURSOR_AGENCY_OPS_FINALIZATION_REPORT

## 1. Executive Summary

Agency operations pass completed: My Models refresh keeps dashboard and roster in sync; agency calendar uses a merged dataset with real filters (type, assignee, client-assignment scope, action-needed); agency team size is enforced in PostgreSQL (members + pending booker invites) with UI mirroring and plan copy updates. Auth, admin login, `get_my_org_context`, and `can_access_platform` ordering were not modified.

## 2. My Models / Dashboard

- **Issue:** `onRefresh` only refreshed `fullModels`, not the dashboard `models` array.
- **Fix:** Central `refreshAgencyModelLists()` loads both `getModelsForAgencyFromSupabase` and `getAgencyModels` with the same mapping used on initial load.

## 3. Calendar filter design and implementation

- **Module:** `src/utils/agencyCalendarUnified.ts` builds rows from option items, standalone booking calendar entries (deduped by `option_request_id` like before), and manual events.
- **Filters:** Model name + date range (existing); entry type; assignee (all / unassigned / mine / per-member); client assignment scope (all / mine / unassigned — option rows only); urgency (action-needed uses `deriveSmartAttentionState` for agency; tentative booking rows for booking kind).
- **UI:** `AgencyCalendarTab` receives `teamMembers` and `currentUserId`; month grid and list use the same filtered unified set.

## 4. Agency plan / user limit enforcement

- **RPC:** `get_agency_organization_seat_limit(p_organization_id)` — trial/basic 2, pro 4, enterprise `NULL`, admin bypass `NULL`; conservative default when no active subscription row.
- **Triggers:** `organization_members` BEFORE INSERT (agency only); `invitations` BEFORE INSERT (agency + booker + pending capacity includes non-expired pending invites).
- **Frontend:** `createOrganizationInvitation` returns `{ ok, invitation? | error }`; team tab shows seat usage via `getAgencyOrganizationSeatLimit`.

## 5. Paywall / billing communication

- Agency plan cards and `planFeatureLines` include team-member bullets; trial context uses `billingAudience` so client orgs do not see agency seat lines in the owner card.
- `OwnerBillingStatusCard` (agency variant): short note on team limits vs billing vs booker usage.

## 6. Rules / docs

- `.cursorrules`, `system-invariants.mdc`, `auto-review.mdc` updated with agency seat caps and “filters are not security” guardrails.
- `docs/AGENCY_USER_LIMITS_AND_CALENDAR_FILTERS.md` added.

## 7. Why Auth / Admin / Login stayed safe

- No edits to `AuthContext.tsx`, `bootstrapThenLoadProfile`, sign-in flow, or `get_my_org_context`.
- No changes to `can_access_platform()` body or ordering.
- New triggers scope to agency orgs and invitations; client org invites unchanged.

## 8. Next safe steps

- Optional: extend booking rows with client org resolution for client-scope filters when product needs it.
- Monitor PostgREST error payloads for invite failures to ensure `agency_member_limit_reached` always surfaces in `error.message` for all clients.
