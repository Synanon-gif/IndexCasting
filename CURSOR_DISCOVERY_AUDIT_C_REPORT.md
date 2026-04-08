# Discovery / Algorithm Audit C — Report

## 1. Executive Summary

Audit C hat alle geforderten Discovery-, Filter-, Ranking-, Near-Me- und Modus-Pfade gegen die Systemwahrheiten geprüft. **Kritischer Befund:** `get_models_near_location` konnte dasselbe Model mehrfach zurückgeben (JOIN auf `model_agency_territories` ohne Zeilenbegrenzung pro Model). Das wurde durch eine **neue Migration** behoben und **live deployed** (HTTP 201, Verifikation `deduped`-CTE).

Ergänzend wurden **sichere Display-/Filter-Paritäts-Fixes** umgesetzt: `chest ?? bust` dort, wo die UI „Chest“-Semantik erwartet, RPCs aber nur `chest` filtern und Gast-Pakete nur `bust` liefern.

Keine Änderungen an Auth, Paywall, Invite/Claim, Admin, `calendar_entries`-RLS oder Booking-Brief.

## 2. Source-of-truth map

| Surface | Primäre Quelle | Fallback / Sekundär | Kanonische Felder |
|--------|----------------|---------------------|-------------------|
| Client Discover (Web, ranked) | RPC `get_discovery_models` via `getDiscoveryModels` | — | Territory: `model_agency_territories` + `p_iso`; Score + Org-Interactions; Filter auf `models.*` |
| Client Discover (Web, legacy) | `getModelsForClient` → Hybrid `get_models_by_location` oder flache `models` | Wenn kein `countryCode` | `models` / View; Sortierung i. d. R. Name |
| Near Me (Radius) | RPC `get_models_near_location` | — | **Geo:** `model_locations` mit DISTINCT ON Priorität live > current > agency; `share_approximate_location` |
| Near Me (nur Stadt, kein GPS) | Client: Filter auf `baseModels` | Substring auf `ModelSummary.city` | Nicht `model_locations` |
| Mobile Swipe | Wie Web: `getDiscoveryModels` wenn Org + Land; sonst `getModelsPagedFromSupabase` | — | Parität zu Discovery-Service |
| Package (Client in App) | `get_guest_link_models` | — | Bilder je `type`; Maße aus RPC (`bust` etc.) |
| Guest Link (Browser) | `GuestView` + dieselbe RPC | Legal Gate | Signed URLs |
| Externer Shared Link | `getModelData` in `SharedSelectionView` | — | Read-only, kein Discover-RPC |
| Option Request Routing | `resolveAgencyForModelAndCountry` | Nicht Discover-Liste | Territories of representation |

**Fallbacks / Drift-Risiken**

- `get_discovery_models`: referenzierte Definition primär in Root-SQL (`supabase/migration_client_model_interactions_v2.sql`); **nicht** als eigene Datei unter `supabase/migrations/`. Live-DB: Funktion vorhanden, Signatur v2 bestätigt.
- Legacy vs. ranked: unterschiedliche **Sortierlogik** und kein Diversity-Shuffle auf Legacy-Pfad.

## 3. Surface-by-surface findings

### ClientWebApp — normal Discover

- **Nutzererwartung:** gefilterte, „intelligente“ Reihenfolge im gewählten Land.
- **Tatsächlich:** Bei `clientOrgId` + `countryCode` ranked RPC + session exclude + optional `applyDiversityShuffle`; sonst Legacy-Pfad ohne Ranking.
- **Drift:** Same-City-Boost nutzt `models.city`, nicht `model_locations` — akzeptierte Produktvereinfachung (siehe §4).

### ClientWebApp — Near Me

- **Mit GPS:** reine `nearbyModels`-Liste aus RPC, Distanz sortiert.
- **Ohne GPS aber mit `userCity`:** Filter auf bereits geladene `baseModels` per Stadtstring — kann von Backend-Stadtsemantik abweichen.

### Package / Shared Project

- `filteredModels` bricht bei `isPackageMode || isSharedMode` ab und liefert `baseModels` — **keine Vermischung** mit Discovery-Filtern (Invariante erfüllt).
- Package-Modelle: `get_guest_link_models` liefert kein `chest`-Spalte; Mapping nutzte `chest: 0` → **behoben** (`chest` aus `bust`).

### GuestView

- Eigener Flow, RPC + Signed URLs; keine Discover-Filter; konsistent mit Package-Datenquelle.

### SharedSelectionView

- Read-only; `getModelData`; keine Option-Requests — beabsichtigt anders als eingeloggtes Shared-Project.

### CustomerSwipeScreen

- Gleiche ranked/legacy-Aufteilung wie Web; `mapDiscoveryModel` nutzte bereits `chest ?? bust` — mit Web-Mapping jetzt konsistenter.

## 4. Ranking / filter / location

| Thema | Klassifikation |
|-------|----------------|
| Near-Me-Duplikate durch Territory-JOIN | **CONFIRMED_ALGO_HIGH** → behoben (Migration 20260408) |
| Chest-Filter nur auf DB-Spalte `chest` | **CONFIRMED_ALGO_MEDIUM** — UI-Mapping + Agency `filterModels` mit `bust`-Fallback; RPC-COALESCE optional |
| `hasRealLocation` aus `country_code` im Summary | **LOW** — reines UI-Flag |
| Diversity-Shuffle vs. Score-Sortierung | **ACCEPTED_PRODUCT_COMPLEXITY** |
| Smart Attention / Assignment | **NO_ISSUE** im Discover-Pfad (nur Messages/Requests) |

## 5. Shared / package / discover modes

- **Strict isolation** für Package und Shared-Project in `filteredModels`: erfüllt.
- **Externer Shared-Link** ≠ Shared-Project-Modus: keine Aktions-Buttons auf Selection-Ebene; Datenquelle getrennt — **NO_ISSUE**.
- Load-More Discovery: explizit deaktiviert bei `filters.nearby`, Package, Shared — **konsistent**.

## 6. Photo / visibility / discover

- Discover-Kacheln: `portfolio_images[0]` aus RPC / Legacy-Mapping (`gallery[0]`).
- Client-sichtbare Fotos vs. Storage: nicht Teil dieses Audits verändert (bereits Audit A/B adressiert); keine neuen Abweichungen gefunden.
- Gast-Pakete: polaroid vs. portfolio Bildwahl im Client-Mapping — unverändert korrekt.

## 7. Small safe fixes applied now

1. **DB:** `20260408_get_models_near_location_dedupe_territory_join.sql` — eine Zeile pro Model nach Territory-JOIN; live deployed.
2. **TS/JS:** `chest ?? bust` in `mapDiscoveryModelToSummary`, Legacy-Map in `ClientWebApp`, Package-Map, `apiService.js` `getModelsForClient`.
3. **Agency:** `filterModels` Chest-Range über `m.chest ?? m.bust`.
4. **Tests:** `apiService.test.ts`, `modelFilters.test.ts`.

## 8. Rules decision

- **Keine** Änderung an `.cursorrules`, `system-invariants.mdc` oder `auto-review.mdc` (keine neue globale Regel nötig; Befund ist migrations- und mappingspezifisch).
- Optional später: ein Satz in `docs/LIVE_DB_DRIFT_GUARDRAIL.md` zu `get_discovery_models` — **nicht** in diesem Lauf geändert (User wollte keine Markdown-Docs ohne Bedarf).

## 9. Top discovery / algo priorities next

1. **Optional:** `COALESCE(m.chest, m.bust)` in `get_discovery_models` und `get_models_near_location` für volle Filterparität mit Legacy-Daten.
2. **Repo-Hygiene:** Definitive `get_discovery_models`-Definition in `supabase/migrations/` ablegen (Drift-Guardrail).
3. **Produkt:** Welches `territory_agency_id` Near Me anzeigen soll, wenn ein Model mehrere Territories hat (aktuell deterministisch: Country-Code, dann Agency-ID).

---

`DISCOVERY AUDIT C + SAFE FIXES APPLIED`

**Nächster sinnvoller Schritt:** Wenn Legacy-Bestand mit viel `bust`-only existiert, kleine Follow-up-Migration für RPC-Chest-COALESCE planen und mit Stichproben in Staging testen.
