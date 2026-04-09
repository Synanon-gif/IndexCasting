# Full Agency Model Consistency Report

**Date:** 2026-05-18
**Status:** FULL AGENCY MODEL CONSISTENCY FIXED

---

## Executive Summary

Comprehensive consistency pass across the entire Agency Model lifecycle.
The root cause blocker (`admin_find_model_by_email` in agency flow) was already confirmed fixed.
This pass identified and fixed 14 additional issues across media normalization, location persistence,
upload parity, soft-delete reactivation, reload truth, and cursor rules hardening.

---

## Fixed Root Causes (Already Confirmed)

1. **`admin_find_model_by_email` replaced** — Agency flows now use `agency_find_model_by_email` (agency-scoped RPC with org-membership guard)
2. **23505 defense-in-depth** — `importModelAndMerge` handles unique constraint violations with retry
3. **Soft-removed reactivation** — `agency_find_model_by_email` includes `ended` models for re-activation
4. **`agency_claim_unowned_model`** fallback path for re-adding ended models

---

## All Similar Patterns Found and Fixed (This Pass)

### P1 — Admin-RPC Misuse
| Finding | Action |
|---------|--------|
| `flagModelAsMinor` calls `admin_update_model_minor_flag` from non-admin context | Marked `@deprecated` with documentation (no callers exist) |
| Test comment references old `admin_find_model_by_email` | Updated to `agency_find_model_by_email` |
| Several `.insert()` without 23505 handling (recruiting, consent, projects) | Documented as low-risk (no email unique constraints); new stop-condition in auto-review |

### P3 — Media / URL Normalization
| Finding | Action |
|---------|--------|
| `CustomerSwipeScreen` renders gallery URLs without normalization | Added `normalizeDocumentspicturesModelImageRef` in `mapDiscoveryModel` |
| `OrgMessengerInline` package thumbs lack normalization | Added normalization at fetch time |
| `AgencyOrgProfileScreen` cover URI not normalized | Added `normalizeDocumentspicturesModelImageRef` before render |

### P4 — Location Persistence
| Finding | Action |
|---------|--------|
| Add-Model flow writes city/country to `models` but no `model_locations` row | Added `upsertModelLocation('agency')` with geocoding after model creation |
| `handleSaveModel` ignores `upsertModelLocation` return value | Now logs warning on failure |

### P6 — Upload Parity
| Finding | Action |
|---------|--------|
| `uploadApplicationImage`: legacy HEIC handler (no abort), no extension check | Upgraded to `convertHeicToJpegWithStatus` + `checkExtensionConsistency` |
| `uploadDocument`: no extension consistency check | Added `checkExtensionConsistency` for File objects |
| `submitVerification`: no extension check, custom sanitizer | Added `checkExtensionConsistency` + replaced with `sanitizeUploadBaseName` |
| `organizationGallerySupabase` and `organizationLogoSupabase` missing from audit allowlist | Added to `STORAGE_UPLOAD_ALLOWLIST` |

### P7 — Soft Delete / Reactivation
| Finding | Action |
|---------|--------|
| `agency_relationship_ended_at` not cleared on reactivation (COALESCE can't pass NULL) | SQL migration: auto-clear when status becomes `active` or `pending_link` |
| Two competing `agency_remove_model` definitions in root SQL | Live-verified: deployed version correctly sets `status='ended'` (not `agency_id=NULL`), deletes territories |

### P8 — Reload Truth
| Finding | Action |
|---------|--------|
| Sync feedback uses stale `models` closure in setTimeout | Replaced with `await onRefresh()` + fresh fetch from DB |
| `focusModelId` effect missing `models` in dependencies | Added `models` to deps; only consume focus when model found |
| Feedback timers (save, sync, bulk, territory) lack ref cleanup | Added `useRef` pattern with `clearTimeout` before new timer |

### P9 — Rules / Docs
| Finding | Action |
|---------|--------|
| No rule against admin-RPC misuse in non-admin flows | Added stop-condition in auto-review.mdc (Risiko 18) |
| No invariant for deterministic create-vs-merge | Added to system-invariants.mdc + .cursorrules §27.12 |
| No persistence invariant for agency model lifecycle | Added to system-invariants.mdc + .cursorrules §27.13 |

---

## Verified (No Fix Needed)

- Discovery correctly uses only `portfolio_images` (never `polaroids`)
- RLS blocks polaroid rows for clients (`photo_type = 'portfolio'` enforced)
- Package mode correctly distinguishes `packageType` (portfolio vs polaroid)
- Completeness checks `model_photos` (not just mirror columns)
- `ModelMediaSettingsPanel` uses stable refs (no request storms)
- Invite flows (Booker, Employee, Model-Claim) use unified `send-invite` edge function
- `finalizePendingInviteOrClaim` centralizes accept logic with idempotency
- Resend invite works for all three flows
- Source priority `live > current > agency` preserved in all location paths

---

## Residual Risks (Documented, Not Fixed)

1. **`agency_remove_model` live version uses legacy email-based auth guard** — should be migrated to org-membership pattern; out of scope for this pass
2. **Import path writes `portfolio_images` mirror without `model_photos` rows** — by design; MediaPanel reconciles on open
3. **`p_country` text column not sent from agency UI** — `country_code` is authoritative; low priority
4. **AuthContext finalize without UI alerts** — by design (auth boot must not block); URL-token path in App.tsx has alerts
5. **Double roster fetch on mount + tab switch** — idempotent, only perf overhead

---

## Explicitly Not Changed

- AuthContext core / bootstrapThenLoadProfile
- Paywall core ordering / can_access_platform
- Admin core and assert_is_admin rules
- Discovery ranking / scoring
- booking_brief trust model
- calendar_entries RLS
- Existing RLS policies (no new policies created)
- Typography / UI styling
