# Option/Casting Status UX Diff Summary

## Geänderte Dateien
- `src/utils/statusHelpers.ts`
- `src/constants/uiCopy.ts`
- `src/web/ClientWebApp.tsx`
- `src/views/AgencyControllerView.tsx`
- `src/screens/ModelProfileScreen.tsx`
- `CURSOR_OPTION_STATUS_UX_REPORT.md`
- `CURSOR_OPTION_STATUS_UX_DIFF_SUMMARY.md`
- `CURSOR_OPTION_STATUS_UX_VERIFY.md`
- `CURSOR_OPTION_STATUS_UX_PLAN.json`

## Zweck
- Status- und Approval-Texte im Option-/Casting-UX vereinheitlichen.
- Hardcoded Statussprache in relevanten Badges/Pills/Bannern auf zentrale `uiCopy`-Keys umstellen.
- `in_negotiation` im Display konsistent als `In negotiation` darstellen.

## Risiko
- Niedrig.
- Keine Änderungen an Auth/Admin/Login/Paywall.
- Keine Änderungen an DB-Statusmodellen, RPCs, RLS, Triggern oder Business-Transitions.
- Änderungen sind auf Copy-/Mapping-/Anzeigeebene begrenzt.

## Testbezug
- Typecheck/Lint/Tests wurden nach den Änderungen ausgeführt (siehe Verify-Datei).
- Verify-Checkliste deckt die betroffenen UX-Surfaces und Nicht-Regressionskriterien ab.
