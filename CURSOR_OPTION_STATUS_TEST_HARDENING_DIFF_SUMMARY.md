# Option/Casting Status Test Hardening Diff Summary

## Geänderte Dateien
- `src/utils/__tests__/statusHelpers.test.ts` (neu)
- `src/constants/__tests__/optionStatusCopy.test.ts` (neu)
- `src/screens/ModelProfileScreen.tsx`
- `CURSOR_OPTION_STATUS_TEST_HARDENING_REPORT.md` (neu)
- `CURSOR_OPTION_STATUS_TEST_HARDENING_DIFF_SUMMARY.md` (neu)
- `CURSOR_OPTION_STATUS_TEST_HARDENING_VERIFY.md` (neu)
- `CURSOR_OPTION_STATUS_TEST_HARDENING_PLAN.json` (neu)

## Zweck
- Regressionen der harmonisierten Status-UX früh erkennen.
- Zentrale Status-/Approval-/Final-Labels auf stabile, testbare Quelle absichern.
- Einen verbleibenden lokalen Hardcode im direkten Option/Casting-Umfeld sicher auf `uiCopy` ziehen.

## Risiko
- Sehr niedrig.
- Keine Business-Logik- oder Backend-Änderung.
- Keine Berührung von Auth/Admin/Login/Paywall.
- Tests sind klein, deterministisch und ohne fragile Snapshot-Abhängigkeit.

## Testbezug
- Neue Unit-Tests für `statusHelpers` und `uiCopy`-Statuskeys.
- Gesamtlauf: `typecheck`, `lint`, `test` grün.
