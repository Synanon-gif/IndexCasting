# CURSOR_OPTION_UPLOAD_AUDIT_VERIFY

## Konkrete Prüfungen

- [x] Upload-Flow funktioniert weiter
  - `uploadOptionDocument` behält dieselbe technische Upload-Pipeline (HEIC -> validate -> magic -> extension -> sanitize -> storage limit -> upload mit `upsert: false`).
- [x] Logging/Audit-Kontext verbessert sich wie beabsichtigt
  - Nach erfolgreichem Upload wird Org-Kontext aus `option_requests` geholt.
  - Bei vorhandener Org wird `logAction(... action='option_document_uploaded', source='api')` ausgelöst.
- [x] Keine Regression in bestehender Validierung
  - File-Validierung und Storage-Checks unverändert.
- [x] Keine Änderung an Auth/Admin/Login/Paywall
  - Do-not-touch-Bereiche unangetastet.

## Technische Verifikation
- `npm run typecheck`
- `npm run lint`
- `npm test -- --passWithNoTests --ci`

Ergebnis: grün.
