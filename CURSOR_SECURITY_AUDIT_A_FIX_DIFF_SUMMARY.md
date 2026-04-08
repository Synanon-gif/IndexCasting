# Security Audit A — Fix Diff Summary

| Bereich | Änderung |
|---------|----------|
| DB | `supabase/migrations/20260502_calendar_entries_rls_canonical_client_update.sql` — kanonische `calendar_entries` RLS + `calendar_entries_update_client_scoped` |
| Service | `src/services/calendarSupabase.ts` — Kommentar `updateBookingDetails` (RLS + Trust-Modell) |
| Docs | `docs/BOOKING_BRIEF_SYSTEM.md` — RLS-Parität Abschnitt |
| Docs | `docs/LIVE_DB_DRIFT_GUARDRAIL.md` — `calendar_entries` Beispiel |
| Rules | `.cursor/rules/system-invariants.mdc`, `.cursor/rules/auto-review.mdc`, `.cursorrules` — Guardrails |

Keine Änderungen an: `AuthContext.tsx`, `App.tsx`, Paywall, Admin-Guards, Invite/Claim.
