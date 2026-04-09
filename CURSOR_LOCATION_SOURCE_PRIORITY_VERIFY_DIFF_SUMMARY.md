# Location Source Priority — Diff Summary

**Date:** 2026-04-09
**Result:** LOCATION SOURCE PRIORITY VERIFIED — no drift found, one comment precision fix.

---

## Changes Made

### 1. Comment precision fix (only code change)

**File:** `src/services/modelLocationsSupabase.ts` (lines 14–17)

**Before:**
```
 * Priority: live > current > agency
 *   Enforced at write time: agency writes are a no-op if model owns the row
 *   (source='live' or 'current'). Model writes always succeed.
 *   See upsert_model_location RPC (20260406_location_source_v2.sql).
```

**After:**
```
 * Priority: live > current > agency
 *   Write: each source has its own isolated row (UNIQUE model_id, source).
 *   Agency writes go to (model_id, 'agency') and never touch live/current rows.
 *   Read: getModelLocation returns highest-priority source; DB uses DISTINCT ON.
 *   See upsert_model_location RPC (20260406_location_multirow_priority.sql).
```

**Reason:** The old comment described the deprecated single-row "no-op" semantics. The current multi-row architecture uses structural isolation (each source has its own row via `UNIQUE(model_id, source)`). Priority is enforced at read time, not write time. Updated to reflect reality.

### 2. Deliverable files created

- `CURSOR_LOCATION_SOURCE_PRIORITY_VERIFY_REPORT.md` — full verification report
- `CURSOR_LOCATION_SOURCE_PRIORITY_VERIFY_DIFF_SUMMARY.md` — this file
- `CURSOR_LOCATION_SOURCE_PRIORITY_VERIFY_CHECKLIST.md` — scenario checklist
- `CURSOR_LOCATION_SOURCE_PRIORITY_VERIFY_PLAN.json` — machine-readable plan

---

## What was NOT changed

- **No SQL migrations** — all RPCs correctly implement the priority.
- **No guardrail updates** — `.cursorrules`, `system-invariants.mdc`, `auto-review.mdc` already have comprehensive location priority rules.
- **No UI changes** — all badges, labels, and filters respect the priority.
- **No filter logic changes** — Near Me, city, and country filters are correct.
- **No test changes** — existing tests cover priority resolution and source isolation.
