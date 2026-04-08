# Client Assignment Diff Summary

## Geaenderte Dateien

- `supabase/migrations/20260408_client_assignment_flags_foundation.sql`
- `src/services/clientAssignmentsSupabase.ts`
- `src/services/__tests__/clientAssignmentsSupabase.test.ts`
- `src/store/optionRequests.ts`
- `src/web/ClientWebApp.tsx`
- `src/components/OrgMessengerInline.tsx`
- `docs/CLIENT_ASSIGNMENT_FLAG_SYSTEM.md`
- `CURSOR_CLIENT_ASSIGNMENT_REPORT.md`
- `CURSOR_CLIENT_ASSIGNMENT_VERIFY.md`
- `CURSOR_CLIENT_ASSIGNMENT_PLAN.json`

## Zweck

- Additive Foundation fuer Agency-internes Client-Flagging + Assignment
- Anzeige in High-Impact Surfaces (Requests, Threads, Calendar)
- MVP-Filter fuer operative Teamarbeit

## Risiko

- Niedrig bis mittel (UI-/Service-additiv, keine Auth-/Paywall- oder Kern-Routing-Aenderung)
- Migrationsrisiko gering durch neue dedizierte Tabelle ohne Eingriff in bestehende Kern-Tabellen

## Testbezug

- Neuer Unit-Test fuer Assignment-Service
- Bestehende Test-/Typecheck-/Lint-Pipeline auszufuehren:
  - `npm run typecheck`
  - `npm run lint`
  - `npm test -- --passWithNoTests --ci`
