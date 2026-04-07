# CURSOR_NEXT_HARDENING_REPORT

**Abschluss-Label:** `SAFE NEXT HARDENING APPLIED`

## Executive Summary

Diese Welle liefert Drift-Guardrails (Doku + Cursor-Regeln), vereinheitlicht die technische Upload-Pipeline für `chat-files` (Messenger + Recruiting) mit einem gemeinsamen Basename-Sanitizer, und ersetzt die verbleibende `agency_invitations`-INSERT-Policy, die noch `profiles.role = 'agent'` nutzte, durch dasselbe Agency-/Membership-Muster wie die Remediation vom 2026-04-26 — **ohne** Eingriffe in AuthContext, App-Routing, Admin-RPCs oder `get_my_org_context()`.

## P1 — Root-SQL / Drift

- Neu: [docs/LIVE_DB_DRIFT_GUARDRAIL.md](docs/LIVE_DB_DRIFT_GUARDRAIL.md) (Root-SQL vs. Migrations vs. Live-DB, Live-Verifikation nach SECDEF-Fixes, Konvention für Diagnose-Skripte).
- Ergänzt: [.cursorrules](.cursorrules), [.cursor/rules/auto-review.mdc](.cursor/rules/auto-review.mdc) §2a, [.cursor/rules/dev-workflow.mdc](.cursor/rules/dev-workflow.mdc), [.cursor/rules/system-invariants.mdc](.cursor/rules/system-invariants.mdc).

## P2 — Upload-Parität

- `sanitizeUploadBaseName` + `DEFAULT_UPLOAD_BASENAME_MAX_LEN` in [lib/validation/file.ts](lib/validation/file.ts), exportiert über [lib/validation/index.ts](lib/validation/index.ts).
- [src/services/documentsSupabase.ts](src/services/documentsSupabase.ts) und [src/services/optionRequestsSupabase.ts](src/services/optionRequestsSupabase.ts) nutzen den gemeinsamen Helfer.
- [src/services/messengerSupabase.ts](src/services/messengerSupabase.ts): `convertHeicToJpegWithStatus` mit Abbruch bei Konvertierungsfehler; `upsert: false`; `contentType`; sanitizter Pfad-Basename.
- [src/services/recruitingChatSupabase.ts](src/services/recruitingChatSupabase.ts): gleiche `chat-files`-Parität (identische Lücken wie Messenger).
- Matrix: [.cursor/rules/upload-consent-matrix.mdc](.cursor/rules/upload-consent-matrix.mdc) — Abschnitt *Single pipeline for chat-files browser uploads*; [.cursorrules](.cursorrules) kurz verlinkt.

## P3 — `Agents can insert own agency invitations`

- **Umgesetzt:** [supabase/migrations/20260428_agency_invitations_insert_no_profiles_role.sql](supabase/migrations/20260428_agency_invitations_insert_no_profiles_role.sql) — nur diese Policy.
- **Login-/Admin-Pfad:** Tabelle `agency_invitations`, kein `profiles`-SELECT für Login; keine `profiles.is_admin`-Policy; keine Änderung an `profiles`- oder `models`-SELECT-Ketten.
- **Live:** Migration per Management-API angewendet (HTTP 201); `WITH CHECK` live ohne `profiles`-Referenz verifiziert.

## P4 — SECDEF Shortlist

Siehe [CURSOR_NEXT_HARDENING_PLAN.json](CURSOR_NEXT_HARDENING_PLAN.json) → `secdef_shortlist` (nächste Review-Welle, keine Umsetzung in dieser Session).

## Admin-/Login-Pfad unberührt

Keine Änderungen an AuthContext, App.tsx, `signIn`, `bootstrapThenLoadProfile`, `loadProfile`, Admin-Routing, `get_own_admin_flags`, `is_current_user_admin`, `assert_is_admin`, `get_my_org_context()`.

## Bewusst nicht angefasst

- Massen-RLS-/SECDEF-Refactors, Root-SQL-Löschungen, M-006/M-009/M-016-Bereiche, Invite-/Claim-/Guest-Navigation im Frontend.
- Weitere `agency_invitations`-Policies außer der genannten INSERT-Policy.
