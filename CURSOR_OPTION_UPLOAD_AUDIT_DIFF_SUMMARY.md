# CURSOR_OPTION_UPLOAD_AUDIT_DIFF_SUMMARY

## Geänderte Dateien
- `src/services/optionRequestsSupabase.ts`
- `src/services/__tests__/optionRequestsUploadAudit.test.ts`
- `docs/OPTION_CASTING_UPLOAD_AUDIT.md`
- `CURSOR_OPTION_UPLOAD_AUDIT_REPORT.md`
- `CURSOR_OPTION_UPLOAD_AUDIT_VERIFY.md`
- `CURSOR_OPTION_UPLOAD_AUDIT_PLAN.json`

## Zweck
- Org-zentrierten Audit-Trail für Option-Dokument-Uploads ergänzen.
- Sicherstellen, dass `option_document_uploaded` mit `orgId` und `source='api'` geloggt wird, wenn Org-Kontext vorhanden ist.
- Audit- und Scope-Ergebnis dokumentieren.

## Risiko
- Niedrig.
- Änderung ist lokal in einem Upload-Pfad, ohne Schema-/RLS-/Auth-/Paywall-Eingriff.
- Fallback bei fehlendem Org-Kontext bleibt fail-safe und blockiert Upload nicht.

## Testbezug
- Neuer Unit-Test: `src/services/__tests__/optionRequestsUploadAudit.test.ts`.
- Zusätzlich vollständige Projekt-Pipeline:
  - `npm run typecheck`
  - `npm run lint`
  - `npm test -- --passWithNoTests --ci`
