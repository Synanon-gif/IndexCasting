# CURSOR_FINAL_E2E_SMOKE_REPORT

**Date:** 2026-04-09  
**Scope:** Static code trace + targeted search + CI (Jest/typecheck/lint). No live browser/staging session was executed in this pass.

---

## 1. Executive Summary

The audited critical paths (Agency model add/edit, media mirrors, client discovery/package separation, invite/resend contracts, location writes, soft-remove/re-add) align with the previously hardened implementation documented in `CURSOR_FINAL_AGENCY_MODEL_LIFECYCLE_PLAN.json` (RC-1–RC-8). **No new code defects were found that justify a minimal product fix without either (a) a confirmed runtime failure or (b) a deliberate RPC/schema change** (e.g. discovery ranking / `get_discovery_models` body is P0 read-only).

Residual risk is **non-code**: full UI+E2E on staging/production was not run here; one **architectural display nuance** exists between ranked discovery (`models.city` from RPC) and Near Me (`location_city` from `get_models_near_location`).

---

## 2. Tested Flows (code-verified)

| ID | Flow | Primary evidence |
|----|------|------------------|
| A | Agency → new model (manual, email, portfolio, polaroids, location, territories, invite) | `AgencyControllerView.tsx` `handleAddModel`: `importModelAndMerge` → relationship RPCs → isolated invite block (`body?.ok === true`) → `upsertModelLocation` before photos → `rebuildPortfolioImagesFromModelPhotos` / `rebuildPolaroidsFromModelPhotos` when uploads occurred → `onRefresh` → form reset at end |
| B | Agency → edit → save → reopen | `handleSaveModel`: territories gate → `agency_update_model_full` → `upsertModelLocation('agency')` → awaited `onRefresh` (RC-8) → fresh model + `getPhotosForModel` for completeness |
| C | Media truth | `ModelMediaSettingsPanel`: `loadPhotos` → `rebuild*`; `syncPortfolio` / `syncPolaroids` on visibility; stable callback refs documented |
| D | Client → discover / detail / package | `ClientWebApp.tsx`: package mode swaps image source by `packageType`; `baseModels` guard for filters; `apiService.js` `getModelData` sets `polaroids: []` for discovery; detail uses explicit `measurements.chest` labels |
| E | Invite / claim / resend | `handleAddModel` invite: `generateModelClaimToken` + `send-invite` with `body?.ok === true`; `inviteDelivery.resendInviteEmail` same contract; `handleResendModelClaimInvite`: token regen (RC-6) + `resend.ok` branching; `finalizePendingInviteOrClaim.ts` uses RPC outcomes for `ok` |
| F | Location / Near Me | `get_models_near_location` mapping uses `location_city ?? city`; ranked discovery path uses `mapDiscoveryModelToSummary` with `m.city` only — matches `get_discovery_models` SQL (`m.*` / `models.city`, no `model_locations` join) |
| G | Soft-delete / re-add | `handleAddModel` merge branch: `agency_claim_unowned_model` then fallback `agency_update_model_full` for same-agency reactivation; `modelsSupabase` roster queries filter `active` / `pending_link` |

### Smoke matrix (1–7) — trace status

1. **NEW MODEL + PORTFOLIO + LOCATION + EMAIL** — Code path complete; invite non-blocking; mirrors rebuilt after uploads.  
2. **NEW MODEL + NO EMAIL** — No invite branch; creation/merge + location + photos unchanged.  
3. **EDIT + RELOAD** — Save awaits refresh; panel closes after success timer.  
4. **PORTFOLIO VS POLAROID** — Add flow sets portfolio client-visible, polaroids not; client discovery strips polaroids in `getModelData`; package mode selects column by type.  
5. **RESEND INVITE** — Valid token or regen; success only on `resend.ok`.  
6. **LOCATION SOURCE PRIORITY** — Enforced in SQL for Near Me / RPCs using `DISTINCT ON` + source order; **ranked discovery display uses `models.city` only** (by design of current `get_discovery_models`).  
7. **SOFT DELETE + RE-ADD** — Documented RPC sequence in add-merge path; no unique-collision fix needed in frontend from static review.

---

## 3. Confirmed Root Causes (this pass)

**None.** No additional root cause beyond those already recorded as fixed in `CURSOR_FINAL_AGENCY_MODEL_LIFECYCLE_PLAN.json`.

---

## 4. Fixes Implemented

**None** (no product source files changed). This pass was audit + documentation + CI only.

---

## 5. Explicitly Reviewed, Not Changed

- `AuthContext` / `bootstrapThenLoadProfile` — not opened for edits.  
- Paywall / `can_access_platform` — not modified.  
- Admin / `assert_is_admin` — not modified.  
- `calendar_entries` RLS migrations — not touched.  
- `get_discovery_models` / discovery scoring SQL — not touched (P0).  
- `booking_brief` trust model — not touched.  
- `finalizePendingInviteOrClaim` architecture — verified only.

---

## 6. Remaining Risks (real, bounded)

1. **Manual/staging E2E not executed** — Regression could still appear only under real network, RLS, or email provider behavior.  
2. **Discovery display city vs `model_locations`** — Ranked discovery JSON is built from `models` row (`city`); Near Me uses priority-resolved `location_city`. If `models.city` lags `model_locations`, cards could disagree between modes until data is aligned or RPC is extended (would touch discovery RPC → product/security review).  
3. **`handleSaveModel`** — On `agency_update_model_full` success, `upsertModelLocation` failure logs a warning but still shows overall save success; intentional non-blocking behavior, but operators should watch logs for persistence incidents.

---

## 7. Launch Assessment (these flows)

**Shippable from a static-audit perspective:** the traced contracts (invite `ok`, mirror rebuilds, polaroid stripping in discovery API, package typing) are coherent with documented invariants.

**Recommendation:** run a short **manual smoke** on staging (one add-model with photos, one edit-reload, one client discover card, one package open) before a high-stakes launch; this automated pass does not replace that.

---

## Closing classification

**FINAL E2E SMOKE PASS COMPLETE — MINOR RISKS REMAIN**
