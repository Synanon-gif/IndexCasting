# Agency Model Request Storm — Verify Checklist

**Datum:** 2026-05-15

## Automatische Checks

| Check | Ergebnis |
|-------|----------|
| `npm run typecheck` | ✅ 0 Errors |
| `npm run lint` | ✅ 0 Errors |
| `npm test -- --passWithNoTests --ci` | ✅ 847/847 |

## Live-DB Verifikation

| Check | Ergebnis |
|-------|----------|
| Migration `20260515_fix_generate_model_claim_token_no_pgcrypto.sql` deployed | ✅ HTTP 201 |
| `generate_model_claim_token` existiert auf Live-DB | ✅ |
| `gen_random_bytes` nicht mehr in der Funktion | ✅ `pg_get_functiondef` bestätigt `sha256(gen_random_uuid()::text::bytea)` |

## Manuelle Verifikation (nach Deployment)

1. **generateModelClaimToken funktioniert wieder**
   - Agency → My Models → Add Model mit E-Mail → Claim-Token sollte generiert werden ohne `gen_random_bytes`-Fehler

2. **Kein Request-Storm bei Model-Edit**
   - Agency → My Models → Model auswählen → Media-Panel öffnet sich
   - Nur 3× GET `model_photos` (portfolio/polaroid/private) + 2× POST `agency_update_model_full` beim initialen Load
   - Keine Wiederholung ohne explizite User-Aktion
   - Kein `ERR_INSUFFICIENT_RESOURCES` mehr

3. **Portfolio-Foto persistiert nach Upload**
   - Agency lädt Foto hoch → nach Reload noch sichtbar
   - `models.portfolio_images` wird korrekt synchronisiert

4. **Completeness entfernt "No visible portfolio photo"**
   - Wenn sichtbares Portfolio-Foto vorhanden: Warnung verschwindet

5. **Location persistiert nach Save**
   - City/Country speichern → nach Reload noch vorhanden
   - (War ein Folgeproblem des Request-Storms — sollte nach Fix automatisch funktionieren)

6. **Consent-Checkbox resettet bei Model-Wechsel**
   - Zu anderem Model wechseln → `imageRightsConfirmed` Checkbox startet auf false
   - Audit-Fenster (`rightsAuditWindowActive`) wird korrekt neu geladen

7. **send-invite chain funktioniert wieder**
   - generateModelClaimToken → Token in DB → Edge Function `send-invite` → Mail raus
