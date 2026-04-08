# Agency bulk current location — removal report

## 1. Executive summary

The product rule is now enforced in the **client**: **Agency multi-select on the model roster** may **only** assign **territories of representation**. **Current location** (including the agency `model_locations` row and `models` display fields via single save) is **only** editable through the **canonical single-model** agency editor and model self-settings. All bulk UI, state, handlers, and the `bulkUpsertModelLocations` service were removed so there is no hidden or inconsistent bulk path.

## 2. Bulk current location paths removed

- **UI:** Sticky footer button “Set Current Location”, full bulk location modal (country/city/Nominatim geocode), and related React state in `MyModelsTab` inside `AgencyControllerView.tsx`.
- **Handler:** `handleBulkSetLocation` and `bulkUpsertModelLocations` RPC calls.
- **Service:** `bulkUpsertModelLocations` in `modelLocationsSupabase.ts`.
- **Tests:** Jest coverage for `bulkUpsertModelLocations`.
- **Copy:** `uiCopy.bulkActions.setLocation`, `uiCopy.locationModal.successBulk`; added `bulkActions.selectForTerritoriesHint` for roster selection clarity.

## 3. Single-edit location paths preserved

- **Agency:** One model selected → Save settings → `agency_update_model_full` + `upsertModelLocation(..., 'agency')` with `geocodeCityForAgency` when appropriate (unchanged).
- **Model:** `ModelProfileScreen` location handling unchanged.

## 4. Territories bulk (remaining function)

- **Assign Territories** from the same multi-select footer opens the existing territory modal and calls `bulkAddTerritoriesForModels` / territory RPCs as before.
- Footer layout adjusted to a single full-width primary action; scroll padding when models are selected avoids overlap with the sticky bar.

## 5. Rules decision

Guardrails added in `system-invariants.mdc`, `auto-review.mdc`, and `.cursorrules`: agency bulk must not set current location; bulk is territories-only; UI must not expose bulk current-location controls.

## 5a. Location source priority (unchanged)

**Invariant:** `live` (highest) → `current` (model) → `agency` (lowest). This removal does **not** alter Near Me / discovery SQL (`DISTINCT ON` + `CASE source …`) or client-side resolution in `modelLocationsSupabase` / `getModelLocation`. Agency-set rows remain **strictly below** model-owned `live` / `current` for ranking.

**Delta pass (this release):** Explicit guardrail lines added to `.cursorrules`, `docs/MODEL_SAVE_LOCATION_CONSISTENCY.md`, `system-invariants.mdc` (NIEMALS), and `auto-review.mdc` (risk + stop) so future changes cannot silently reorder sources.

## 6. Why Auth / Admin / Login were untouched

No changes to `AuthContext`, `App.tsx`, sign-in/bootstrap/loadProfile, admin RPCs, `get_my_org_context`, or paywall core — scope was limited to agency roster bulk location and related service/copy/docs.

## 7. Database

`public.bulk_upsert_model_locations` remains in the database from historical migrations; the **app no longer invokes** it. Optional hardening: `REVOKE EXECUTE` in a future migration if desired (listed under manual review in `CURSOR_BULK_LOCATION_REMOVAL_PLAN.json`).

## 8. Next step in the overall plan

Safe to proceed with a **wider audit** of model/location flows; no mandatory follow-up for this removal unless you want DB-level REVOKE of the unused RPC.

---

**BULK CURRENT LOCATION REMOVED**
