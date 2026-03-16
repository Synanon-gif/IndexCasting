# Datenpersistenz – alles in Supabase

**Alle Bilder, Daten, Chats und Buchungsvorgänge werden in Supabase gespeichert** – pro Partei (Kunde, Agentur, Model) oder parteiübergreifend (geteilt zwischen den Beteiligten).

## Pro Partei (nur für diese Partei sichtbar/verwaltbar)

| Bereich | Tabelle(n) / Storage | Zuordnung |
|--------|------------------------|-----------|
| **Kunde** | `client_projects`, `client_project_models` | owner_id = client (Kunde) |
| | `user_calendar_events` | owner_type='client', owner_id |
| | `documents` (Verträge, Rechnungen, Ausweise) | owner_id = user |
| | `bookers` | client_id (Kunden-Booker) |
| **Agentur** | `models`, `model_photos` | agency_id / model_id |
| | `user_calendar_events` | owner_type='agency', owner_id |
| | `bookers` | agency_id (Agentur-Booker) |
| | `guest_links` | agency_id |
| | `model_agency_territories` | agency_id |
| **Model** | `model_photos` (Portfolio, Polaroids) | model_id |
| | `verifications` | user_id (Model) |
| | `model_applications` (eigene Bewerbungen) | applicant_user_id |
| **Alle** | `profiles` | id = auth.uid() |
| | `conversations`, `messages` | participant_ids enthält userId |

## Parteienübergreifend (geteilte Daten)

| Bereich | Tabelle(n) | Beteiligte |
|--------|------------|------------|
| **Optionen / Buchungsanfragen** | `option_requests`, `option_request_messages`, `option_documents` | client_id, agency_id, model_id – jede Partei sieht ihre Anfragen |
| **Kalender (Option/Job/Casting)** | `calendar_entries` (verknüpft mit option_requests) | Client + Agentur + Model je nach Zuordnung |
| **Buchungen** | `bookings` | agency_id, model_id, client_id – pro Partei abrufbar |
| **Recruiting-Chat** | `recruiting_chat_threads`, `recruiting_chat_messages` | Agentur + Model (pro Bewerbung) |
| **Verbindungen** | `client_agency_connections` | client_id, agency_id |

## Bilder & Dateien (Storage + Metadaten in DB)

| Typ | Storage-Bucket | DB / Zuordnung |
|-----|----------------|-----------------|
| Model-Portfolio / Polaroids | URLs in `model_photos` (model_id) bzw. `models.portfolio_images`, `models.polaroids` | pro Model / Agentur |
| Bewerbungsfotos (Apply) | `documents` (model-applications/…) | model_applications.images (application_id) |
| Chat-Anhänge (Option) | `chat-files` | option_documents (option_request_id, uploaded_by) |
| Messenger-Dateien | `chat-files` | messages (conversation_id) |
| Nutzerdokumente | `documents` (documents/userId/…) | documents.owner_id |
| Verifizierung (Model) | `documents` | verifications.user_id |

Alle Lade- und Schreibfunktionen in den `*Supabase.ts`-Services nutzen diese Tabellen und Scopes; es gibt keine rein lokalen Daten für Produktivnutzung.
