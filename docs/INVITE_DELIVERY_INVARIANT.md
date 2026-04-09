# Invite Delivery Invariant

This document is the mandatory cross-family review guard for invite/link/claim flows.

## Covered Families

- Booker team invite (Agency Owner -> Booker)
- Employee team invite (Client Owner -> Employee)
- Model claim invite (Agency -> Model claim token)
- Legacy `agency_invitations` path (explicitly non-canonical, still reviewed)

## Canonical Delivery Chain

`token_create -> preview -> token_persist -> auth/session_finalize -> explicit_outcome`

Required behavior for every family:

1. Deterministic token creation or deterministic lookup.
2. Deterministic finalization after session/auth.
3. No silent failure states.
4. Correct fixed role/account context in UI.
5. Explicit user feedback for each branch.
6. Never show a success state unless email dispatch returns explicit `ok===true`.

## Outcome Contract

Allowed user-visible outcomes:

- `sent`
- `already_invited`
- `already_member`
- `token_created_mail_failed` (with manual fallback link when safe)
- `fatal`

Allowed finalization states:

- `success`
- `retryable`
- `fatal`
- `already_done`

Tokens are cleared only on `success`, `fatal`, or `already_done`.
Tokens stay persisted for `retryable`.

## Copy / Framing Rules

- Invite flows must be framed as joining an existing organization.
- No owner/self-service language in invite context.
- Model claim must remain distinct from team invites.
- Fixed role in invite context must be visible and non-editable.

## Cross-Family Review Checklist (Required)

When touching invite generation, dispatch, finalization, copy, or invite UI:

1. Verify Booker + Employee + Model claim all still satisfy the canonical chain.
2. Verify mail copy and UI copy stay aligned for each family.
3. Verify mail-delivery failure still keeps a usable fallback link where safe.
4. Verify no invite path silently degrades into normal self-service framing.
5. Verify persisted token survives signup, email confirmation, signin, reload/reopen.
6. Verify invite-first finalization ordering remains stable when invite + claim coexist.
7. Verify `already_*` and fatal states are explicit and not shown as generic unknown error.
8. Verify legacy `agency_invitations` callers are reviewed and documented as legacy.

## Implementation Anchors

- `src/services/finalizePendingInviteOrClaim.ts`
- `src/storage/inviteToken.ts`
- `src/storage/modelClaimToken.ts`
- `src/utils/inviteClaimRouting.ts`
- `src/services/organizationsInvitationsSupabase.ts`
- `src/services/inviteDelivery.ts`
- `src/views/AgencyControllerView.tsx`
- `src/components/ClientOrganizationTeamSection.tsx`
- `src/constants/uiCopy.ts`
- `supabase/functions/send-invite/index.ts`
