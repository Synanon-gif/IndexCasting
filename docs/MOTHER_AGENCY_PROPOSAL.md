# Mother Agency — separater Folge-Task (Vorschlag)

> Status: **proposal**, not yet implemented. Owner: Product. Scope: 1 small
> follow-up PR after the Phase 1 hardening lands.

## Hintergrund

Models international platzierter Agenturen werden häufig zusätzlich von einer
"Mother Agency" betreut, die das Karriere-Management übernimmt. Heute hält
unser `public.models`-Schema dafür **kein** explizites Feld — die Information
geht beim Package-Import (Mediaslide / Netwalk) vollständig verloren.

## Warum nicht jetzt mit der Phase-1-Härtung kombinieren?

1. **Datenmodell-Entscheidung**, nicht Bug-Fix. Free-Text vs. eigene Tabelle
   ist eine Produkt-Diskussion, kein Hardening-Schritt.
2. **Sichtbarkeit / RLS-Folgen** sind nicht trivial: Sehen Booker mother
   agency? Sieht ein Gast-Link mother agency? Public Profile?
3. **Migrationsrisiko**: Eine zusätzliche Spalte ist klein, aber jede Schema-
   Änderung am `models`-Tisch braucht Review — die Phase-1-Härtung ist
   ausdrücklich rein **Code-Side**, ohne DB-Migration.
4. **Tests**: Mother-Agency-Verhalten verlangt eigene RLS- und Visibility-Tests,
   die wir sauber als eigenständigen Diff anschneiden wollen.

## Empfehlung

**Eigener PR** nach dem Hardening, in dieser Reihenfolge:

1. **Produkt-Entscheidung dokumentieren** (1 ADR-style note in
   `docs/MOTHER_AGENCY_DECISIONS.md`):
   - Free-Text-Felder oder eigene Lookup-Tabelle?
   - Sichtbarkeit pro Rolle (Agency-Booker, Booker-Cross-Agency, Gast, Public)?
   - Pflicht oder optional?
2. **Minimalste DB-Migration** (nach Entscheidung):
   - Variante A (free text): zwei nullable Spalten
     `mother_agency_name text`, `mother_agency_contact text`.
   - Variante B (strukturiert): neue Tabelle `mother_agencies (id, name, contact, country_code)`
     plus `models.mother_agency_id uuid references`.
3. **Mapping** für Mediaslide-Parser — wenn das Feld im Package gefunden wird
   (heutige Hypothese: ist meist nicht vorhanden), wird es als optionales Feld
   in den `ProviderImportPayload` aufgenommen.
4. **UI-Anzeige** in Model-Profil + Preview-Row.
5. **RLS / Tests** für die gewählten Sichtbarkeitsregeln.

## Default-Erwartung

Solange dieser Folge-Task offen ist, **bleibt das aktuelle Verhalten unverändert**:
mother agency wird nicht erfasst, nicht angezeigt und nicht synchronisiert. Kein
Datenverlust, weil wir auch heute kein Feld dafür haben.
