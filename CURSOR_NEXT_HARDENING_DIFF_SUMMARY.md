# CURSOR_NEXT_HARDENING_DIFF_SUMMARY

| Datei | Zweck | Risiko | Tests |
|-------|--------|--------|--------|
| [docs/LIVE_DB_DRIFT_GUARDRAIL.md](docs/LIVE_DB_DRIFT_GUARDRAIL.md) | Projekt-Doku Live vs. Root-SQL vs. Migrations | Keins | — |
| [.cursorrules](.cursorrules) | Verweise Drift-Doku + chat-files Upload-Parity | Keins | — |
| [.cursor/rules/auto-review.mdc](.cursor/rules/auto-review.mdc) | Checkpoint Root-SQL / Live-Verifikation | Keins | — |
| [.cursor/rules/dev-workflow.mdc](.cursor/rules/dev-workflow.mdc) | Security-Release + Drift-Referenz | Keins | — |
| [.cursor/rules/system-invariants.mdc](.cursor/rules/system-invariants.mdc) | Diagnose-SQL-Konvention | Keins | — |
| [.cursor/rules/upload-consent-matrix.mdc](.cursor/rules/upload-consent-matrix.mdc) | Single pipeline chat-files | Keins | — |
| [lib/validation/file.ts](lib/validation/file.ts) | `sanitizeUploadBaseName`, Konstante | Niedrig — rein string | Unit |
| [lib/validation/index.ts](lib/validation/index.ts) | Re-exports | Niedrig | — |
| [lib/validation/__tests__/validation_hardening.test.ts](lib/validation/__tests__/validation_hardening.test.ts) | Tests Sanitizer | Niedrig | Jest |
| [src/services/documentsSupabase.ts](src/services/documentsSupabase.ts) | Nutzt Sanitizer statt Inline | Niedrig — gleiche Logik | Indirekt |
| [src/services/optionRequestsSupabase.ts](src/services/optionRequestsSupabase.ts) | Nutzt Sanitizer | Niedrig | Indirekt |
| [src/services/messengerSupabase.ts](src/services/messengerSupabase.ts) | HEIC strikter, upsert/contentType, sanitizer | Mittel — strenger HEIC-Fail, Pfad kann sich ändern | Manuell Smoke |
| [src/services/recruitingChatSupabase.ts](src/services/recruitingChatSupabase.ts) | Wie Messenger | Mittel | Manuell Smoke |
| [supabase/migrations/20260428_agency_invitations_insert_no_profiles_role.sql](supabase/migrations/20260428_agency_invitations_insert_no_profiles_role.sql) | INSERT RLS ohne profiles.role | Niedrig für Login; Agency-Invite-Verhalten prüfen | SQL live |
| [CURSOR_NEXT_HARDENING_*.md](CURSOR_NEXT_HARDENING_REPORT.md) / [.json](CURSOR_NEXT_HARDENING_PLAN.json) | Reports | Keins | — |

`npm run typecheck`, `npm run lint`, `npm test -- --passWithNoTests --ci` — grün nach P2.
