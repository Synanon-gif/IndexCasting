# Agency → Model → Client E2E Audit — Diff Summary

**Datum:** 2026-04-09

---

## Geänderte Dateien (4 Bugs, 4 Fixes)

### 1. `src/views/AgencyControllerView.tsx` — BUG 1

**Art:** TypeScript, 1 Stelle  
**Änderung:** Error-Check für `agency_update_model_full` im Create-Zweig hinzugefügt

```diff
- await supabase.rpc('agency_update_model_full', {
+ const { error: updateErr } = await supabase.rpc('agency_update_model_full', {
    p_model_id:                  mergeResult.model_id,
    p_agency_relationship_status: emailTrim ? 'pending_link' : 'active',
    ...
  });
+ if (updateErr) {
+   console.error('handleAddModel: agency_update_model_full (create) failed:', updateErr);
+   Alert.alert(uiCopy.common.error, `Model created but visibility/status flags could not be set. ...`);
+ }
```

---

### 2. `src/screens/CustomerSwipeScreen.tsx` — BUG 5

**Art:** TypeScript, 2 Stellen (Legacy-Inline-Mapping, initial load + loadNextPage)  
**Änderung:** `normalizeDocumentspicturesModelImageRef` zu beiden Legacy-Inline-Maps hinzugefügt

```diff
- gallery: m.portfolio_images ?? [],
+ gallery: (m.portfolio_images ?? []).map((u) => normalizeDocumentspicturesModelImageRef(u, m.id)),
```

(an beiden Stellen: Z. ~160 und Z. ~200)

---

### 3. `supabase/migrations/20260519_get_discovery_models_restore_effective_city.sql` — BUG 4

**Art:** SQL-Migration, neue Datei  
**Änderung:** Vollständige Neudefinition von `get_discovery_models` mit wiederhergestellter `effective_locations` CTE

Kernänderung gegenüber `20260508`:
```sql
-- NEU: effective_locations CTE (aus 20260409 restauriert)
effective_locations AS (
  SELECT DISTINCT ON (ml.model_id)
    ml.model_id, ml.city AS effective_city
  FROM public.model_locations ml
  WHERE ml.city IS NOT NULL AND TRIM(ml.city) <> ''
  ORDER BY ml.model_id,
    CASE ml.source WHEN 'live' THEN 0 WHEN 'current' THEN 1 WHEN 'agency' THEN 2 ELSE 3 END ASC
),

scored AS (
  SELECT
    m.*,
    ...
-   -- (kein effective_city-Feld in 20260508)
+   COALESCE(el.effective_city, m.city) AS effective_city,   -- NEU
    (
      ...
-     AND lower(trim(m.city)) = lower(trim(p_client_city))   -- ALT
+     AND lower(trim(COALESCE(el.effective_city, m.city))) = lower(trim(p_client_city))  -- NEU
      ...
    ) AS discovery_score
  FROM public.models m
  ...
- -- (kein JOIN auf model_locations in 20260508)
+   LEFT JOIN effective_locations el ON el.model_id = m.id   -- NEU
  ...
```

**Live-deployed:** HTTP 201, `pg_get_functiondef` bestätigt alle drei Änderungen.

---

### 4. `supabase/migrations/20260520_claim_model_by_token_set_active.sql` — BUG 3

**Art:** SQL-Migration, neue Datei  
**Änderung:** Vollständige Neudefinition von `claim_model_by_token` mit `agency_relationship_status = 'active'`-Update

Kernänderung gegenüber `20260413`:
```sql
-- Bestehendes UPDATE (unverändert):
UPDATE public.models
SET user_id = auth.uid(), updated_at = now()
WHERE id = v_claim_row.model_id AND user_id IS NULL;

-- NEU: Status-Transition nach erfolgreichem Claim
UPDATE public.models
SET agency_relationship_status = 'active', updated_at = now()
WHERE id                        = v_claim_row.model_id
  AND agency_relationship_status = 'pending_link';   -- Guard: nur pending_link → active
```

**Live-deployed:** HTTP 201, `pg_get_functiondef` bestätigt `agency_relationship_status = 'active'` und `pending_link`-Guard.

---

## Nicht geänderte Dateien

Alle anderen Dateien inkl. `AuthContext.tsx`, `GuestView.tsx`, `ClientWebApp.tsx`,
`AgencyControllerView.tsx` (`handleSaveModel`-Pfad), alle Calendar/Booking/Option-Services,
alle Migrationen vor 20260519.

---

## Quality Gate Ergebnis

| Gate | Ergebnis |
|------|----------|
| `npm run typecheck` | Grün (0 Fehler) |
| `npm run lint` | Grün (0 Errors, 4 pre-existierende Warnings) |
| `npm test -- --passWithNoTests --ci` | 904/904 Tests bestanden |
| Live-Deploy Migration 20260519 | HTTP 201 + `pg_get_functiondef` verifiziert |
| Live-Deploy Migration 20260520 | HTTP 201 + `pg_get_functiondef` verifiziert |
