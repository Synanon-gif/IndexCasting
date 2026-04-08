# Security Audit A — Diff Plan (minimal-invasiv)

Priorisiert nach Risiko. **Keine** Änderungen an Auth-Kern (`bootstrapThenLoadProfile`, `get_my_org_context`, Paywall-Core), sofern nicht ausdrücklich freigegeben.

---

## P0 — HIGH: Client darf `calendar_entries` bei gültiger Option aktualisieren

**Problem:** Live hat nur `calendar_entries_update_agency` und `calendar_entries_model_self_update`. [`updateBookingDetails`](src/services/calendarSupabase.ts) wird aus Client-, Agency- und Model-UI aufgerufen.

**Option A (empfohlen — rein RLS):** Neue Policy `calendar_entries_update_client_scoped` auf `public.calendar_entries` für `authenticated`:

- `USING` / `WITH CHECK`: spiegeln die **Client-Zweige** von `calendar_entries_select_scoped` (direkter `option_requests`-Match mit `client_id = auth.uid()` **oder** Org-Member über `organization_members` + `organization_id` der Option, `status <> 'rejected'`).
- Optional: zusätzlich `option_request_id = calendar_entries.option_request_id` verknüpfen, falls Spalte gesetzt (präziser als nur `model_id`).

**Option B (alternativ — SECDEF):** RPC `patch_calendar_booking_details(p_option_request_id, p_patch jsonb)` mit internen Guards (Caller ist Client- oder Agency-Partei der Option) und Merge im Server — nur wenn Field-Level-Enforcement gewünscht; höherer Aufwand, berührt Invariante 7 bewusst.

**Nicht** ohne Review: breites `UPDATE` für alle Clients auf alle Kalenderzeilen.

---

## P1 — HIGH: Kanonische Migration für `calendar_entries` RLS

**Problem:** `supabase/migrations/20260406_fix_for_all_calendar_mmc.sql` dokumentiert Policies, die dort nicht vollständig erstellt werden.

**Fix:** Neue Datei `supabase/migrations/YYYYMMDD_calendar_entries_rls_canonical.sql`:

1. `DROP POLICY IF EXISTS` für alle bekannten Policy-Namen auf `calendar_entries` (idempotent, Liste mit Live abgleichen).
2. `CREATE POLICY` für: `calendar_entries_select_scoped`, `calendar_entries_write_agency`, `calendar_entries_update_agency`, `calendar_entries_delete_agency`, `calendar_entries_model_self_{insert,update,delete}`, **plus** neue Client-Update-Policy aus P0.
3. Keine Änderung der **Semantik** gegenüber aktuellem Live-Stand außer bewusster Ergänzung (P0).

Danach: Deploy per Projektregeln + `pg_policies`-Verify.

---

## P2 — MEDIUM (optional): Booking-Brief serverseitig

Nur falls Produkt von „UI-only“ weg will: SECDEF-Merge mit Scope-Validierung pro Feld — **Security/Product Review Pflicht**; sonst belassen und in Legal/Docs als „same trust as notes“ führen.

---

## P3 — LOW: `link_model_by_email` Entfernung

Langfristig: Calls aus `AuthContext` entfernen, wenn alle Agencies auf Token-Claim umgestellt (Risiko 9 in Projektregeln). Nicht Teil dieses Minimal-Fix-Sprints.

---

## P4 — VERIFY nach jedem SQL-Deploy

- `SELECT policyname, cmd FROM pg_policies WHERE tablename = 'calendar_entries' ORDER BY 1;`
- Kein SELECT mit `qual = true` für `calendar_entries`.
- Manuelles UI: Client speichert Brief → erwartet Erfolg (kein RLS-Fehler in Network-Tab).
