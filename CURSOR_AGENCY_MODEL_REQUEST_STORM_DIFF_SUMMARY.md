# Agency Model Request Storm — Diff Summary

**Datum:** 2026-05-15

## Geänderte Dateien

### 1. `supabase/migrations/20260515_fix_generate_model_claim_token_no_pgcrypto.sql` (NEU)
- Neue definitive Migration für `generate_model_claim_token`
- Ersetzt `encode(gen_random_bytes(32), 'hex')` durch `encode(sha256((gen_random_uuid()::text)::bytea), 'hex')`
- Alle Guards unverändert (auth + agency membership + resource ownership)
- Deployed ✅ · Live-Verify ✅

### 2. `src/components/ModelMediaSettingsPanel.tsx`
- `useRef`-Wrappers für `onHasVisiblePortfolioChange` und `onReconcileComplete` hinzugefügt
- `loadPhotos` useCallback: Dependencies von `[modelId, onHasVisiblePortfolioChange, onReconcileComplete]` auf `[modelId]` reduziert
- `syncPortfolio` useCallback: `onHasVisiblePortfolioChange` aus Dependencies entfernt
- Beide Callbacks werden über stabile Refs aufgerufen statt über direkte Props
- **Kern-Invariante:** `useEffect([loadPhotos])` feuert jetzt nur noch bei Model-ID-Wechsel

### 3. `src/views/AgencyControllerView.tsx`
- `key={selectedModel.id}` auf `ModelMediaSettingsPanel` hinzugefügt
- `onHasVisiblePortfolioChange`: Inline-Lambda durch direkte `refreshClientVisiblePortfolio`-Ref ersetzt
- `onReconcileComplete`: Inline-Lambda durch direkte `onRefresh`-Ref ersetzt
