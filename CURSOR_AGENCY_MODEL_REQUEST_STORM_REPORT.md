# Agency Model Request Storm — Root Cause Report

**Datum:** 2026-05-15  
**Status:** FIXED

---

## Bestätigte Root Causes

### RC-1: `gen_random_bytes` (pgcrypto) nicht verfügbar
**Datei:** `supabase/migrations/20260427_fix_agency_guard_no_owner_user_id.sql`, Zeile 428  
**Fehler im Live-Log:** `function gen_random_bytes(integer) does not exist`  
**Folge:** `generate_model_claim_token` RPC wirft Runtime-Exception → PostgREST gibt 404 zurück → `generateModelClaimToken` in `modelsSupabase.ts` schlägt fehl → Invite-Mail wird nie versendet.

### RC-2: Endlosschleife im ModelMediaSettingsPanel (Haupt-Blocker)
**Datei:** `src/components/ModelMediaSettingsPanel.tsx`  
**Ursache:** `loadPhotos` useCallback hatte `onHasVisiblePortfolioChange` und `onReconcileComplete` in seinen Dependencies. Der Parent (`AgencyControllerView.tsx`) übergab diese Props als neue Inline-Arrow-Functions bei jedem Render:

```typescript
// VORHER — erzeugt neue Funktionsreferenz bei jedem Render:
onHasVisiblePortfolioChange={() => { refreshClientVisiblePortfolio(); }}
onReconcileComplete={() => { void Promise.resolve(onRefresh()); }}
```

**Loop-Kette:**  
`Parent rendert` → neue Prop-Refs → `loadPhotos` neue Ref → `useEffect([loadPhotos])` feuert → 3× GET `model_photos` + 2× POST `agency_update_model_full` → `onReconcileComplete()` → `refreshAgencyModelLists()` → `setFullModels()` → `Parent rendert` → …  
→ Browser-Ressourcen erschöpft (`ERR_INSUFFICIENT_RESOURCES`)  
→ Alle Saves fehlschlagen (Fotos, Location, Territories)

### RC-3: assertOrgContext-Warnung (kein Blocker)
`logAction` in `uploadModelPhoto` liest `models.organization_id` asynchron. Wenn das Model `organization_id = NULL` hat, loggt `assertOrgContext` eine Warnung und überspringt den Audit-Eintrag. Der Upload selbst läuft durch, wird aber durch RC-2 verhindert (Request-Storm).

### RC-4: Consent-Checkbox nicht zurückgesetzt bei Model-Wechsel
Kein `key={selectedModel.id}` auf `ModelMediaSettingsPanel` → `imageRightsConfirmed` (useState) blieb zwischen Models erhalten.

---

## Angewandte Fixes

### Fix 1 — Migration: `gen_random_bytes` → PG13+ Built-in
**Datei:** `supabase/migrations/20260515_fix_generate_model_claim_token_no_pgcrypto.sql`

Zeile ersetzt:
```sql
-- VORHER (pgcrypto — nicht verfügbar):
v_token := encode(gen_random_bytes(32), 'hex');

-- NACHHER (PG13+ built-in, kein Extension nötig):
v_token := encode(sha256((gen_random_uuid()::text)::bytea), 'hex');
```

Deployed ✅ · Live-Verify via `pg_get_functiondef` bestätigt ✅

### Fix 2 — ModelMediaSettingsPanel: stabile Callback-Refs
**Datei:** `src/components/ModelMediaSettingsPanel.tsx`

- `onHasVisiblePortfolioChangeRef` und `onReconcileCompleteRef` über `useRef` stabilisiert
- Beide aus `loadPhotos` useCallback-Dependencies entfernt
- `loadPhotos` deps: nur noch `[modelId]` → feuert nur bei echtem Model-Wechsel
- `syncPortfolio` deps: `onHasVisiblePortfolioChange` entfernt, ebenfalls via Ref

### Fix 3 — AgencyControllerView: stabile Props + key
**Datei:** `src/views/AgencyControllerView.tsx`

```typescript
// VORHER:
onHasVisiblePortfolioChange={() => { refreshClientVisiblePortfolio(); }}
onReconcileComplete={() => { void Promise.resolve(onRefresh()); }}

// NACHHER:
key={selectedModel.id}                    // Unmount/Remount bei Model-Wechsel
onHasVisiblePortfolioChange={refreshClientVisiblePortfolio}  // stabile useCallback-Ref
onReconcileComplete={onRefresh}           // stabile prop-Ref
```

---

## Qualitätsprüfung

- `npm run typecheck` → ✅ 0 Errors
- `npm run lint` → ✅ 0 Errors (4 pre-existing Warnings unverändert)
- `npm test -- --passWithNoTests --ci` → ✅ 847/847 Tests grün
