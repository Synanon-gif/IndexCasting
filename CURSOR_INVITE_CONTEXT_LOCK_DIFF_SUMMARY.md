# CURSOR_INVITE_CONTEXT_LOCK_DIFF_SUMMARY

| File | Purpose | Risk | Test linkage |
|------|---------|------|----------------|
| `src/constants/uiCopy.ts` | Kanonische Copy, Success-Strings | Low — nur Text | Manual / UI |
| `src/screens/InviteAcceptanceScreen.tsx` | Gate: Join-as + Not-self-service | Low | Manual |
| `src/screens/ModelClaimScreen.tsx` | Claim vs Team-Invite | Low | Manual |
| `src/screens/AuthScreen.tsx` | Invite/Claim Subtitle + Role-Lock-Copy | Low | Manual |
| `src/services/finalizePendingInviteOrClaim.ts` | Metadaten, Emit nach Reload | Medium — zentraler Flow | `finalizePendingInviteOrClaim.test.ts` |
| `src/utils/inviteClaimSuccessBus.ts` | Pub/sub für Banner | Low | Mocked in finalize test |
| `src/services/inviteClaimSuccessUi.ts` | Banner-Text aus DB | Low — RLS wie restliche App | Manual |
| `src/components/InviteClaimSuccessBanner.tsx` | UI | Low | Manual |
| `App.tsx` | Subscribe, Banner, Dedup | Low | Manual |
| `src/services/__tests__/finalizePendingInviteOrClaim.test.ts` | Emit + Felder | — | Jest |
| `.cursorrules`, `.cursor/rules/*`, `docs/*` | Guardrails | None | Review |
