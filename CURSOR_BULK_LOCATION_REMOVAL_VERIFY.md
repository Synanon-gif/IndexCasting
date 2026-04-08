# Agency bulk current location removal — verification

## Automated

```bash
cd /Users/rubenjohanneselge/Desktop/Final_IndexC/IndexCasting && \
npm run typecheck && npm run lint && npm test -- --passWithNoTests --ci
```

## Manual (Agency)

1. **Bulk UI:** Open Agency → My Models → select two or more models. Confirm **no** “Set Current Location” (or equivalent) appears; hint reads **Select models to assign territories** when none selected.
2. **Territories bulk:** With models selected, tap **Assign Territories**, pick countries, confirm — expect success feedback; territories visible on roster after refresh/map reload as before.
3. **Single current location:** Open **one** model → set country/city (agency fields) → **Save settings** — expect success; Near Me / `model_locations` agency row behaviour unchanged vs prior single-save semantics.
4. **Model self-settings:** As a linked model, set location in profile — unchanged.
5. **Admin:** Sign in as admin — login and dashboard unchanged (no Auth/App edits).
6. **Residuals:** Repo grep: no `bulkUpsertModelLocations`, no `bulkActions.setLocation`, no `successBulk` in `uiCopy`; no bulk location modal in `AgencyControllerView`.

## Location priority / discovery (no regression)

7. **Source order unchanged:** With a test model that has both model-owned (`live` or `current`) and agency `model_locations` rows, discovery / Near Me must still resolve using **live → current → agency** (same as before this change). Agency bulk removal must **not** promote `agency` above model-owned sources.
8. **Code sanity (optional):** Confirm `src/services/modelLocationsSupabase.ts` still documents `Priority: live > current > agency` and that no new client sort inverts that order.

## Non-regression spot checks (unchanged code paths)

9. **Model save (single):** Agency single-model save after territory save still succeeds (existing `agency_update_model_full` flow).
10. **Calendar:** Open agency calendar / bookings view — no new errors (no files touched; smoke).
11. **Chat:** Open an existing agency thread — no new errors (smoke).

## Regression guard

- No edits to `AuthContext`, `App.tsx`, `get_my_org_context`, paywall ordering, or `assert_is_admin` / `get_own_admin_flags` definitions.
