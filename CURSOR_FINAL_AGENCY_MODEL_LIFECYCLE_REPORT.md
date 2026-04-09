# Final Agency Model Lifecycle Hardening — Report

## Executive Summary

8 Root Causes identifiziert und 7 davon gefixt (RC-5 war ein Fehlalarm). Der Kernfehler:
Der ADD-Flow (Create) hatte mehrere Early-Return-Pfade die Location, Photos, Refresh und
selectedModel **silent** übersprangen. Zusätzlich konnte eine doppelte Consent-Prüfung
alle Uploads blockieren, und der Invite-Resend hatte keinen Auto-Regeneration-Pfad.

## Root Causes (RC)

### RC-1: Early Return nach Form-Close (CRITICAL — FIXED)
**Problem:** `setShowAddForm(false)` wurde BEVOR der Photo-Upload-Block ausgeführt.
Bei fehlender Image-Rights-Bestätigung wurde `return` aufgerufen — Location, Refresh,
selectedModel wurden alle übersprungen. Model existierte in DB aber war "leer".

**Fix:** Form-Reset/Close ans ENDE des Handlers verschoben — nach Photos, Location,
Refresh, selectedModel. Jetzt laufen alle Persistenz-Schritte garantiert.

### RC-2: Doppelte Consent-Prüfung in uploadModelPhoto (CRITICAL — FIXED)
**Problem:** `uploadModelPhoto` prüfte `hasRecentImageRightsConfirmation` unabhängig
vom Caller. Race-Condition zwischen `confirmImageRights` INSERT und dem SELECT konnte
ALLE Uploads silent blockieren (return null).

**Fix:** `skipConsentCheck` Option hinzugefügt. handleAddModel übergibt
`{ skipConsentCheck: true }` nachdem es bereits confirmImageRights + guardImageUpload
erfolgreich durchlaufen hat.

### RC-3: Location an Photo-Block gekoppelt (MODERATE — FIXED)
**Problem:** `upsertModelLocation` lag NACH dem Photo-Block. Jeder Early-Return in
Photos (RC-1) skippte auch Location.

**Fix:** Location-Write VOR den Photo-Upload-Block verschoben.

### RC-4: Mirror-Sync nur mit uploaded URLs (MODERATE — FIXED)
**Problem:** `syncPortfolioToModel(createdModelId, uploadedUrls)` nutzte NUR die
neu hochgeladenen URLs. Im Merge-Fall mit bestehenden model_photos überschrieb
das den Mirror mit unvollständigem Array.

**Fix:** `rebuildPortfolioImagesFromModelPhotos(createdModelId)` statt
`syncPortfolioToModel` — liest ALLE model_photos und baut kompletten Mirror.
Identisch zum Edit-Flow (ModelMediaSettingsPanel).

### RC-5: State-Degradation (FALSE ALARM)
**Analyse:** Die `models` Prop in MyModelsTab IST bereits `fullModels`
(volle SupabaseModels mit MODEL_DETAIL_SELECT). Keine Degradation.

### RC-6: Invite Resend ohne Auto-Regeneration (MODERATE — FIXED)
**Problem:** `handleResendModelClaimInvite` zeigte "No active claim token" wenn
alle Tokens abgelaufen waren — kein Weg einen neuen zu erzeugen.

**Fix:** Bei fehlendem gültigem Token wird automatisch `generateModelClaimToken`
aufgerufen und der neue Token für `resendInviteEmail` verwendet.

### RC-7: Silent Upload Failures (MODERATE — FIXED)
**Problem:** Wenn alle `uploadModelPhoto` calls null zurückgaben, lief der Flow
weiter ohne klare Warnung.

**Fix:** Expliziter Alert wenn `uploadedUrls.length === 0` obwohl Files vorhanden.

### RC-8: onRefresh() nicht awaited (MINOR — FIXED)
**Problem:** `handleSaveModel` rief `onRefresh()` ohne await, Completeness-Checks
liefen gegen stale data.

**Fix:** `await Promise.resolve(onRefresh())` mit try-catch.

## Nicht betroffen (verifiziert korrekt)

- **Location Source Priority** (live > current > agency): korrekt in upsert_model_location RPC
- **Portfolio vs Polaroid vs Private**: korrekt getrennt
- **Upload Technical Parity** (MIME, Magic Bytes, HEIC): korrekt
- **Soft-Delete / Reactivation**: ended_at wird in 20260518-Migration korrekt NULL gesetzt
- **Paywall / Auth Noise**: 401 auf can_access_platform vor Auth ist Startup-Noise

## Geänderte Dateien

| Datei | Änderungen |
|-------|-----------|
| `src/views/AgencyControllerView.tsx` | handleAddModel komplett restrukturiert (RC-1,3,4,7), Resend Auto-Regen (RC-6), await onRefresh (RC-8), unused import entfernt |
| `src/services/modelPhotosSupabase.ts` | skipConsentCheck Option in uploadModelPhoto (RC-2) |

## Qualitäts-Gates

- `npm run typecheck`: PASS (0 errors)
- `npm run lint`: PASS (0 errors, 4 pre-existing warnings)
- `npm test`: PASS (894 tests, 80 suites)

## Residual Risks

1. **Nominatim Geocoding Latency:** geocodeCityForAgency nutzt externe API; bei Timeout
   wird Location ohne Koordinaten gespeichert (share_approximate_location=false).
   Near-Me zeigt Model nicht, aber City/Country sind in models + model_locations korrekt.

2. **confirmImageRights RLS:** Wenn die image_rights_confirmations Tabelle SELECT-RLS
   hat die den gerade inserierten Row nicht zurückgibt, kann hasRecentImageRightsConfirmation
   in ModelMediaSettingsPanel (Edit-Flow) fehlschlagen. skipConsentCheck löst das nur für
   den Add-Flow. Langfristig: in-memory Cache in confirmImageRights.

3. **Multi-Tab Session:** Die Console-Logs zeigen ein SIGNED_OUT Event — könnte auf
   Session-Verlust in einem anderen Tab hindeuten. Nicht von diesem Fix abgedeckt.

## Final Status

**FINAL AGENCY MODEL LIFECYCLE HARDENING COMPLETE**
