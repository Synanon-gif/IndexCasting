# Security Audit A — Fix Verification

## Automatisiert (bereits ausgeführt)

1. Migration SQL gegen Live: **HTTP 201**
2. `SELECT policyname, cmd FROM pg_policies WHERE tablename = 'calendar_entries'`:
   - **UPDATE:** `calendar_entries_update_agency`, `calendar_entries_model_self_update`, `calendar_entries_update_client_scoped`
   - **SELECT:** nur `calendar_entries_select_scoped` (kein offenes `true`)

## Manuell (empfohlen vor Audit B)

| # | Check | Erwartung |
|---|--------|-----------|
| 1 | Client mit nicht-rejected Option: Booking Brief speichern | Kein RLS-Fehler; `calendar_entries` UPDATE erfolgreich |
| 2 | Agency: `booking_details` / Brief speichern | Unverändert ok |
| 3 | Model: eigener Kalender-Eintrag bearbeiten | Unverändert ok |
| 4 | Client ohne Option / falsche Option: UPDATE versuchen (API) | Verweigert |
| 5 | Rejected Option: Client-UPDATE | Verweigert (`status <> rejected`) |
| 6 | `SELECT` auf `calendar_entries`: qual nicht `true` für authenticated-wide read | Bestätigt |

## Build

```bash
npm run typecheck && npm run lint && npm test -- --passWithNoTests --ci
```

## Regression ausgeschlossen (Stichprobe)

- Keine Änderung an Auth-, Admin-, Paywall-Codepfaden in diesem Sprint.
