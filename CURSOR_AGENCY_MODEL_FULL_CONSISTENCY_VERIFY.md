# Full Agency Model Consistency — Verify Matrix

**Date:** 2026-05-18

## A. Add / Merge

| # | Check | Method | Result |
|---|-------|--------|--------|
| 1 | Add model with new email | Code-trace: `importModelAndMerge` INSERT path + `upsertModelLocation('agency')` | PASS |
| 2 | Add model with existing same email | Code-trace: `agency_find_model_by_email` → merge path | PASS |
| 3 | No admin-only RPC misuse in normal agency flow | Grep: only `flagModelAsMinor` (dead code, marked deprecated) | PASS |
| 4 | No 409 dead-end on same email | 23505 retry with re-lookup in `importModelAndMerge` | PASS |
| 5 | Soft-removed re-add path behaves correctly | `agency_find_model_by_email` includes ended + claim/reactivate + `ended_at` auto-clear | PASS |

## B. Media

| # | Check | Method | Result |
|---|-------|--------|--------|
| 6 | Portfolio upload persists after reopen | `ModelMediaSettingsPanel` → `model_photos` + mirror sync | PASS |
| 7 | Agency sees own uploaded image after reopen | `loadPhotos` + `rebuildPortfolioImagesFromModelPhotos` on panel open | PASS |
| 8 | Completeness warning matches actual state | `model_photos` query with `photo_type='portfolio'` + `is_visible_to_clients` | PASS |
| 9 | Client sees eligible portfolio image | Discovery RPC → `portfolio_images` mirror, all URLs normalized | PASS |
| 10 | Standard discovery does not show polaroids | `polaroids: []` in all mappers + RLS policy enforces `photo_type='portfolio'` | PASS |
| 11 | Polaroids only appear in intended package flow | `packageType === 'polaroid'` gate in GuestView + ClientWebApp | PASS |

## C. Location

| # | Check | Method | Result |
|---|-------|--------|--------|
| 12 | Location persists after save/reload | `agency_update_model_full` + `upsertModelLocation('agency')` with return check | PASS |
| 13 | Agency sees latest location values after reopen | `buildEditState` from `models.*` + badge from `getModelLocation` | PASS |

## D. Invite

| # | Check | Method | Result |
|---|-------|--------|--------|
| 14 | Add model with email triggers proper invite chain | `generateModelClaimToken` + `send-invite` edge function | PASS |
| 15 | Resend invite works | `resendInviteEmail` + token query from `model_claim_tokens` | PASS |
| 16 | Correct UI copy in invite context | English-only, role-specific (booker/employee/model-claim) | PASS |
| 17 | No false success without ok === true | `.then(ok)` pattern, no optimistic fake | PASS |

## E. Lifecycle

| # | Check | Method | Result |
|---|-------|--------|--------|
| 18 | End representation / soft delete behaves consistently | Live-verify: `agency_remove_model` sets `status='ended'`, deletes territories | PASS |
| 19 | Reload preserves truthful state | `refreshAgencyModelLists` + `buildEditState` + fresh fetch for sync feedback | PASS |
| 20 | No request storms / no repeated uncontrolled fetch loops | Stable refs in MediaPanel, timer refs in AgencyControllerView | PASS |

## F. Upload Parity

| # | Check | Method | Result |
|---|-------|--------|--------|
| 21 | Application uploads: HEIC abort + extension check | `convertHeicToJpegWithStatus` + `checkExtensionConsistency` | PASS |
| 22 | Document uploads: extension check | `checkExtensionConsistency` added | PASS |
| 23 | Verification uploads: extension check + standard sanitizer | `checkExtensionConsistency` + `sanitizeUploadBaseName` | PASS |
| 24 | Audit allowlist complete | `organizationGallerySupabase` + `organizationLogoSupabase` added | PASS |

## G. SQL Migration

| # | Check | Method | Result |
|---|-------|--------|--------|
| 25 | `agency_update_model_full` deployed with ended_at reset | Migration pushed, HTTP:201, verify query confirms function exists | PASS |
| 26 | `agency_remove_model` live version consistent | `pg_get_functiondef` returns soft-delete version (status='ended', territories deleted) | PASS |
