# Agency user limits & agency calendar filters

## Team size (agency orgs)

| Tier | Max `organization_members` (owner + bookers) |
|------|-----------------------------------------------|
| Trial / Basic | 2 |
| Pro | 4 |
| Enterprise | Unlimited (`NULL` in `get_agency_organization_seat_limit`) |
| Admin paywall bypass | Unlimited |

**Source of truth:** `public.get_agency_organization_seat_limit(uuid)` (SECURITY DEFINER, `row_security off`) and triggers:

- `trg_enforce_agency_org_member_seat_limit` on `organization_members` (BEFORE INSERT, agency orgs only)
- `trg_enforce_agency_org_invitation_seat_limit` on `invitations` (BEFORE INSERT, agency + role `booker`; counts non-expired `pending` invites toward the cap)

Migration: `supabase/migrations/20260510_agency_org_seat_limits.sql`.

Frontend: `getAgencyOrganizationSeatLimit()` for display; `createOrganizationInvitation` surfaces `agency_member_limit_reached` when the DB rejects the insert.

**Paywall order unchanged:** `can_access_platform()` is still the access gate; seat limits are orthogonal billing/plan constraints on org size.

## Agency calendar filters

Merged data: option requests + `calendar_entries`, `booking_events` (via `getBookingEventsAsCalendarEntries`), and manual org events. Implementation: `src/utils/agencyCalendarUnified.ts` and `AgencyCalendarTab` in `src/views/AgencyControllerView.tsx`.

Filters apply to the **merged** row set (month grid + list). They do **not** change RLS or org-wide visibility — only which rows the user chooses to display.

## Manual verification

1. Agency Basic: with owner + one booker, inviting another booker fails with plan-limit messaging.
2. Agency Pro: up to four members total per org cap.
3. Calendar: type / assignee / client-assignment / urgency filters change the list and month dots together.
4. Login, Admin dashboard, and `can_access_platform` behavior unchanged after deploy.
