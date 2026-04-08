# Client Assignment Foundation Report

## 1. Executive Summary

Die erste Foundation fuer `Client Assignment / Flag` wurde additiv umgesetzt: neue DB-Tabelle, neuer Service, UI-Anzeige und MVP-Filter in den wichtigsten Request-/Thread-/Calendar-Surfaces.
Das Sichtbarkeitsmodell bleibt unveraendert.

## 2. Beste Entitaet fuer Client Assignment

Als stabile Entitaet wurde `client organization` (organizations.id, type='client') verwendet.
Das passt zum bestehenden Org-zentrierten Modell und vermeidet fragile user-/email-basierte Zuordnung.

## 3. Implementiertes Datenmodell

- Migration: `supabase/migrations/20260408_client_assignment_flags_foundation.sql`
- Tabelle: `public.client_assignment_flags`
- Eindeutige Zuordnung pro Agency-Org + Client-Org
- Label/Color/Assignee/Timestamps
- Agency-internes RLS + Admin-Read/Write
- Trigger fuer `updated_at`

## 4. Umgesetzte UI-/Filter-Bausteine

- Neuer Service: `src/services/clientAssignmentsSupabase.ts`
- Unit-Test: `src/services/__tests__/clientAssignmentsSupabase.test.ts`
- Request-Mapping erweitert:
  - `clientOrganizationId`, `agencyOrganizationId` in `src/store/optionRequests.ts`
- Surfaces:
  - Active Options
  - Option Thread-Liste + Thread-Panel
  - Calendar/Booking-Kontext
- Filter in Message-Threads:
  - My clients
  - Unassigned
  - By flag
  - By assigned member

## 5. Warum Org-weite Sichtbarkeit unveraendert blieb

Die Assignment-Tabelle wird nicht zur Autorisierung genutzt.
Alle bestehenden Datenzugriffswege fuer Option/Chat/Calendar bleiben unveraendert.
Es wurde nur Metadaten-Anreicherung fuer UI und Filter hinzugefuegt.

## 6. Warum Auth/Admin/Login unberuehrt blieb

Es wurden keine Aenderungen vorgenommen an:

- AuthContext / signIn / bootstrapThenLoadProfile / loadProfile
- App.tsx Routing-Guards
- `get_own_admin_flags`, `is_current_user_admin`, `assert_is_admin`
- `get_my_org_context`
- Paywall-Core

## 7. Naechste sinnvolle Schritte

Der naechste logische Schritt ist **Smart Attention** auf Basis der neuen Assignment-Metadaten (z. B. per assignee-spezifische Prioritaets-Queues), bevor tiefere Contextual Chat Layers folgen.
