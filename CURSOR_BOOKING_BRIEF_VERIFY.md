# CURSOR_BOOKING_BRIEF_VERIFY

Manual checks (staging or production) after deploy:

1. **Structured brief:** Open an option-linked calendar booking on **Agency**, **Client (web)**, and **Model** — fill shoot details / call time, tap **Save brief**, reload — values persist.
2. **Shared vs private:** Set a field to “everyone on this booking”; confirm another party sees it. Set another field to “agency only” (or client/model only); confirm only that role sees it in the UI.
3. **Agency / Client / Model:** Repeat visibility checks for each role as viewer.
4. **No contradictory UI:** Brief section sits above shared notes; legacy private notes and `shared_notes` timeline still work.
5. **No visibility regression:** Calendar RLS / who can open the row unchanged; no new policies added.
6. **No Auth/Admin/Paywall regression:** Smoke-test admin login and normal agency/client/model login; no changes to those files in this feature.

Automated (local):

- `npm run typecheck`
- `npm run lint`
- `npm test -- --passWithNoTests --ci`
- `npm test -- --testPathPattern=bookingBrief --ci`

**Edge case:** `booking_events` row without matching `calendar_entries` row — brief not shown (documented in `docs/BOOKING_BRIEF_SYSTEM.md`).
