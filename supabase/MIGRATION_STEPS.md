# Supabase-Migration – Schritt-für-Schritt

Alle App-Daten laufen am Ende über Supabase. Jeder Schritt wird nacheinander umgesetzt und getestet.

---

## Übersicht der Schritte

| # | Schritt | Was wird synchronisiert | Status |
|---|--------|---------------------------|--------|
| 1 | **Agencies** | Agenturen aus DB laden, Seed falls leer | ✅ |
| 2 | **Models** | Models + Sichtbarkeit (Fashion/Commercial) | ⬜ |
| 3 | **Auth + Profiles** | Login/Signup, Profil bei Registrierung | ⬜ |
| 4 | **Model Applications (Apply)** | Bewerbungen speichern & laden | ⬜ |
| 5 | **Recruiting-Chat** | Threads + Nachrichten (Agency ↔ Model) | ⬜ |
| 6 | **Client–Agency Connections** | Freundschaftsanfragen | ⬜ |
| 7 | **Client-Projekte** | Projekte + zugeordnete Models | ⬜ |
| 8 | **Option Requests + Chat** | Optionsanfragen + Nachrichten | ⬜ |

---

## Ablauf pro Schritt

- Code anpassen → mit Supabase-Tabellen sprechen
- Keine doppelte Logik: alte Stores/ localStorage werden nach und nach durch Supabase ersetzt
- Nach jedem Schritt: kurzer Test (z.B. „Agenturen anzeigen“, „Bewerbung absenden“)

Du kannst nach jedem Schritt „weiter“ sagen, dann gehen wir zum nächsten.

---

## Schritt 1 abgeschlossen (Agencies)

**In Supabase SQL Editor ausführen (falls noch nicht geschehen):**

1. **Spalte `code` anlegen** – Inhalt von `supabase/migration_agencies_code.sql` einfügen und ausführen.
2. **Demo-Agenturen einfügen** – Inhalt von `supabase/seed_agencies.sql` einfügen und ausführen.

Die App lädt Agenturen nun aus der Tabelle `public.agencies`. Reiter „Agencies“ und Agency-Dashboard „Connections“ nutzen diese Daten.
