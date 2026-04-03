# Supabase Schema – Casting Index

## Ausführung

1. Im [Supabase Dashboard](https://supabase.com/dashboard) dein Projekt öffnen.
2. **SQL Editor** → **New query**.
3. Inhalt von `schema.sql` einfügen und **Run** ausführen.

Falls du die Reihenfolge anpassen willst: Zuerst alle Enums und Tabellen, dann RLS, dann Trigger.

**Manuelle Kalender-Ereignisse (Kunde/Agentur):** Nach dem Basis-Schema zusätzlich `migration_user_calendar_events.sql` ausführen. Dann sind Tabelle `user_calendar_events`, RLS und Trigger für eigene Termine aktiv.

**Apply as Model + Model-E-Mail-Verknüpfung:** Zusätzlich `migration_apply_model_and_email.sql` ausführen. Dann: Bewerbungen mit Account verknüpft (`applicant_user_id`), Models mit E-Mail-Feld, Apply nur noch nach Login; RPC `link_model_by_email` für Zuordnung nach Sign-up.

**Eigenes Konto löschen (30 Tage Archiv):** Zusätzlich `migration_account_self_deletion.sql` ausführen.

**Admin-Profil-Änderungen speichern:** Zusätzlich `migration_admin_profile_update.sql` ausführen. Dann werden Admin-Änderungen an Nutzerprofilen (Name, E-Mail, Rolle, is_active, is_admin usw.) über die RPC `admin_update_profile_full` geschrieben und zuverlässig in der DB gespeichert (umgeht RLS). Nutzer können in den Einstellungen ihr Konto zur Löschung anmelden; Daten bleiben 30 Tage archiviert. Nach 30 Tagen müssen die Einträge endgültig gelöscht werden: z.B. eine geplante Edge Function, die `get_accounts_to_purge()` aufruft und für jede zurückgegebene `user_id` die Supabase Admin API `auth.admin.deleteUser(user_id)` ausführt (CASCADE räumt dann die öffentlichen Tabellen).

**My Models (Roster, Soft-Delete, Account-Link):** `migration_model_roster_soft_delete.sql` — `agency_relationship_status` (`active` / `pending_link` / `ended`), Soft-End statt `agency_id` löschen; RPC `agency_link_model_to_user` für manuelle Verknüpfung nach API-Import.

**Identität, Verhandlung, Kalender-Spiegelung:** `migration_identity_negotiation_calendar.sql` — `agencies.logo_url`, `user_calendar_events.source_option_request_id`, Trigger bei `option_requests.final_status = option_confirmed` (Client- und Agentur-Kalender). Im SQL Editor ausführen, nachdem `user_calendar_events` existiert.

**Model-Fotos (Portfolio, manueller Upload, Cover):** Dafür müssen **Phase 13** und **Phase 14** ausgeführt sein:
- `migration_phase13_enhancements.sql` – legt die Tabelle `model_photos` und RLS an.
- `migration_phase14_options_jobs_castings.sql` – fügt die Spalte `photo_type` (portfolio/polaroid) in `model_photos` hinzu.

Die Tabelle `models` hat bereits die Spalte `portfolio_images` (TEXT[]); sie wird vom Code mit der geordneten URL-Liste synchron gehalten (erstes Bild = Cover für Client-Swipe).

**Storage (Privater Bucket mit Signed URLs):** Model-Fotos und Bewerbungsbilder liegen im **privaten** Bucket **`documentspictures`** (Pfade `model-photos/{modelId}/...` und `model-applications/...`). Der Bucket **`documents`** ist ebenfalls **privat**. Bilder werden **niemals** über öffentliche URLs ausgeliefert – ausschließlich über kurzlebige **Signed URLs** (TTL 3600 s), die der Client über `supabase.storage.from('documentspictures').createSignedUrl(path, ttl)` anfordert. Im Supabase Dashboard unter **Storage**:

1. Bucket **documentspictures** anlegen, auf **Private** stellen (NICHT Public).
2. **Storage Policy für Upload** (`INSERT`): Nur `authenticated` Nutzer dürfen in ihren eigenen Pfad schreiben – Policy per SQL (siehe `migration_storage_private_documentspictures.sql`).
3. **Storage Policy für Download** (`SELECT`): Scoped auf Agency, Model und berechtigte Clients via RLS-Policy (`documentspictures_select_scoped` in `migration_security_verifications_storage_2026_04.sql`).
4. Kein direkter Public-URL-Zugriff: `getPublicUrl` darf im Anwendungscode **nicht** für diesen Bucket verwendet werden – immer `createSignedUrl`.

## Enums

| Enum | Werte |
|------|--------|
| `user_role` | model, agent, client |
| `application_status` | pending, accepted, rejected |
| `gender` | female, male, diverse |
| `connection_status` | pending, accepted |
| `connection_requested_by` | client, agency |
| `option_request_status` | in_negotiation, confirmed, rejected |
| `chat_sender_type` | client, agency, model |

## Tabellen-Übersicht

- **profiles** – Nutzerprofile (an `auth.users` angebunden)
- **agencies** – Agenturen
- **models** – Models (mit Maßen, Sichtbarkeit, `agency_id`)
- **model_applications** – Bewerbungen (Apply: Name, Größe, Gender, Haarfarbe, Stadt, Instagram, Bilder, Status)
- **recruiting_chat_threads** / **recruiting_chat_messages** – Chat Agentur ↔ Model nach Akzeptanz
- **client_agency_connections** – Freundschaftsanfragen Client ↔ Agentur
- **client_projects** / **client_project_models** – Kunden-Projekte und zugeordnete Models
- **option_requests** / **option_request_messages** – Optionsanfragen (Datum) und Chat Client ↔ Agentur

Alle Tabellen haben **Row Level Security (RLS)** aktiviert.
