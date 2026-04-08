# Client Assignment / Flag System

## 1. Ziel

Diese Foundation fuehrt ein internes Assignment- und Flag-System fuer Agency-Organisationen ein.
Es dient nur der internen Arbeitsorganisation (Ownership, Priorisierung, Filterbarkeit), nicht der Zugriffskontrolle.

## 2. Datenmodell

Neue Tabelle: `public.client_assignment_flags`

- `agency_organization_id` (Agency-Org-Kontext)
- `client_organization_id` (Client-Org-Ziel)
- `label` (kurzes Flag-Label, z. B. PRIORITY)
- `color` (`gray|blue|green|amber|purple|red`)
- `assigned_member_user_id` (zustaendiges Team-Mitglied, optional)
- `is_archived` (optionale Deaktivierung)
- `created_by`, `created_at`, `updated_at`

Technische Leitplanken:

- Eindeutigkeit pro Pair: `(agency_organization_id, client_organization_id)`
- RLS nur agency-intern (plus Admin), keine cross-org Freigabe
- `updated_at` wird ueber Trigger gepflegt

## 3. Invarianten

- Org-weite Sichtbarkeit bleibt unveraendert.
- Assignment-Flags sind niemals Security-Layer.
- Kein Zugriff wird ueber diese Tabelle erlaubt oder verweigert.
- Keine Aenderungen an AuthContext, App-Routing, Admin-RPCs oder Paywall-Core.

## 4. Wo angezeigt

- `ClientWebApp`:
  - Active Options (`ActiveOptionsView`): Flag + zustaendige Person je Request.
  - Message Thread-Liste (`MessagesView`): Flag + zustaendige Person je Thread.
  - Thread-Panel: aktueller Flag-Status inkl. optionalem Edit fuer Agency-Modus.
  - Calendar-Liste (`ClientCalendarView`): Flag + zustaendige Person im Booking/Option-Kontext.
- `OrgMessengerInline`:
  - `ThreadContext` unterstuetzt nun optional Flag-/Assignment-Metadaten.

## 5. Wo gefiltert

In `MessagesView` (MVP):

- My clients
- Unassigned
- By flag
- By assigned member

## 6. Was es bewusst NICHT macht

- Kein Model-Assignment
- Keine interne Datenabschottung innerhalb einer Agency
- Kein Chat-Refactor
- Kein Kanban / Booking Brief
- Keine Aenderung an Login/Admin/Auth/Paywall-Kernpfaden

## 7. Refinement (Canonical UX + Robustheit)

- **Kanonischer Primary-Editor:** `AgencyClientsTab` in `AgencyControllerView` (Client-Kontext-Header pro Client-Org).
- **Pre-chat-faehig:** Assignment kann gesetzt werden, ohne vorherigen B2B-Chat.
- **Owner-only/no-booker:** funktioniert explizit ueber `Assign to me` und fallback `Owner/default`.
- **Sekundaere Surfaces (spiegelnd):**
  - Agency Option-Request-Threads (Badges + konsistente Filter)
  - Agency Calendar/Booking-Kontext (Badge-Anzeige)
- **Konsistente Filterbegriffe:** `My clients`, `Unassigned`, `By flag` (`Any flag` + konkrete Flags).

## 8. Harte Produktinvarianten (bestaetigt)

- Assignment ist weiterhin Workflow-Metadaten, nie Security-Layer.
- Assignment ist an `client_organization_id` gekoppelt, nicht an Chat-Existenz.
- Agency-intern bleibt Sichtbarkeit unveraendert fuer alle Mitglieder.
- Owner-only-Team ist voll unterstuetzt (kein Booker notwendig).

## 9. Smart Attention Kopplung (additiv, kein Security-Layer)

- Smart Attention liest Assignment-Metadaten nur fuer Priorisierung/Filterung (`all|mine|unassigned`, Flag, Member).
- Assignment und Attention veraendern nie RLS, Berechtigungen oder Daten-Sichtbarkeit.
- `assigned_member_user_id` bleibt Workflow-Ownership, nicht Autorisierungsmerkmal.
- Owner-only/no-booker bleibt voll funktionsfaehig: `Assign to me` + Attention-Filter funktionieren ohne Booker-Team.
