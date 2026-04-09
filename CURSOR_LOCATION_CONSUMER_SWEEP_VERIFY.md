# Location Consumer Sweep — Verify

## Scenarios

1. **Hybrid client list (`getModelsForClient` + country)**  
   - RPC returns `effective_city` when `model_locations` differs from `models.city`.  
   - **Expect:** Mapped `city` matches Discover / `effective_city` priority.

2. **Client project overview (hydrated projects)**  
   - Models in projects loaded via `getModelByIdForClientFromSupabase` + batch `model_locations`.  
   - **Expect:** Card city matches canonical location when rows exist; else `models.city`.

3. **No `model_locations` rows**  
   - **Expect:** `city` falls back to `models.city` (unchanged UX).

4. **GDPR export**  
   - **Expect:** Still raw RPC payload; no automatic merge — documented.

5. **Edge Functions**  
   - **Expect:** No city fields; no regression.

## Automated

- [x] `npm run typecheck` — pass
- [x] `npm run lint` — pass (0 errors; pre-existing warnings OK)
- [x] `npm test -- --passWithNoTests --ci` — 901 passed, 81 suites

## Manual (optional)

- Open client web: project with model whose `model_locations.current.city` ≠ `models.city` — label matches Discover.
