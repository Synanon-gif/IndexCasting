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

**Model-Fotos (Portfolio, manueller Upload, Cover):** Dafür müssen **Phase 13** und **Phase 14** ausgeführt sein:
- `migration_phase13_enhancements.sql` – legt die Tabelle `model_photos` und RLS an.
- `migration_phase14_options_jobs_castings.sql` – fügt die Spalte `photo_type` (portfolio/polaroid) in `model_photos` hinzu.

Die Tabelle `models` hat bereits die Spalte `portfolio_images` (TEXT[]); sie wird vom Code mit der geordneten URL-Liste synchron gehalten (erstes Bild = Cover für Client-Swipe).

**Storage (Bilder sichtbar für alle):** Model-Fotos und Bewerbungs-Bilder liegen im **öffentlichen** Bucket **`documentspictures`** (Pfade `model-photos/{modelId}/...` und `model-applications/...`). Der Bucket **`documents`** bleibt **privat** für andere Dateien. Im Supabase Dashboard unter **Storage**:
1. Bucket **documentspictures** anlegen, auf **Public** stellen.
2. Policy für **Upload**: Authentifizierte Nutzer müssen in diesen Bucket schreiben dürfen (Insert für bucket_id = 'documentspictures' für Rolle `authenticated`).

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
