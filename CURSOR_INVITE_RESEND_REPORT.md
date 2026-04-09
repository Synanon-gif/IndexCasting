# Invite Re-send UX Report

## Scope implemented
- Added invite re-send service support without changing invite creation, finalization, RLS, or schema.
- Added re-send buttons for pending Booker and Employee invites.
- Added model-claim re-send using existing active claim tokens only.
- Added centralized copy keys for resend loading/success/error states.

## Files changed
- `src/services/inviteDelivery.ts`
- `src/views/AgencyControllerView.tsx`
- `src/components/ClientOrganizationTeamSection.tsx`
- `src/constants/uiCopy.ts`

## Guardrail compliance
- No new token generation in any resend path.
- No new invitation row creation or invite status mutation.
- No changes to `finalizePendingInviteOrClaim`.
- No DB migration or RLS change.
- Success feedback is shown only when Edge Function response is `ok === true`.

## Functional notes
- Re-send uses existing `send-invite` Edge Function with original token.
- Failures show mapped delivery error and fallback link.
- UI includes short anti-spam cooldown and disable state per row.
- Model claim fallback keeps manual claim-link visibility.
