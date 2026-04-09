# Location Source Priority Verify — Checklist

**Date:** 2026-05-18

---

## Live-DB Verification

- [x] `upsert_model_location`: ON CONFLICT (model_id, source) — confirmed via `pg_get_functiondef`
- [x] `upsert_model_location`: Auth-Split (live/current=model, agency=agency-member) — confirmed
- [x] `upsert_model_location`: SET row_security TO off + 3-layer guards — confirmed
- [x] `get_models_near_location`: DISTINCT ON (ml.model_id) with source priority ORDER BY — confirmed
- [x] `get_models_near_location`: Auth guards (auth.uid + can_access_platform) — confirmed
- [x] `delete_model_location_source`: p_source=NULL deletes only live+current — confirmed
- [x] `delete_model_location_source`: Auth-Split by source — confirmed

## TypeScript Services

- [x] `locationSourcePriority`: live=2, current=1, agency=0 — correct
- [x] `getAllModelLocations`: sort descending by priority — correct
- [x] `getModelLocation`: returns highest-priority (all[0]) — correct
- [x] `upsertModelLocation`: default source='current', passes p_source — correct

## Scenario Verification (7/7)

- [x] S1: live + current + agency → effective = live
- [x] S2: current + agency → effective = current
- [x] S3: agency only → effective = agency
- [x] S4: agency update while live/current exist → effective stays live/current
- [x] S5: remove live → fallback to current or agency
- [x] S6: remove current (no live) → fallback to agency
- [x] S7: nearby filtering → never prefers agency over live/current

## Drift Check

- [x] D1: Conflicting upsert_model_location SQL definitions → live-DB correct, no fix needed
- [x] D2: ClientWebApp city text fallback → no fix needed (no model_locations in discovery data)
- [x] D3: modelFilters.ts displayCity priority → FIXED (loc?.city || m.city)
- [x] D4: get_discovery_models city score boost → intentional heuristic, no fix needed

## Guardrails Added

- [x] `.cursorrules` §27.4: Display-City priority rule updated
- [x] `auto-review.mdc`: Display-City-Priority stop-condition added
- [x] `system-invariants.mdc`: Display-City-Priority rule added in UI-Pflichten

## Quality Gate

- [ ] `npm run typecheck` — green
- [ ] `npm run lint` — green
- [ ] `npm test -- --passWithNoTests --ci` — green
- [ ] Git commit + push
