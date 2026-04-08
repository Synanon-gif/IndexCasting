# Discovery Audit C — Verify Checklist

Manuelle oder automatisierte Prüfungen zur Regression-Vermeidung nach Audit C.

## Automated (ausgeführt)

- [x] `npm run typecheck` — grün
- [x] `npm run lint` — grün
- [x] `npm test -- --passWithNoTests --ci` — grün
- [x] Live-DB: `get_discovery_models` und `get_models_near_location` existieren (Management API)
- [x] Live-DB: `get_models_near_location` Definition enthält `deduped`-CTE nach Deploy

## Normal discover behavior

- [ ] Eingeloggter Client mit `organization_id` + gewähltem Land: Karten laden, Load-More nahe Listenende funktioniert.
- [ ] Filter (Höhe, Chest-Range, Kategorie, Sports) ändern Liste; keine Console-Fehler aus `getDiscoveryModels`.
- [ ] Ohne Land (Legacy-Pfad): Liste lädt über `getModelsForClient` ohne Crash.

## Shared project discover

- [ ] Projekt im Discover-Modus öffnen: nur Projekt-Models, Filter-Leiste wie spezifiziert ausgeblendet/ohne Discovery-Filter auf fremde Models.
- [ ] Option Request / relevante Aktionen nur wo Produkt es vorsieht (nicht im externen Shared-Link).

## Package mode

- [ ] Package aus Chat öffnen: Grid/Swipe wie zuvor; Messwerte zeigen erwartete Chest-Höhe wenn nur `bust` in Gast-RPC (nicht mehr 0).
- [ ] Ausstieg aus Package-Modus zurück zum Workspace.

## External shared link (`?shared=1`)

- [ ] Nur Lesen; keine Login-pflichtigen Schreibaktionen auf der Selection-Seite.

## Chest / filter / location

- [ ] Chest-Min/Max im Client-Discover: Verhalten mit älteren Models (nur `bust` in DB) ggf. weiterhin restriktiv auf RPC-Ebene — bekannt, optional Follow-up-Migration.
- [ ] Agency: Gast-Paket-Modellliste mit Chest-Filter und Model nur mit `bust`: soll nach Fix in `filterModels` matchen.

## Near Me

- [ ] Mit GPS: Models innerhalb Radius, **keine doppelten Karten** für dasselbe Model bei mehreren Territories.
- [ ] Ohne GPS, mit erkanntem Stadtname: Stadt-Fallback auf geladener Liste.

## Photo / cover / discover

- [ ] Kacheln zeigen Cover wo RPC/legacy Bild-URL liefert; graue/leere Zustände unverändert erklärbar.

## No auth / admin / paywall regression

- [ ] Nicht angefasst — Stichprobe Login Agency/Client/Model; Admin-Dashboard unberührt.
