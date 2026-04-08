# Option/Casting Status Test Hardening Report

## 1. Executive Summary
- Die harmonisierte Option/Casting-Statussprache wurde mit kleinen, robusten Regressionstests abgesichert.
- Fokus lag auf Mapping-/Display-Logik (`statusHelpers`) und zentraler Copy-Quelle (`uiCopy`), ohne Business-Logikänderungen.
- Zusätzlich wurde ein kleiner, klar harmloser Hardcode im direkten Surface-Kontext auf `uiCopy` umgestellt.

## 2. Welche Mappings jetzt automatisiert abgesichert sind
- `in_negotiation` -> `In negotiation` in `toDisplayStatus`.
- Priorität von `final_status` in der Display-Abbildung:
  - `option_confirmed` -> `Confirmed`
  - `job_confirmed` -> `Confirmed` (Display in `statusHelpers`)
- Farb-/Badge-Mapping für `In negotiation`:
  - `statusColor('In negotiation')`
  - `statusBgColor('In negotiation')`
- Zentrale `uiCopy`-Keys für Status-/Approval-/Kontextlabels:
  - `optionRequestStatusInNegotiation`
  - `optionRequestStatusConfirmed`
  - `optionRequestStatusJobConfirmed`
  - `optionRequestStatusPending`
  - `optionRequestModelApprovalApproved/Rejected/Pending/NoApp`
  - `threadContextOption/threadContextCasting`

## 3. Kleine UI-Copy-Sweeps
- Ein kleiner Hardcode-Sweep wurde gemacht:
  - In `ModelProfileScreen` wurde ein verbleibender `Option/Casting`-Hardcode im Option-Request-Bereich auf `uiCopy.dashboard.threadContext*` umgestellt.
- Größere/strukturelle Sweeps wurden bewusst nicht durchgeführt.

## 4. Was bewusst nicht angefasst wurde
- Keine Änderungen an:
  - `status`, `final_status`, `model_approval` (Rohstatuswerte / Business-Flows)
  - RPCs, RLS, Triggern, DB-Schema
  - Auth/Admin/Login/Paywall-Pfaden
- Keine großen Component-Snapshot-Tests oder fragile Render-Test-Suiten.

## 5. Warum Business-Logik/Auth/Admin/Login unberührt blieb
- Alle Änderungen sind auf Unit-Tests, zentrale Copy-Prüfungen und minimale Display-Hardcodes begrenzt.
- Do-not-touch-Bereiche wurden nicht verändert (`App.tsx`, `AuthContext`, Admin-/Paywall-Kernlogik usw.).

## 6. Nächste kleine sinnvolle Schritte
- Optional: Ein kleiner weiterer statischer Copy-Check für nahe, nicht-kritische Option/Casting-Strings in denselben 3 Surfaces.
- Optional: Ein sehr gezielter Test für konsistente Nutzung von `uiCopy.dashboard.threadContext*` in zusätzlichen Display-Helpers (falls künftig ein Helper eingeführt wird).
