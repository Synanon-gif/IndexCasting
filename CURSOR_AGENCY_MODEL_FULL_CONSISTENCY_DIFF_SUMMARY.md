# Full Agency Model Consistency — Diff Summary

**Date:** 2026-05-18

## Changed Files

### TypeScript (src/)

| File | Change |
|------|--------|
| `src/services/gdprComplianceSupabase.ts` | `flagModelAsMinor` marked `@deprecated` (admin-RPC in non-admin context) |
| `src/services/__tests__/modelsImportSupabase.importModelAndMerge.test.ts` | Test comment updated: `admin_find_model_by_email` → `agency_find_model_by_email` |
| `src/screens/CustomerSwipeScreen.tsx` | Added `normalizeDocumentspicturesModelImageRef` to `mapDiscoveryModel` gallery mapping |
| `src/components/OrgMessengerInline.tsx` | Added URL normalization for package model photo thumbnails |
| `src/screens/AgencyOrgProfileScreen.tsx` | Added URL normalization for model cover images |
| `src/views/AgencyControllerView.tsx` | (1) Add-Model: `upsertModelLocation('agency')` after creation with geocoding, (2) Save: warn-log on `upsertModelLocation` failure, (3) Sync feedback: replaced stale setTimeout with await+fresh fetch, (4) focusModelId: added `models` to deps, (5) Feedback timers: useRef pattern with clearTimeout |
| `src/services/applicationsSupabase.ts` | Upgraded HEIC handling to `convertHeicToJpegWithStatus` (abort on failure), added `checkExtensionConsistency` |
| `src/services/documentsSupabase.ts` | Added `checkExtensionConsistency` for File uploads |
| `src/services/verificationSupabase.ts` | Added `checkExtensionConsistency`, replaced custom sanitizer with `sanitizeUploadBaseName` |

### SQL (supabase/migrations/)

| File | Change |
|------|--------|
| `supabase/migrations/20260518_agency_update_model_full_clear_ended_at_on_reactivation.sql` | `agency_relationship_ended_at` auto-cleared when status set to `active` or `pending_link` |

### Scripts

| File | Change |
|------|--------|
| `scripts/audit-coverage.mjs` | Added `organizationGallerySupabase.ts` and `organizationLogoSupabase.ts` to `STORAGE_UPLOAD_ALLOWLIST` |

### Rules / Docs

| File | Change |
|------|--------|
| `.cursorrules` | Added §27.11 (Role-scoped Lookup), §27.12 (Create-vs-Merge), §27.13 (Persistence Invariant) |
| `.cursor/rules/auto-review.mdc` | Added stop-conditions: Risiko 18 (admin-RPC misuse), Risiko 19 (INSERT without 23505 recovery) |
| `.cursor/rules/system-invariants.mdc` | Added ROLE-SCOPED LOOKUP, DETERMINISTIC CREATE-VS-MERGE, AGENCY MODEL PERSISTENCE invariants |

## No Changes Made

- AuthContext, bootstrapThenLoadProfile, paywall, admin core, discovery ranking, booking_brief, calendar_entries RLS
