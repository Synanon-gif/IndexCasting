# Option/Casting Status UX Verify

## Prüfungen

- [x] Model inbox zeigt konsistente Statuswörter
  - `in_negotiation` wird als `In negotiation` dargestellt (nicht mehr `Sent`).
- [x] Messages / Thread zeigt dazu passende Statuswörter
  - Thread-Pills nutzen weiterhin zentrale `optionRequestStatus*` Labels.
  - Approval-/No-app-/Final-Status-Texte in Agency/Client/Model nutzen zentrale `uiCopy`-Keys.
- [x] Casting vs Option bleibt verständlich
  - Kontextlabel bleibt explizit `Option` bzw. `Casting`.
  - Finale Kennzeichnung (`Confirmed` vs `Job confirmed`) bleibt differenziert.
- [x] Keine Regression in Farben / pills / badges
  - Badge-/Pill-Struktur und Farblogik unverändert; nur Textquellen/-labels harmonisiert.
- [x] Keine Änderung an zugrunde liegenden Statuswerten
  - `status`, `final_status`, `model_approval` unverändert.
- [x] Keine Änderung an Auth/Admin/Login/Paywall
  - Do-not-touch-Bereiche bleiben unberührt.

## Technische Verifikation
- `npm run typecheck`
- `npm run lint`
- `npm test -- --passWithNoTests --ci`

Ergebnis: erfolgreich ausgeführt (grün).
