# Security Audit A — Fix Sprint Report (H1 + H2)

## Scope

- **H1:** Client konnte `calendar_entries` / `booking_details` nicht zuverlässig per RLS aktualisieren, obwohl `updateBookingDetails()` aus der Client-UI aufgerufen wird.
- **H2:** Vollständige `calendar_entries`-RLS fehlte als kanonische datierte Migration unter `supabase/migrations/`.

## Entscheidung (P2)

**Option A — neue RLS-Policy** (kein SECDEF-RPC): minimal, konsistent mit bestehendem SELECT-Modell, eng an `option_request_id` + `option_requests` gekoppelt.

## Implementierung

### Datenbank

- Neue Migration: [`supabase/migrations/20260502_calendar_entries_rls_canonical_client_update.sql`](supabase/migrations/20260502_calendar_entries_rls_canonical_client_update.sql)
  - Idempotent: `DROP POLICY IF EXISTS` für alle bekannten Policy-Namen auf `calendar_entries` (inkl. Legacy).
  - Neu erstellt: `calendar_entries_select_scoped`, `calendar_entries_write_agency` (ohne `created_by_agency`-Bypass), `calendar_entries_update_agency`, `calendar_entries_delete_agency`, `calendar_entries_model_self_{insert,update,delete}`.
  - **H1:** `calendar_entries_update_client_scoped` — UPDATE nur wenn `option_request_id IS NOT NULL`, Zeile passt zu `option_requests` (`id`, `model_id`, `status <> rejected`), Caller ist `client_id` **oder** Mitglied der Client-Org (`organizations.type = 'client'`).
  - `COMMENT ON POLICY` dokumentiert: kein JSONB-Feld-Stripping.

### Anwendung / Doku

- [`src/services/calendarSupabase.ts`](src/services/calendarSupabase.ts): Kommentar bei `updateBookingDetails` — RLS-Parität + Trust-Modell.
- [`docs/BOOKING_BRIEF_SYSTEM.md`](docs/BOOKING_BRIEF_SYSTEM.md): Abschnitt „Backend permission parity (RLS)“.
- [`docs/LIVE_DB_DRIFT_GUARDRAIL.md`](docs/LIVE_DB_DRIFT_GUARDRAIL.md): Abschnitt „Example: calendar_entries RLS“.
- Guardrails: [`.cursor/rules/system-invariants.mdc`](.cursor/rules/system-invariants.mdc), [`.cursor/rules/auto-review.mdc`](.cursor/rules/auto-review.mdc), [`.cursorrules`](.cursorrules).

## Nicht geändert (Do-Not-Touch)

- `AuthContext`, `App.tsx`, `bootstrapThenLoadProfile`, `get_my_org_context`, Admin-RPCs, Paywall-Core, Invite/Claim-Flows.

## Live-Deploy

- Migration per Management API gegen Production ausgeführt; **HTTP 201**.
- Verifikation: `pg_policies` listet `calendar_entries_update_client_scoped` unter UPDATE; SELECT weiterhin nur `calendar_entries_select_scoped` (kein `USING (true)`).

## Booking Brief Grenze (P5)

- Unverändert: **keine** serverseitige feldweise Isolation von `booking_brief` im JSONB; wer die Zeile lesen darf, kann weiterhin volles `booking_details` per API erhalten. Der Fix schließt nur die **Schreib-Parität** für die Client-Partei.

## Abschlusszeile

**SECURITY AUDIT A FIXES APPLIED**

Audit B ist nach kurzer Regression (Client speichert Brief, Agency/Model unverändert) sinnvoll.
