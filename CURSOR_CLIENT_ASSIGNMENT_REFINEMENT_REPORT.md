# Client Assignment Refinement Report

## 1. Executive Summary

Die bestehende Foundation wurde auf Produktkonsistenz gehaertet: ein kanonischer Assignment-Editor wurde auf Agency-Client-Kontext gelegt, Owner-only/no-booker sauber abgesichert und die Surface-/Filter-Konsistenz in Agency-Request- und Calendar-Kontexten verbessert.

## 2. Was an der Foundation geschaerft wurde

- Assignment-Setzen nicht mehr nur thread-nah, sondern kanonisch im Agency-Clients-Kontext.
- Pre-chat Assignment ist jetzt direkt moeglich.
- Einheitlichere Darstellung von Assignment-Metadaten in Agency-Surfaces.

## 3. Canonical place to set assignments

- **Primary:** `AgencyClientsTab` (`AgencyControllerView`) pro Client-Org-Zeile.
- Dort: `Assign to me`, `Edit assignment`, Flag-Farbe, Assignee, `Unassigned`.
- **Secondary:** Option-Request-Threads und Kalender zeigen Assignment nur gespiegelt/leicht filterbar.

## 4. Owner-only/no-booker behavior

- Owner kann immer ueber `Assign to me` zuweisen.
- Falls keine Booker vorhanden sind, funktioniert Assignment weiterhin ueber Owner/Fallback.
- `Unassigned` bleibt als expliziter Zustand bestehen.

## 5. Pre-chat client assignment behavior

- Assignment kann ohne bestehenden B2B-Chat gesetzt werden.
- Grundlage ist `client_organization_id` aus Agency-Client-Directory, nicht Conversation-Existenz.

## 6. Filter/surface consistency

- Agency Option-Request-Threads:
  - `My clients`
  - `Unassigned`
  - `Any flag`/`By flag`
- Badges/Label-Anzeige konsistent in:
  - Agency Clients
  - Agency Option-Request-Liste
  - Agency Option-Request-Detailpanel
  - Agency Calendar-Liste

## 7. Rules decision

- **Keine Rule-Datei geaendert.**
- Grund: Die Refinement-Invarianten sind bereits mit bestehender Rule-Landschaft kompatibel und wurden in Produktdoku/Verify klar dokumentiert.

## 8. Warum Org-weite Sichtbarkeit unveraendert blieb

- Keine Sichtbarkeitslogik an Assignment gebunden.
- Keine Aenderung an RLS der Kern-Request-/Chat-/Calendar-Tabellen.
- Assignment bleibt reine Metadaten-Tabelle.

## 9. Warum Auth/Admin/Login unberuehrt blieb

- Keine Aenderungen an:
  - AuthContext / Login Flow
  - Admin-RPC-Kette (`get_own_admin_flags`, `is_current_user_admin`, `assert_is_admin`)
  - `get_my_org_context`
  - Paywall-Core

## 10. Naechster Schritt

Nach diesem Refinement ist **Smart Attention** der logischere naechste Schritt.
Weiterer Feinschliff ist optional, aber kein Blocker fuer Smart Attention.
