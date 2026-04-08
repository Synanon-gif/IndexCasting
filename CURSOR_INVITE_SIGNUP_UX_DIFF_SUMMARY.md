# Invite Signup UX — Diff summary

| File | Purpose | Risk |
|------|---------|------|
| [`src/constants/uiCopy.ts`](src/constants/uiCopy.ts) | New/updated copy for auth, invite gate, model claim gate | Low |
| [`src/screens/AuthScreen.tsx`](src/screens/AuthScreen.tsx) | Post-signup session check, awaiting-email panel, uiCopy for placeholders/subtitle/banner | Low — no change to `signUp` API |
| [`src/screens/InviteAcceptanceScreen.tsx`](src/screens/InviteAcceptanceScreen.tsx) | Next-step hint text | Low |
| [`src/screens/ModelClaimScreen.tsx`](src/screens/ModelClaimScreen.tsx) | Next-step hint text | Low |
| [`src/components/ClientOrganizationTeamSection.tsx`](src/components/ClientOrganizationTeamSection.tsx) | `invite_role` in `send-invite` body | Low |
| [`src/views/AgencyControllerView.tsx`](src/views/AgencyControllerView.tsx) | Explicit `invite_role: 'booker'` | Low |
| [`supabase/functions/send-invite/index.ts`](supabase/functions/send-invite/index.ts) | `invite_role`, org email copy | Low — deploy required |
| [`docs/INVITE_CLAIM_ASSIGNMENT_CONSISTENCY.md`](docs/INVITE_CLAIM_ASSIGNMENT_CONSISTENCY.md) | Document payload + UX | None |
| [`.cursor/rules/auto-review.mdc`](.cursor/rules/auto-review.mdc) | Review guardrail | None |

## Test linkage

- Automated: `npm run typecheck`, `npm run lint`, `npm test -- --passWithNoTests --ci` (workspace default suite).  
- No new unit tests added (copy/UI only); manual checks in `CURSOR_INVITE_SIGNUP_UX_VERIFY.md`.
