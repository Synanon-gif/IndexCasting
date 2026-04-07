# CURSOR_REMEDIATION_DIFF_SUMMARY.md

## Geplante / erwartete Änderungen (nach Agent-Modus)

| Datei | Zweck | Risiko | Testbezug |
|-------|--------|--------|-----------|
| `supabase/migrations/20260426_remediation_three_policies_no_profiles_rls.sql` | DROP/CREATE nur 3 Policies; entfernt `profiles.role`-Heuristik | Niedrig wenn Agency-/Client-Nutzer wie bei `models` angebunden sind; Legacy nur `bookers` weiterhin für Agency-Seite | SQL in [CURSOR_REMEDIATION_SQL_VERIFY.md](CURSOR_REMEDIATION_SQL_VERIFY.md); manuell: Invites lesen/updaten, Client-Fotos |
| `CURSOR_REMEDIATION_REPORT.md` | Executive Summary + Top-20-Hinweis | Keine | Dokumentation |
| `CURSOR_REMEDIATION_SQL_VERIFY.md` | Verifikationsqueries | Keine | T-SQL-001 |
| `CURSOR_REMEDIATION_DIFF_SUMMARY.md` | Diff-Übersicht | Keine | — |
| `CURSOR_REMEDIATION_NEXT_STEPS.json` | Maschinenlesbare Next Steps | Keine | — |

## Nicht geändert

- `src/context/AuthContext.tsx`, `App.tsx`, alle Admin-DB-Guards laut Auftrag.
- Keine TypeScript-Service-Änderungen nötig für reine RLS-Migration.

## Rollback

Vorherige Policy-Definitionen aus [CHATGPT_LIVE_DB_STATE.txt](CHATGPT_LIVE_DB_STATE.txt) bzw. `migration_prelaunch_security_fixes.sql` + `migration_hardening_2026_04_final.sql` + `migration_pentest_fullaudit_fixes_2026_04.sql` archivieren und bei Bedarf manuell wiederherstellen.
