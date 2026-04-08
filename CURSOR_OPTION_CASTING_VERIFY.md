# CURSOR_OPTION_CASTING_VERIFY

Manual checks after deploy (staging or production). Automated: `npm run typecheck`, `npm run lint`, `npm test -- --passWithNoTests --ci`.

## Option request creation

- [ ] **Global discovery:** Client logged in with org → Discover → open model → send option/casting request → thread opens in Messages; row appears for agency.
- [ ] **Shared project mode:** Open own project in Discover (`isSharedMode`) → request from project model → `project_id` populated as expected.
- [ ] **Package context:** Open package as client → request → B2B booking card metadata includes package source when applicable (`booking` message).
- [ ] **Read-only shared link:** Open `SharedSelectionView` / `?shared=1&…` → **no** option request / no auth flows that create `option_requests`.

## Routing & resolution

- [ ] **Territory / agency:** Model with territory → request routes to correct agency; missing territory + no `agency_id` shows existing alert (no silent wrong agency).
- [ ] **Org columns:** New `option_requests` row has `organization_id`, `client_organization_id`, and `agency_organization_id` when client org + agency org exist in DB.

## Communication

- [ ] **B2B booking card:** After submit, client↔agency conversation shows booking-type message with date/model/country.
- [ ] **Option thread:** Messages in option thread sync; agency and client see same thread id (`option_requests.id`).

## Negotiation

- [ ] **Counter offer:** Agency counter → client sees counter + can accept/reject.
- [ ] **Client accept counter:** Moves to confirmed path; calendar behavior matches environment (trigger-created entry).
- [ ] **Agency accept / model approval:** Linked model must approve where required; unlinked model path confirms without model app.

## Calendar & job

- [ ] **Option → calendar:** After confirmation, calendar shows expected entry (type/color consistent with `calendarColors` for entry types).
- [ ] **Job confirm:** Client job confirm updates calendar to job styling where implemented; no duplicate phantom rows (dedupe by `option_request_id` still sane).

## Search & deep link

- [ ] **Agency global search:** Type query → select option result → Messages opens correct thread (`pendingOptionRequestId` consumed).

## Notes

- [ ] **Shared notes:** Append shared note on option-linked entry → visible to parties per RLS.
- [ ] **Private notes:** Agency/client/model private fields stay scoped.

## Conflict & security

- [ ] **Conflict warning:** Submit option on date with existing booking → **warning only**, submit still allowed (fail-open).
- [ ] **No org leaks:** Agency A does not see Agency B option rows in search or lists.
- [ ] **No email matching** in new code paths (unchanged invariant).
- [ ] **Paywall:** Gated actions still blocked when org has no access (no frontend-only bypass introduced).

## Regression guard

- [ ] **Admin login:** Brother’s admin account still signs in and reaches admin dashboard (no `AuthContext`/`App.tsx` edits in this work).
- [ ] **Messages pills:** Option thread status colors still readable in light theme (Client + Agency).
