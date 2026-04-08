# Agency Ops Finalization — Verify

Manual / staging checks:

1. **Calendar — filter by model:** Enter text in “Filter by model”; list and month dots match filtered unified rows.
2. **Calendar — assignee:** Set “Mine” / “Unassigned” / specific team member; only matching rows remain (option + booking rows with resolvable assignee).
3. **Calendar — type:** Option / Casting / Booking pills exclude other kinds; manual events hidden when type ≠ All.
4. **Calendar — confirmed booking vs option:** Booking rows from `booking_events` appear in list when not deduped by calendar_entry option_request_id.
5. **Client assignment filter:** “My assigned clients” uses `client_assignment_flags.assigned_member_user_id` only — **no** RLS change; booking-only rows hidden when client scope ≠ All (expected).
6. **Agency Basic — seat cap:** With 2 members, new booker invite returns error and UI shows plan-limit copy.
7. **Agency Pro — cap 4:** Four members allowed; fifth invite/member rejected.
8. **Enterprise / admin override:** `get_agency_organization_seat_limit` returns null → unlimited path.
9. **Owner billing:** Owner sees upgrade + team note; booker still has no checkout (unchanged).
10. **Regression:** Log in as admin, agency owner, booker — no login/paywall order regression; `can_access_platform` unchanged.

**Automated:** `npm run typecheck`, `npm run lint`, `npm test -- --passWithNoTests --ci` — all green.

**Live DB:** `get_agency_organization_seat_limit` present post-migration.
