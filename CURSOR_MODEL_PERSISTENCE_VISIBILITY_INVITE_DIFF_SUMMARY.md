# Diff summary — model persistence / visibility / invite

## Services

- `src/services/modelPhotosSupabase.ts` — `rebuildPortfolioImagesFromModelPhotos`, `rebuildPolaroidsFromModelPhotos`; **fix** `getPhotosForModel` filter order (`photo_type` before `order`)
- `src/services/__tests__/modelPhotosSupabase.rebuildPortfolio.test.ts` — new tests

## UI

- `src/components/ModelMediaSettingsPanel.tsx` — reconcile after load; sync failure alerts; optional `onReconcileComplete`; rights checkbox copy + `rightsAuditWindowActive` + allow upload when recent audit exists
- `src/components/ModelEditDetailsPanel.tsx` — country / Near Me hint
- `src/views/AgencyControllerView.tsx` — `normalizeDocumentspicturesModelImageRef` on roster thumb; chest-first meta; `getPhotosForModel` for completeness; invite parsing + `buildModelClaimUrl`; `describeSendInviteFailure`; portfolio sync alert on add-model; `buildModelClaimUrl` import; add-model rights `uiCopy.legal`
- `src/web/ClientWebApp.tsx` — `ProjectDetailView` normalized portfolio URLs + lightbox

## Copy

- `src/constants/uiCopy.ts` — `modelMedia` sync failures, rights hints; `modelEdit.countryNearMeHint`; `modelRoster` invite notes

## Docs

- `docs/CLIENT_MODEL_PHOTO_VISIBILITY.md` — agency parity section
- `docs/MODEL_PROFILE_PERSISTENCE_AND_VISIBILITY.md` — new

## Not changed

- AuthContext, admin core, paywall, calendar_entries RLS, invite/claim architecture (only UX + parsing)
