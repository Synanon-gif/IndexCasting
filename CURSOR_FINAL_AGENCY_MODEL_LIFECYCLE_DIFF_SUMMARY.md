# Final Agency Model Lifecycle — Diff Summary

## src/views/AgencyControllerView.tsx

### handleAddModel — Restrukturierung (RC-1, RC-3, RC-4, RC-7)
- **Location vor Photos:** `upsertModelLocation('agency')` wird jetzt VOR dem Photo-Upload-Block aufgerufen
- **Keine Early Returns:** Photo-Rights-Fehler setzen `photoRightsOk = false`, kein `return` mehr
- **Full Rebuild:** `rebuildPortfolioImagesFromModelPhotos` statt `syncPortfolioToModel(uploadedUrls)` nach Uploads
- **Upload-Warnung:** Alert wenn alle Portfolio-Uploads fehlschlagen obwohl Files vorhanden
- **Form Reset am Ende:** `setShowAddForm(false)` und State-Resets nach Photos+Location+Refresh+selectedModel

### handleResendModelClaimInvite (RC-6)
- Bei fehlendem gültigem Token: automatisch `generateModelClaimToken` → neuer Token → `resendInviteEmail`

### handleSaveModel (RC-8)
- `onRefresh()` wird jetzt mit `await` aufgerufen

### Import-Bereinigung
- `syncPortfolioToModel` Import entfernt (nicht mehr verwendet in dieser Datei)

### useEffect [models, selectedModel] (RC-5 — Kommentar-Update)
- Kommentar klarstellt: `models` Prop IST bereits fullModels (kein Degradation-Risiko)

## src/services/modelPhotosSupabase.ts (RC-2)

### uploadModelPhoto
- Neuer optionaler Parameter: `opts?: { skipConsentCheck?: boolean }`
- Wenn `skipConsentCheck: true` → überspringe die `hasRecentImageRightsConfirmation` DB-Query
- Keine Verhaltensänderung für bestehende Aufrufe ohne Option (Default: false)

### Aufrufe in handleAddModel
- Portfolio/Polaroid-Uploads übergeben `{ skipConsentCheck: true }` da confirmImageRights + guardImageUpload bereits erfolgreich durchlaufen wurde
