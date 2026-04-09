# Location Truth Unification — Verification Matrix

## P9 Scenarios

### 1. Model has live + current + agency
- **Expected:** `effective_city` = live city everywhere
- **SQL:** `DISTINCT ON (model_id) ORDER BY CASE source WHEN 'live' THEN 0 ...` → live wins
- **Frontend:** `m.effective_city` from RPC = live city; `m.city` = legacy fallback (not displayed)
- **Status:** VERIFIED via pg_get_functiondef — CTE logic confirmed

### 2. Model has current + agency, no live
- **Expected:** `effective_city` = current city everywhere
- **SQL:** DISTINCT ON picks current (priority 1) over agency (priority 2)
- **Status:** VERIFIED by CTE logic

### 3. Model has only agency
- **Expected:** `effective_city` = agency city
- **SQL:** Only agency row in model_locations → selected
- **Status:** VERIFIED by CTE logic

### 4. models.city differs from model_locations.city
- **Expected:** UI and filtering use effective_city (from model_locations), not models.city
- **Discovery mapper:** `m.effective_city ?? m.city` → effective_city wins
- **Discovery score:** `COALESCE(el.effective_city, m.city)` → effective_city used for +30 boost
- **filterModels:** `loc?.city || m.city` → loc wins (same semantics)
- **Status:** VERIFIED

### 5. Discover vs Near Me — no visible city contradiction
- **Before:** Discovery showed `models.city`, Near Me showed `model_locations.city` → could differ
- **After:** Both use model_locations priority; Discovery via `effective_city`, Near Me via `location_city`
- **Status:** FIXED

### 6. Agency save updates agency location while live/current exist
- **Expected:** Display/filter still use higher-priority source
- **SQL:** Agency write goes to `(model_id, 'agency')` row only; `effective_city` CTE picks live/current first
- **Frontend:** `m.effective_city` reflects highest priority, not agency write
- **Status:** VERIFIED — structural isolation unchanged

### 7. Legacy/fallback case with no model_locations row
- **Expected:** `models.city` used as fallback
- **SQL:** LEFT JOIN effective_locations → el.effective_city = NULL → `COALESCE(NULL, m.city) = m.city`
- **Frontend:** `m.effective_city ?? m.city ?? ''` → m.city used
- **Status:** VERIFIED

## Live Database Verification

```
get_discovery_models: effective_city ✓, effective_locations CTE ✓
get_models_by_location: effective_city ✓, effective_locations CTE ✓
get_guest_link_models: effective_city ✓, model_locations reference ✓
```

## Quality Gates

- [ ] npm run typecheck
- [ ] npm run lint
- [ ] npm test -- --passWithNoTests --ci
- [ ] Migration deployed (HTTP 201)
- [ ] pg_get_functiondef verified for 3 RPCs
