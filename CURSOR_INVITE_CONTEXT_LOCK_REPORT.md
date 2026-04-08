# CURSOR_INVITE_CONTEXT_LOCK_REPORT

## 1. Executive Summary

Invite- und Model-Claim-Flows sind textlich und in der Auth-Maske stärker von normalem Self-Service-Sign-up getrennt. Nach erfolgreicher `finalizePendingInviteOrClaim`-Finalisierung (RPC-Erfolg) zeigt die App ein einmaliges, verwerfbares Success-Banner mit rollen- und org-spezifischer Copy, aufgelöst über RLS-konforme Reads.

## 2. Invite-vs-normal-signup differences clarified

- **Gate:** `InviteAcceptanceScreen` nutzt kanonischen Satz „You were invited to join {org} as {role}“ plus Hinweis, dass es keine normale Org-Erstellung ist.
- **Model claim:** `ModelClaimScreen` erklärt explizit, dass es um **Profil-Claim** geht, nicht um Booker/Employee-Teambeitritt.
- **Auth:** Bei `inviteAuth` / `modelClaimAuth` anderer Subtitle („completing an invitation“); Invite-Zeile mit fester Rolle (`inviteRoleLockedLine`).

## 3. Role selection findings

- Freie Rollen-Pills waren bereits ausgeblendet, wenn Invite oder Model-Claim aktiv sind.
- **Gap behoben:** Statt nur „Account type: Agency/Client“ zeigt die Invite-Maske jetzt **Booker/Employee-Label** explizit neben dem Kontotyp.

## 4. Success-state UX introduced

- `finalizePendingInviteOrClaim` setzt nach `onSuccessReloadProfile` `emitInviteClaimSuccess` mit `organizationId` bzw. `modelId`/`agencyId`.
- `App.tsx` abonniert den Bus, baut den Text via `resolveInviteClaimSuccessMessage` (Org-Name, `organization_members.role` für Booker/Employee; Agency-Name für Claim).
- Banner: `InviteClaimSuccessBanner` über Haupt-Shell, Legal- und Pending-Screens; Deduplizierung 4s pro Payload-Key.

## 5. What was fixed

- Neue/angepasste Keys in `uiCopy` (invite, modelClaim, auth, `inviteClaimSuccess`).
- Screens: `InviteAcceptanceScreen`, `ModelClaimScreen`, `AuthScreen`.
- Service: `finalizePendingInviteOrClaim` (Metadaten + Emit-Reihenfolge nach Reload).
- Neu: `inviteClaimSuccessBus.ts`, `inviteClaimSuccessUi.ts`, `InviteClaimSuccessBanner.tsx`.
- Tests: `finalizePendingInviteOrClaim.test.ts` (Emit + Branch-Felder).

## 6. Rules decision

- Additiv in `.cursorrules`, `auto-review.mdc`, `system-invariants.mdc` (FRONTEND-GARANTIEN), `invite-finalization.mdc`, `docs/INVITE_CLAIM_ASSIGNMENT_CONSISTENCY.md`.

## 7. Why auth/security core stayed untouched

- Keine Änderungen an `bootstrapThenLoadProfile`, Admin-RPCs, Paywall oder `get_my_org_context`.
- Finalisierung bleibt session- und token-getrieben; Banner ist rein informativ nach RPC-Erfolg.

## 8. What users should now clearly understand

- Team-Einladung = fester Platz als Booker oder Employee in bestehender Org, kein Owner-Self-Bootstrap.
- Model-Link = Profil mit Account verbinden, kein Agency/Client-Team-Invite.
- Erfolgsmeldung erscheint erst, wenn die Einladung/der Claim **serverseitig** durch ist.
