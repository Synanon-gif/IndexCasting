# Agency Ops Finalization — Diff Summary

## P1 — My Models / Dashboard

- `AgencyControllerView.tsx`: `refreshAgencyModelLists` updates `fullModels` and lightweight `models` together; `onRefresh` for My Models uses it; initial load and myModels tab effect aligned.

## P2 — Calendar

- New `src/utils/agencyCalendarUnified.ts`: build/filter unified rows, `eventsByDate` from filtered set.
- `AgencyControllerView.tsx` `AgencyCalendarTab`: new filters (type, assignee, client scope, urgency), merged list for upcoming rows, `teamMembers` + `currentUserId` props.

## P3 — Seat limits

- `supabase/migrations/20260510_agency_org_seat_limits.sql`: RPC + two triggers (deployed HTTP 201).
- `subscriptionSupabase.ts`: `maxAgencyMembers` on `PlanLimits`, `getAgencyOrganizationSeatLimit`.
- `organizationsInvitationsSupabase.ts`: `CreateOrganizationInvitationResult` discriminated union.

## P4 — Paywall / copy

- `planFeatures.ts`, `PaywallScreen.tsx`, `uiCopy.ts`, `OwnerBillingStatusCard.tsx`.

## P5 — Docs / rules

- `docs/AGENCY_USER_LIMITS_AND_CALENDAR_FILTERS.md`, `.cursorrules`, `system-invariants.mdc`, `auto-review.mdc`.

## Tests

- `subscriptionSupabase.test.ts`, `planFeatures.test.ts` mock updated.
