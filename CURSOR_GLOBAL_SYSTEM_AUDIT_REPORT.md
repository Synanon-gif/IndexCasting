# CURSOR_GLOBAL_SYSTEM_AUDIT_REPORT.md

## 1. Executive summary

This pass executed a **targeted global audit** of IndexCasting against the P0–P8 checklist in the approved plan: pattern scans, lifecycle tracing, and deep reads on media, location, invites, auth, and UI state. **Three concrete code fixes** landed in `AgencyControllerView.tsx` to enforce **model_photos → mirror parity** after agency “Add model” uploads, to **heal polaroid mirrors** during the existing roster refresh pass, and to **eliminate a silent failure** when re-activating a merged model via `agency_update_model_full` after a failed `agency_claim_unowned_model`.

Remaining risk is **moderate/low**: widespread intentional `void … .then(…)` for secondary reads, **email “delivery”** semantics (provider acceptance ≠ inbox), and one **location write** path that still only logs on failure. No new Cursor rules were added (P9); existing `docs/MODEL_PROFILE_PERSISTENCE_AND_VISIBILITY.md` and workspace invariants already state the media SoT contract.

## 2. Issue counts

| Severity  | Count | In this pass |
|-----------|-------|----------------|
| Critical  | 1     | 1 fixed (polaroid mirror gap after Add) |
| Moderate  | 3     | 2 fixed (merge RPC check, roster dual rebuild); 1 documented (location warn-only) |
| Low       | 3     | Accepted/documented (fire-and-forget secondary loads, GuestChatView catch, invite semantics) |

**Totals:** 7 findings in structured log — see `CURSOR_GLOBAL_SYSTEM_AUDIT_PLAN.json`.

## 3. Principal new / residual risks

1. **Email invites:** Product “success” correctly gates on Edge/`send-invite` response; **inbox delivery** is not technically provable from the app.  
2. **`upsertModelLocation` failure on Add model:** Still `console.warn` only — user may not know Near Me is missing until a later save (F-004).  
3. **Fire-and-forget loads:** `void getPhotosForModel`, `void getModelLocation`, etc., in `AgencyControllerView` can race with rapid selection changes; mitigated by refetch on selection and save paths — not changed here.

## 4. What was fixed

- **P0 media:** After Add-model uploads, **both** `rebuildPortfolioImagesFromModelPhotos` and `rebuildPolaroidsFromModelPhotos` run (with user-visible error on polaroid sync failure).  
- **P1 lifecycle:** Merge path checks **`agency_update_model_full`** error when claim RPC fails; surfaces failure instead of silent partial success.  
- **P3 media (roster):** Background mirror heal for empty `portfolio_images` now also runs **polaroid** rebuild from `model_photos` for the same candidate set.

Details: `CURSOR_GLOBAL_SYSTEM_AUDIT_DIFF.md`.

## 5. Deliberately not fixed (this pass)

- **F-004:** Upgrade `upsertModelLocation` failure to Alert — would change UX/copy; left as documented follow-up.  
- **F-005 / F-006:** Broad refactor of `void` secondary loads and `GuestChatView` empty catch — out of scope for minimal audit fixes.  
- **P9 rules:** No `.mdc` edits; fixes encode the invariant in code.  
- **Full-repo exhaustive scan:** Hundreds of `void` call sites; only agency-model and invite-adjacent paths were deep-traced. Further passes can extend the same grep catalog.

## 6. P2 — Agency model lifecycle (code-level trace)

| Step | Primary code | DB / RPC | Async / void | Skip / stale risk |
|------|----------------|----------|----------------|-------------------|
| Add manual | `handleAddModel` | `importModelAndMerge` → insert/update; `agency_claim_unowned_model` or `agency_update_model_full`; optional `upsertModelLocation`; uploads + `upsertPhotosForModel`; mirror rebuilds | `onRefresh` wrapped in try/catch | ~~Polaroid mirror~~ **fixed**; ~~merge fallback RPC~~ **fixed** |
| Import URL | `handleImportByLink` | `importModelAndMerge` with `portfolio_images` / `polaroids` arrays | `onRefresh()` not awaited | Import feedback OK; list may lag until refresh completes |
| Merge | `importModelAndMerge` | `agency_update_model_full` on existing row | — | Territory + sync id flags already surfaced |
| Edit | `handleSaveModel` | `upsertTerritoriesForModel`; `agency_update_model_full`; location RPC as in form | `void getTerritoriesForAgency` after territory save | Secondary map refresh async |
| Upload (edit) | `ModelMediaSettingsPanel` | `uploadModelPhoto` / `addPhoto`; `void syncPortfolio` / `syncPolaroids` | Fire-and-forget sync inside `setState` | Sync errors alerted; order vs rapid clicks is bounded by panel UX |
| Location | Add: `upsertModelLocation` agency; Edit: same + `agency_update_model_full` city fields | `model_locations` + `models` | — | Geocode null → no write (existing) |
| Invite | `generateModelClaimToken`; `functions.invoke('send-invite')` | tokens + Edge | Isolated try/catch | Success only if `body.ok === true` |
| Resend | `handleResendModelClaimInvite` | token read/regen; `resendInviteEmail` | — | Cooldown + alerts |
| Soft remove | `removeModelFromAgency` | RPC/service | — | Smoke: see VERIFY |

## 7. P3 — Media

- **SoT:** `model_photos`; mirrors `models.portfolio_images` / `models.polaroids` — see `docs/MODEL_PROFILE_PERSISTENCE_AND_VISIBILITY.md`.  
- **Gap closed:** Add-model path now mirrors **both** columns after uploads (aligned with `ModelMediaSettingsPanel` load path).  
- **Remaining:** External sync (Mediaslide/Netwalk) updates fields via `agency_update_model_full` without necessarily touching `model_photos` — by design for metadata sync; not a regression from this audit.

## 8. P4 — Location

- **Filter:** `src/utils/modelFilters.ts` uses `loc?.city || m.city` where location map exists — matches invariant.  
- **SQL:** `get_models_near_location` / migrations — not modified; rely on existing `DISTINCT ON` + source order per `system-invariants.mdc`.  
- **Residual:** Add-model location failure is warn-only (F-004).

## 9. P5 — Invite / token

- **Truth:** UI distinguishes `emailSentOk` vs failure + manual link (`handleAddModel`).  
- **Resend:** Token regen when expired (existing).  
- **Semantics:** “Confirmed delivery” = **successful send API**, not read receipt (F-007).

## 10. P6 — Auth / bootstrap

- **`AuthContext`:** `bootstrapThenLoadProfile` guarded by `profileLoadInFlightRef`; `onAuthStateChange` skips duplicate bootstrap when profile loaded or in flight — documented only; **no change** (admin/login invariants).

## 11. P7 — Reload / state

- **`refreshAgencyModelLists`:** Refetches full + light lists; mirror heal ref updated for dual rebuild.  
- **`selectedModel`:** Set from `getModelByIdFromSupabase` after add — still valid.

## 12. P1 / P8 — Pattern scan (abbreviated)

- **void `.then`:** Many instances in `AgencyControllerView`, `ClientWebApp` — triaged as **non-blocking reads** unless tied to persistence (F-005).  
- **`.catch` on Option-A services:** Limited in `src/services`; admin fallbacks use `.catch(() => [])` by design.  
- **Mirror without rebuild:** Addressed for Add-model and roster heal; other entry points (e.g. application → model) not re-audited line-by-line in this pass.

---

**SYSTEM CONSISTENT WITH MINOR RISKS**
