# Option/Casting Status Test Hardening Verify

## Fachliche Prüfungen
- [x] Display-Mapping für `in_negotiation` ist abgesichert.
- [x] Approval-Labels sind abgesichert (approved/rejected/pending/no-app).
- [x] Final-Labels sind abgesichert (`Confirmed`, `Job confirmed`, `Pending`).
- [x] Option/Casting-Kontextlabels sind über zentrale Copy-Keys abgesichert.
- [x] Keine Änderung an DB-Rohstatuswerten (`status`, `final_status`, `model_approval`).
- [x] Keine Änderung an Auth/Admin/Login/Paywall.

## Technische Prüfungen
- [x] `npm run typecheck`
- [x] `npm run lint`
- [x] `npm test -- --passWithNoTests --ci`

Ergebnis: Alle drei Qualitätsläufe grün.
