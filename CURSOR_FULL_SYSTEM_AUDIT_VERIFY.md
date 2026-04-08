# CURSOR_FULL_SYSTEM_AUDIT_VERIFY

## Automated / CLI (bei künftigen Code-Änderungen)

```bash
cd /Users/rubenjohanneselge/Desktop/Final_IndexC/IndexCasting && \
npm run typecheck && \
npm run lint && \
npm test -- --passWithNoTests --ci
```

## Live-Datenbank (optional, wenn `.env.supabase` verfügbar)

Aus `.cursor/rules/auto-review.mdc` §2b (Auszug — vor/nach sicherheitsrelevanten Migrationen):

- FOR ALL auf Watchlist-Tabellen: `model_embeddings`, `model_locations`, `model_agency_territories`, `calendar_entries`, `model_minor_consent`
- `profiles.is_admin = true` in Policy-`qual`
- `model_agency_territories`: keine Self-Reference (`self_mat`, `FROM public.model_agency_territories`)

Zusätzlich bei RPC-Änderungen: `pg_get_functiondef` für betroffene Routinen (siehe `docs/LIVE_DB_DRIFT_GUARDRAIL.md`).

## Role-based manual checks (Regression)

| Check | Erwartung |
|-------|-----------|
| Admin-Login | Admin-Dashboard nach Login; kein Zurück auf Auth durch `effectiveRole` |
| Agency mit gültigem Abo | Voller Workspace; Model Single-Save inkl. Location-Agency-Pfad |
| Agency ohne Zugang | Paywall-Screen (UI); API weiterhin durch DB geblockt |
| Client analog | Wie Agency-Paywall-Guard |
| Model | Profil bearbeiten; pending Option sichtbar wenn verknüpft |
| Option → Calendar | Bestätigte Option erzeugt/behält Kalender-Hooks laut bestehendem Verhalten |
| Booking Brief | Party-only Felder in fremder Rolle nicht in UI; JSON-Trust wie Notes |

## Accepted limits vs. bugs

- **Booking Brief / Notes:** UI-gefiltertes JSON bei vollem Row-SELECT = **accepted architectural limit**, kein Bug solange Produktvertrag unverändert.
- **Mediaslide/Netwalk:** Teilfeld-Sync über `agency_update_model_full` = **accepted**, kein Bug — vollständige Spiegelung ist kein Anspruch ohne Produktspec.
- **Legacy option_requests org columns:** OR-Filter = bekannte Übergangsphase — bei Datenmigration **MANUAL_REVIEW**.

## Audit pass outcome

- **Artefakte:** vier `CURSOR_FULL_SYSTEM_AUDIT_*` Dateien im Repo-Root.
- **Code diff:** leer.

`FULL SYSTEM AUDIT COMPLETED`
