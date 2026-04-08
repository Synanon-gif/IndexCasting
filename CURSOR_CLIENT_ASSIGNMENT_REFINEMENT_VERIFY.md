# Client Assignment Refinement Verify

## 1) Assignment an kanonischer Stelle setzen

- Agency -> Clients Tab oeffnen
- Client-Zeile zeigt Assignment-Status
- `Edit assignment` nutzen (Flag + Assignee)
- Erwartung: Status in derselben Zeile sofort sichtbar

## 2) Owner-only Agency funktioniert

- Setup mit nur Owner (keine Booker)
- `Assign to me` klickbar
- Erwartung: Assignment wird gespeichert, ohne Booker-Abhaengigkeit

## 3) Booker-Zuweisung funktioniert

- Bei vorhandenen Team-Mitgliedern im Edit-Bereich einen Member waehlen
- Erwartung: Name wird als Assignment-Metadatum angezeigt

## 4) Assignment ohne Sichtbarkeitsaenderung

- Zwei Agency-Mitglieder vergleichen Request-/Chat-/Calendar-Sicht
- Erwartung: gleiche Datensicht, nur unterschiedliche Filter/Ownership-Hinweise

## 5) Pre-chat Assignment

- Im Clients Tab Assignment setzen, ohne `Start chat` auszufuehren
- Danach in Messages/Calendar Kontext schauen
- Erwartung: Assignment-Metadaten sind nutzbar, Chat ist keine Voraussetzung

## 6) Konsistenz der Filter

- In Agency Option-Request-Threads pruefen:
  - `My clients`
  - `Unassigned`
  - `Any flag` / konkreter Flag
- Erwartung: Filter semantisch konsistent zu Assignment-Daten

## 7) Regression-Checks

- Keine Auth/Login/Admin/Paywall Regression
- Keine Aenderung an `get_my_org_context`
- Keine Assignment-basierte Zugriffsbeschraenkung

## 8) Quality Gates

- `npm run typecheck` ✅
- `npm run lint` ✅
- `npm test -- --passWithNoTests --ci` ✅
