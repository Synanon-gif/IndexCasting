# Client Assignment Verification

## Funktionale Checks

1. Agency kann Client markieren
- In Thread-Panel auf `Edit` klicken
- Flag-Farbe setzen
- Erwartung: Flag ist in Thread-Liste und Active-Options sichtbar

2. Agency kann Booker/Member zuweisen
- Im Edit-Modus ein Team-Mitglied waehlen
- Erwartung: Name erscheint neben Flag in Liste/Panel/Kalender

3. Flag + Name sichtbar in relevanten Surfaces
- Active Options
- Messages Thread-Liste
- Messages Thread-Panel
- Calendar Items (client option rows)

4. Filter funktionieren
- My clients
- Unassigned
- By flag
- By assigned member

## Sicherheits- und Regressionschecks

5. Alle Agency-Mitglieder sehen Daten weiterhin unveraendert
- Option/Chat/Calendar Sichtbarkeit identisch zu vorher
- Assignment beeinflusst nur Darstellung/Filter

6. Keine RLS-/Sichtbarkeitsaenderung in Kernfluesse
- Keine Policy-Aenderungen an option/chat/calendar Kern-Tabellen
- Neue Tabelle ist additive Metadata

7. Keine Auth/Admin/Login/Paywall Regression
- Login fuer Admin/Agency/Client unveraendert
- Keine Aenderung an AuthContext/App.tsx/Admin-RPCs/Paywall-Core

## Live DB Check (bereits durchgefuehrt)

- `client_assignment_flags` Tabelle vorhanden (information_schema check).
