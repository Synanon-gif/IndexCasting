# CURSOR_DISCOVERY_FINAL_REPORT.md

**Date:** 2026-05-08  
**Scope:** Final Discovery hardening (SQL parity, canonical RPC, validation).  
**Outcome:** `DISCOVERY FINAL HARDENING + FIXES APPLIED`

---

## 1. Executive Summary

- **SQL:** `get_discovery_models`, `get_models_near_location`, and `get_models_by_location` now filter chest min/max using `COALESCE(m.chest, m.bust)`, matching the client UI and Agency `filterModels` (`chest ?? bust`).
- **Governance:** `get_discovery_models` is now recorded under [`supabase/migrations/20260508_discovery_chest_coalesce_and_canonical_rpc.sql`](supabase/migrations/20260508_discovery_chest_coalesce_and_canonical_rpc.sql) so the repo can reproduce the live definition.
- **Live deploy:** Migration applied via Supabase Management API (HTTP 201). Verification: `position('COALESCE(m.chest, m.bust)' in pg_get_functiondef(...)) > 0` for all three functions.
- **Product readiness:** Discovery is **production-usable** for the current product scope. Residual gaps are **documented** (legacy direct-table client queries, city vs `model_locations`), not hidden.

---

## 2. SQL parity fix (chest / bust)

| Function | Change |
|----------|--------|
| `get_discovery_models` | `p_chest_min` / `p_chest_max` use `COALESCE(m.chest, m.bust)` |
| `get_models_near_location` | Same |
| `get_models_by_location` | Same |

Root reference [`supabase/migration_client_model_interactions_v2.sql`](supabase/migration_client_model_interactions_v2.sql) updated for `get_discovery_models` only (historical parity).

**Not changed:** Other measurement columns, JOINs, scoring CASE expressions, grants, or security mode (`SECURITY DEFINER` / `SECURITY INVOKER` unchanged per function).

---

## 3. Ranking logic (actual behavior)

**Source:** `get_discovery_models` CTE `scored` + [`applyDiversityShuffle`](src/services/clientDiscoverySupabase.ts).

1. **Never seen (no interaction row):** +50 (via `CASE WHEN oi.model_id IS NULL THEN 50`).
2. **Same city:** +30 when `lower(trim(m.city)) = lower(trim(p_client_city))` (uses **`models.city`**, not `model_locations`).
3. **Recently active:** +20 if `created_at` or `updated_at` within 30 days.
4. **Seen:** −10 if `last_viewed_at` IS NOT NULL.
5. **Rejected (ever):** −40 if `last_rejected_at` IS NOT NULL (score), plus **hard exclude** if rejected within `p_reject_hours` (default 24h).
6. **Booked:** **Hard exclude** if `last_booked_at` within `p_book_days` (default 7 days) — not a score penalty, complete removal from result set.
7. **Session:** `p_exclude_ids` hard-excludes IDs (local session set).

**Client shuffle:** After RPC, `applyDiversityShuffle` applies Fisher–Yates **inside** three tiers (score ≥ 50, 0–49, &lt; 0). **Not fully deterministic** between requests.

**Classification:** **MEDIUM** — intentional variety; acceptable at current scale; document for stakeholders.

---

## 4. Seen / booked behavior

| Signal | Effect |
|--------|--------|
| Viewed | −10 score; still eligible unless excluded by session IDs |
| Rejected (cooldown) | Excluded from result set |
| Booked (cooldown) | Excluded from result set |
| `p_exclude_ids` | Excluded |

**Classification:** **SAFE** and **consistent** with code comments in [`getDiscoveryModels`](src/services/clientDiscoverySupabase.ts).

---

## 5. Scaling assessment (50k+ models)

- **Ranked discovery:** Server-side `ORDER BY discovery_score DESC, id` with optional **keyset** pagination (`p_cursor_score`, `p_cursor_model_id`, `p_limit` default 50). Good pattern for large tables.
- **Legacy / hybrid:** `get_models_by_location` uses `OFFSET`/`LIMIT` — **acceptable** for smaller pages; at very large offsets, **optimizable** (keyset or materialized feeds) — **not changed** in this pass.
- **Near Me:** Bbox pre-filter + Haversine on candidates; `DISTINCT ON (model_id)` for location priority — **SAFE** design.
- **Overall:** **Scales** for typical B2B usage; **critical** only if clients paginate very deep on unindexed paths — future index review on `(country_code)` / `model_agency_territories` and `client_model_interactions` is listed under improvements.

**Classification:** **optimierbar** at extreme scale, **not blocking** now.

---

## 6. Filter consistency

| Path | Chest logic (after fix) |
|------|-------------------------|
| `get_discovery_models` | `COALESCE(m.chest, m.bust)` |
| `get_models_near_location` | Same |
| `get_models_by_location` | Same |
| Agency [`filterModels`](src/utils/modelFilters.ts) | `m.chest ?? m.bust` |
| [`applyMeasurementFilters`](src/services/modelsSupabase.ts) (direct `.from('models')`) | Still **`.gte('chest')` / `.lte('chest')` only** — **residual drift** for legacy bust-only rows on paths that bypass RPCs |

Other dimensions (height, waist, hips, inseam, sex, ethnicity, categories, sports) remain aligned between RPCs and UI params where those RPCs exist.

**Classification:** RPC + Agency UI **aligned**; **PARTIAL DRIFT** for rare direct-table client list fetches without RPC.

---

## 7. Photo visibility correctness

- **Normal Discover / detail:** [`getModelData`](src/services/apiService.js) returns `portfolio.images` from `models.portfolio_images` and **forces `polaroids: []`** with an explicit comment that Discovery never shows polaroids.
- **Package / guest:** [`ClientWebApp.tsx`](src/web/ClientWebApp.tsx) swaps in `portfolio_images` vs `polaroids` from package RPC data by `packageType`; shared/guest flows use dedicated data shapes.
- **Storage / RLS alignment:** See [`docs/CLIENT_MODEL_PHOTO_VISIBILITY.md`](docs/CLIENT_MODEL_PHOTO_VISIBILITY.md) for the authoritative matrix.

**Classification:** **SAFE** for “no polaroids in standard Discover”; **INCONSISTENT** would only apply if `models.portfolio_images` were ever populated with URLs clients must not see — that is a **data/sync** concern, not changed here.

---

## 8. Location consistency validation (P-L1–L4)

| Topic | Behavior | Classification |
|-------|----------|----------------|
| **City filter (RPC ranked)** | Same-city **boost** uses `models.city` vs `p_client_city`; **no** `model_locations` join | **PARTIAL DRIFT** vs canonical geo in Near Me |
| **City filter (legacy hybrid)** | `get_models_by_location`: `m.city ILIKE p_city` | Same limitation |
| **Near Me** | `model_locations` with priority live &gt; current &gt; agency; `share_approximate_location = TRUE` | **CONSISTENT** |
| **Territory vs location** | Country discovery via `model_agency_territories`; radius via `model_locations` | **CONSISTENT** (separation intentional) |
| **Edge: only `model_locations.city`** | Ranked path may **not** match city boost; hybrid city filter may miss if `models.city` empty | **MINOR DRIFT** — document, optional future unify |

---

## 9. What is solid now

- Chest measurement filters match UI semantics on all **primary** discovery RPCs.
- `get_discovery_models` is **version-controlled** in `supabase/migrations/`.
- Ranking, exclusions, and shuffle behavior are **traceable** in SQL + TS.
- Polaroid separation for standard Discover is **explicit** in `getModelData`.

---

## 10. What could be improved later

- Optional **PostgREST / `applyMeasurementFilters`** parity for `chest` using `COALESCE` semantics (or filter on a DB view).
- **City signal:** optionally incorporate resolved display city from `model_locations` for boost/filter (product decision).
- **Deeper pagination** for `get_models_by_location` without large OFFSET.
- **Product note:** document non-deterministic order within score tiers for QA.

---

## 11. Product readiness verdict

**Discovery is product-ready** for the implemented flows (ranked + legacy + Near Me), with **known, documented** minor drift on direct-table list queries and city/geo edge cases. No critical leak or ranking silent failure identified in this pass.

---

**DISCOVERY FINAL HARDENING + FIXES APPLIED**
