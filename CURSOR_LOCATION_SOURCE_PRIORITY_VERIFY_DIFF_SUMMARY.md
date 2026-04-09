# Location Source Priority Verify — Diff Summary

**Date:** 2026-05-18

---

## Files Changed

### 1. `src/utils/modelFilters.ts` — Display-City Priority Fix

```diff
-    const displayCity = (m.city || loc?.city || '').trim();
+    const displayCity = (loc?.city || m.city || '').trim();
```

**Reason:** `model_locations.city` from highest-priority source (live > current > agency) must take precedence over `models.city` for display and filter matching.

---

### 2. `.cursorrules` §27.4 — Display-City Priority Guardrail

```diff
-- **Stadt:** primär **`models.city`**; optionaler Fallback **`model_locations.city`** nur wo explizit als Fallback dokumentiert/semantisch korrekt.
+- **Stadt (Display/Filter):** Wenn `model_locations`-Daten verfügbar sind (z. B. in `filterModels`, Near-Me-Mapping), ist `model_locations.city` (höchste Source-Priorität) autoritativ: **`loc?.city || m.city`** — nicht umgekehrt. In Discovery-Kontexten ohne `model_locations`-Join (z. B. `get_discovery_models`) ist `models.city` die einzige verfügbare Quelle und akzeptabel.
```

---

### 3. `.cursor/rules/auto-review.mdc` — New Stop-Condition

Added after existing "Location: Source-Priorität geändert" stop-condition:

```
- **Location: Display-City-Priorität falsch:** `(m.city || loc?.city || ...)` in Filter/Display-Code wo `model_locations` verfügbar ist? → Blocker — muss `(loc?.city || m.city || '')` sein, damit `model_locations`-Source-Priorität (live > current > agency) auch im Display wirkt. In Discovery-Kontexten ohne `model_locations`-Join ist `models.city` allein akzeptabel.
```

---

### 4. `.cursor/rules/system-invariants.mdc` — Display-City Rule

Added in LOCATION SOURCE SYSTEM > UI-Pflichten section:

```
- **Display-City-Priorität:** Wo `model_locations`-Daten verfügbar sind (z. B. `filterModels`, Mapping), MUSS `loc?.city || m.city` gelten — `model_locations.city` (höchste Source) hat Vorrang vor `models.city`. In Discovery-Kontexten ohne `model_locations`-Join (z. B. `get_discovery_models`) ist `models.city` allein akzeptabel.
```

---

## Files NOT Changed (Verified Correct)

- `supabase/migrations/*` — no new migrations needed; live-DB confirmed correct
- `src/services/modelLocationsSupabase.ts` — priority sort already correct
- `src/web/ClientWebApp.tsx` — Near-Me mapping already uses `location_city ?? m.city`; text fallback acceptable
- `src/screens/ModelProfileScreen.tsx` — badge uses `getModelLocation` (highest priority)
- `src/views/AgencyControllerView.tsx` — save uses `upsertModelLocation(..., 'agency')`
