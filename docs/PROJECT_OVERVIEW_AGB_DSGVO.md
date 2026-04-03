# IndexCasting – Projektübersicht für AGB & Datenschutz (DSGVO)

**Weitere Formate:** Gleicher Inhalt als druckbare **HTML**-Datei: [`PROJECT_OVERVIEW_AGB_DSGVO.html`](./PROJECT_OVERVIEW_AGB_DSGVO.html) (im Browser öffnen → *Drucken* → *Als PDF speichern*, oder in Word öffnen falls unterstützt).

**Stand:** April 2026  
**Zweck dieser Datei:** Sachliche Beschreibung des Produkts, der Rollen, der Datenverarbeitung und der technischen Infrastruktur – als **Arbeitsgrundlage** für Anwälte und Datenschutzbeauftragte bei der Ausarbeitung von AGB, Datenschutzerklärung und ggf. Auftragsverarbeitungsverträgen.

**Kein Rechtsrat:** Dieses Dokument ersetzt keine Rechtsberatung. Inhalte basieren auf dem Code- und Architekturstand des Repositories und können sich ändern.

---

## 1. Produkt in einem Satz

**IndexCasting** ist eine digitale Plattform (Web/App) für **Fashion-Castings**: Agenturen verwalten Model-Roster und Recruiting, **Clients** entdecken Models und verhandeln Optionen, **Models** nutzen Profil, Verfügbarkeit und Kommunikation – mit Fokus auf **schnelle Messaging**, **Swipe-/Auswahl-UX** und **Mediaslide-konforme Modeldaten** (Maße, Kategorien).

---

## 2. Zielgruppen und Rollen

### 2.1 Nutzertypen (fachlich)

| Rolle | Kurzbeschreibung |
|--------|------------------|
| **Model** | Eigene Profildaten, Portfolio/Polaroids, Bewerbungen, Kalenderbezug, Chat mit Agentur (z. B. Recruiting). |
| **Agency (Agentur)** | Verwaltung von Models, Casting-/Recruiting-Flows, Kommunikation mit Models und Clients, ggf. Einladungen (Booker). |
| **Client (Kunde/Marke)** | Entdecken von Models (Discover), Projekte, Optionsanfragen, Kalender, Kommunikation mit Agenturen. |
| **Guest** | Eingeschränkter Zugriff (z. B. Gast-Links / Gast-Chat), je nach Implementierung – gesondert in der Datenschutzerklärung abgrenzen. |
| **Admin / Super-Admin** | Plattformverwaltung (sofern aktiv), getrennt von normalen B2B-Nutzern. |

### 2.2 Organisationen (Multi-Tenant)

- **Agency-Organisation:** Rollen typischerweise **Owner** (Abrechnung, Teamverwaltung, Löschrechte) und **Booker** (tagesgeschäftlich mit Owner weitgehend gleichberechtigt, außer Owner-exklusiven Funktionen).
- **Client-Organisation:** Rollen **Owner** und **Employee** (analog: Parität im Tagesgeschäft, Owner für Abrechnung/Team/Löschung).

Daten sind **pro Organisation** und **pro Berechtigung** abgegrenzt (Row Level Security in der Datenbank).

---

## 3. Technische Infrastruktur (relevant für DSGVO / AV-Verträge)

| Komponente | Verwendung |
|------------|------------|
| **Supabase** (PostgreSQL, Auth, Realtime, Storage, Edge Functions) | Zentrale Datenhaltung, Authentifizierung, Dateispeicher, serverseitige Webhooks. |
| **Supabase Auth** | Registrierung, Login, Sessions; Nutzer-IDs verknüpfen Profile und Berechtigungen. |
| **Supabase Storage** | Private Buckets für Bilder/Dokumente (z. B. Model-Fotos, Bewerbungsbilder, Chat-Dateien); Auslieferung über **signierte URLs** (zeitlich begrenzt), keine öffentlichen Dauer-URLs für sensible Medien vorgesehen. |
| **Stripe** | Abonnements/Bezahlung (über Edge Function `stripe-webhook`); Abrechnungsdaten und Metadaten können Stripe verarbeiten – **Stripe** als Auftragsverarbeiter bzw. eigenständiger Verantwortlicher je nach Vertragsmodell klären. |
| **Client-Anwendung** | React Native / Expo (u. a. Web-Build), UI überwiegend englischsprachig (`uiCopy`). |

**Hosting-Region:** Im Vertrag mit Supabase/Cloud-Anbieter konkret festhalten (EU/EEA für Standard-DSGVO-Setup empfehlenswert – **vertraglich verifizieren**).

---

## 4. Kategorien personenbezogener Daten (überblick)

Die folgende Liste ist **typisch** für die Plattform; Umfang hängt von Nutzung und Konfiguration ab.

### 4.1 Stammdaten & Konto

- E-Mail, Anzeigename, Profilfelder in `profiles` (inkl. Flags wie AGB-/Datenschutz-Zustimmung, ggf. „Signup abgeschlossen“, Gast-Flag).
- Organisationsbezug: `organization_id`, Org-Typ, Mitgliedsrolle.
- Kontaktdaten von **Clients** (z. B. Firma, Telefon, Website, Social) in Einstellungen, soweit im Produkt erfasst.

### 4.2 Model-spezifisch

- Name, Maße (Height, Bust, Waist, Hips etc.), Haar-/Augenfarbe, Stadt/Land, ggf. biologisches Geschlecht je nach Schema.
- **Sichtbarkeit:** z. B. `is_visible_fashion` / `is_visible_commercial` – steuert, ob Models in der **Client-Discover**-Ansicht erscheinen.
- Verknüpfung zur Agentur (`agency_id`), Status der Beziehung (z. B. aktiv, ausstehende App-Verknüpfung, beendet).
- Portfolio- und Polaroid-Bilder (Metadaten + URLs; Dateien in Storage).

### 4.3 Bewerbungen (Recruiting)

- Bewerbungsdaten in `model_applications` (inkl. Bilder, Status pending/accepted/rejected).
- Chats: `recruiting_chat_threads` / `recruiting_chat_messages` zwischen Agentur und Model.

### 4.4 Client–Agentur–Geschäftsprozesse

- **Verbindungen** Client ↔ Agentur (`client_agency_connections`).
- **Projekte** und Zuordnung von Models (`client_projects`, `client_project_models`).
- **Optionsanfragen** und Nachrichten (`option_requests`, `option_request_messages`), ggf. Dokumente (`option_documents`).
- **Kalenderereignisse** (`user_calendar_events` und verwandte Strukturen) für Verfügbarkeit und Jobs.

### 4.5 Kommunikation allgemein

- Konversationen und Nachrichten (`conversations`, `messages` bzw. domänenspezifische Chat-Tabellen).
- Chat-Anhänge in Storage (z. B. Bucket `chat-files`).

### 4.6 Dokumente & Verifizierung

- Nutzer- oder modelbezogene Dokumente (z. B. Ausweise, Verträge) in `documents` / Storage-Bucket `documents` – **besonders sensible Kategorie** für Datenschutz und Zugriffsbeschränkung.
- Verifizierungsdaten (`verifications`), soweit genutzt.

### 4.7 Technische Metadaten

- Logs (auch Admin-Logs, falls geführt), Zeitstempel, IDs für Support und Sicherheit.

---

## 5. Hauptfunktionen (für Vertragsbeschreibung / Leistungsbeschreibung)

1. **Discover / Model-Katalog (Client):** Filterung nach u. a. Fashion/Commercial, Region/Kategorie; Anzeige nur bei gesetzter Sichtbarkeit und passender Client-Ansicht.
2. **Projekte & Shortlists:** Models zu Kundenprojekten hinzufügen.
3. **Option Requests:** Termin-/Optionsverhandlung zwischen Client und Agentur.
4. **Messaging:** Echtzeitnahe Kommunikation (Supabase Realtime).
5. **Recruiting:** Bewerbungen bearbeiten, Chats, Statuswechsel.
6. **Agentur:** Model manuell anlegen, Fotos hochladen, Territorien, Kalender, Team/Einladungen (je nach Rolle).
7. **Gast-Zugänge:** Gast-Chat / Gast-Flows (eigenes Kapitel in Datenschutz & AGB).
8. **Abonnement / Paywall:** Über Stripe angebunden – Preise, Laufzeiten, Kündigung in AGB und auf der Website.

---

## 6. Rechtsgrundlagen & Betroffenenrechte (Orientierung, keine Rechtsberatung)

Für die Texte in **Datenschutzerklärung** und **Einwilligungen** typischerweise zu klären:

- **Vertragserfüllung** (Art. 6 Abs. 1 lit. b DSGVO) für Kernfunktionen zwischen Nutzern und Plattform.
- **Berechtigtes Interesse** (Art. 6 Abs. 1 lit. f) z. B. für Sicherheit, Missbrauchsbekämpfung, **nur** mit Interessenabwägung und Transparenz.
- **Einwilligung** (Art. 6 Abs. 1 lit. a) für Marketing, nicht notwendige Cookies/Tracking, optionale Features.
- **Besondere Kategorien** (Art. 9): soweit Gesundheit, ethnische Herkunft o. Ä. **nicht** verarbeitet werden sollen, dies festhalten; Bilder von Personen können in der Praxis sensibel sein (Schutzrechte der abgebildeten Personen).

**Betroffenenrechte:** Auskunft, Berichtigung, Löschung, Einschränkung, Datenübertragbarkeit, Widerspruch, Beschwerde bei Aufsichtsbehörde – im Produkt teilweise über Kontenverwaltung und Support; **Selbstauskunft/Löschung** ggf. über dokumentierte Prozesse (z. B. Kontolöschung mit Frist/Archiv, falls implementiert).

---

## 7. Auftragsverarbeitung (AVV)

Typische **Auftragsverarbeiter** im Sinne von Art. 28 DSGVO:

- **Supabase** (Hosting, DB, Auth, Storage)
- **Stripe** (Zahlungsabwicklung)
- ggf. **E-Mail-Provider**, **Analytics**, **Error-Tracking**, **Push-Notifications** – jeweils nur wenn im Projekt produktiv angebunden und in der Datenschutzerklärung genannt.

Mit jedem Auftragsverarbeiter einen **AVV** oder die Standardvertragsklauseln nachweisen.

---

## 8. Internationale Übermittlungen

Falls Supabase oder andere Dienste außerhalb EU/EEA hosten oder Unterauftragsverarbeiter in Drittstaaten nutzen: **Angemessenheitsbeschluss**, **Standardvertragsklauseln (SCC)** oder spezielle Regelungen (Schweiz/UK) – **aktuellen Stand** mit Supabase-Dokumentation und Vertrag abgleichen.

---

## 9. Sicherheit (kurz, technisch)

- **Row Level Security (RLS)** auf Tabellen: Zugriff nur im jeweiligen Organisations-/Nutzerkontext.
- **Kein `service_role`-Key im Frontend** (Regel im Projekt).
- **Private Storage-Buckets**; Medien über **Signed URLs** mit begrenzter Gültigkeit.
- **DSGVO-Minimierung:** nur erforderliche Daten speichern; Löschkonzepte für Konten und Inhalte (`deleteUserContent` o. Ä. wo implementiert) in der Datenschutzerklärung beschreiben.

---

## 10. Was du in AGB konkret beschreiben solltest

- **Vertragspartner** (Betreiberfirma, Register, Kontakt).
- **Leistungsgegenstand:** Nutzung der Software-as-a-Service-Plattform wie oben skizziert.
- **Registrierung, Verfügbarkeit, Änderungen** am Produkt.
- **Pflichten der Nutzer:** zulässige Inhalte, keine Rechtsverletzungen, Geheimhaltung von Zugangsdaten.
- **Inhalte von Nutzern:** Wer haftet für hochgeladene Bilder/Texte (Models, Agenturen, Clients).
- **Abrechnung:** Stripe, Laufzeit, Kündigung, Mahnungen – mit Stripe-AGB verlinken.
- **Haftungsbeschränkung** und **Schlussbestimmungen** (nur mit Anwalt abstimmen).
- **Geltendes Recht und Gerichtsstand** (Unternehmenssitz).

---

## 11. Was du in der Datenschutzerklärung konkret beschreiben solltest

- **Verantwortlicher** (Name, Adresse).
- **Datenschutzbeauftragter** (falls vorgeschrieben).
- **Zwecke und Rechtsgrundlagen** je Datenkategorie (siehe Abschnitt 4).
- **Empfänger/Kategorien von Empfängern** (Supabase, Stripe, …).
- **Speicherdauer** oder Kriterien zur Festlegung.
- **Pflicht zur Bereitstellung** oder freiwillige Angaben.
- **Automatisierte Entscheidungen** (falls keine: explizit „keine“).
- **Cookies/Local Storage** auf Web (falls genutzt).
- **Kontaktweg** für Betroffenenanfragen.

---

## 12. Änderungshistorie dieser Datei

| Datum | Änderung |
|-------|----------|
| 2026-04 | Erste Version aus Codebase/README_DATA/supabase/README zusammengestellt |

---

## 13. Pflegehinweis für das Entwicklungsteam

Wenn sich **neue Features** ergeben (z. B. neues Tracking, neuer Drittanbieter, neue Datenfelder), diese Datei **aktualisieren**, damit Rechtstexte und tatsächliche Verarbeitung **übereinstimmen**.
