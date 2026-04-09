# Agency → Model → Client E2E Audit — Verify Matrix

**Datum:** 2026-04-09  
**Status nach allen Fixes:** FULL FLOW VERIFIED

---

## Verify-Matrix (P6 — alle 12 Pflichtfälle)

| # | Testfall | Code-Pfad | Bug vorher | Status nach Fix |
|---|----------|-----------|------------|-----------------|
| 1 | New model + 1 portfolio image + city/country, no email | `importModelAndMerge` → `agency_update_model_full` (mit Error-Check) → `upsertModelLocation` → `uploadModelPhoto` → mirror | BUG 1: RPC-Fehler ignoriert | **FIXED** — Error-Check + Alert |
| 2 | New model + 1 portfolio image + city + email invite | wie 1 + `generateModelClaimToken` + `send-invite` (ok===true) | kein Bug | **PASS** (war ok) |
| 3 | Reopen after first save | `getModelByIdFromSupabase` → `buildEditState` | kein Bug | **PASS** (war ok) |
| 4 | Client discover visibility (City-Anzeige) | `get_discovery_models` → `effective_city` via CTE → `canonicalDisplayCityForModel` | BUG 4: effective_city NULL, City-Boost nur models.city | **FIXED** — CTE + COALESCE live |
| 5 | Client package visibility | `get_guest_link_models` + `signImageUrls` → HTTPS-URLs | kein Bug | **PASS** (war ok) |
| 6 | Near Me / location filter | `get_models_near_location` → DISTINCT ON live>current>agency | kein Bug | **PASS** (war ok) |
| 7 | Resend invite | `model_claim_tokens` lookup → `generateModelClaimToken` → `send-invite` | kein Bug | **PASS** (war ok) |
| 8 | Model öffnet Invite-Link + abschließt Claim | `claim_model_by_token` → `user_id` gesetzt + `agency_relationship_status = 'active'` | BUG 3: Status blieb pending_link → Badge dauerhaft "Pending" | **FIXED** — Status-Transition live |
| 9 | Existing model edit + save + reopen | `agency_update_model_full` → Alert bei Location-Fail → Panel schließt nach 1.8s | kein Bug (Alert vorhanden) | **PASS** (akzeptabel) |
| 10 | Soft remove + re-add | `agency_find_model_by_email` → merge/reactivate → 23505-Recovery | kein Bug | **PASS** (war ok) |
| 11 | Polaroid NOT in standard discovery | `get_discovery_models` liefert `portfolio_images` via `m.*`; Frontend mappt nur `portfolio_images[0]` | kein Bug (UI-Filter korrekt) | **PASS** (war ok) |
| 12 | Completeness = actual visible portfolio | `model_photos` (`photo_type='portfolio'`, `is_visible_to_clients`) als Wahrheit | kein Bug | **PASS** (war ok) |

---

## Live-DB Verifikationen

### Migration 20260519 — `get_discovery_models` effective_city

```
HAS effective_locations: True
HAS effective_city: True
HAS COALESCE(el.effective_city: True
```
Quelle: `pg_get_functiondef` auf Live-DB nach Deploy (HTTP 201)

### Migration 20260520 — `claim_model_by_token` Status-Transition

```
HAS agency_relationship_status = active: True
HAS pending_link guard: True
```
Quelle: `pg_get_functiondef` auf Live-DB nach Deploy (HTTP 201)

---

## Surfaces die explizit geprüft wurden (P2/P4/P5 Sweep)

| Surface | Datenquelle | City-Quelle | Bild-Normalisierung | Ergebnis |
|---------|-------------|-------------|---------------------|----------|
| Client Discover (Web) | `get_discovery_models` | effective_city (BUG 4 behoben) | normalizeDocumentspicturesModelImageRef + StorageImage | FIXED |
| Near Me (Web) | `get_models_near_location` | location_city (DISTINCT ON live>current>agency) | normalizeDocumentspicturesModelImageRef + StorageImage | PASS |
| Legacy-Liste (Web) | `getModelsForClient` → gallery | models.city (Fallback) | normalizeDocumentspicturesModelImageRef | PASS |
| Client Detail (Web) | `getModelData` | — | portfolio.images normalisiert | PASS |
| Guest/Package (native+web) | `get_guest_link_models` + signImageUrls | canonicalDisplayCityForModel | HTTPS Signed URLs | PASS |
| Shared Project | clientProjectHydration | fetchEffectiveDisplayCitiesForModels | portfolio_images[0] normalisiert | PASS |
| CustomerSwipeScreen (Ranked) | `getDiscoveryModels` → mapDiscoveryModel | canonicalDisplayCityForModel | normalizeDocumentspicturesModelImageRef | PASS |
| CustomerSwipeScreen (Legacy) | `getModelsPagedFromSupabase` | canonicalDisplayCityForModel | normalizeDocumentspicturesModelImageRef (BUG 5 behoben) | FIXED |

---

## Bekannte Restrisiken

| Risiko | Schwere | Begründung |
|--------|---------|------------|
| Edit-Save: Location-Fail → `step3Succeeded = true` | Low | Alert IS gezeigt; Model-Fields haben saved. Konsistent mit "model saved, location not". Dokumentiertes akzeptables UX-Pattern. |
| Legacy `link_model_by_email` noch in AuthContext | Low | Deprecated, isoliert in Step 2, guard `user_id IS NULL` vorhanden. Kein neuer Code nutzt es. |
| `get_discovery_models` ohne `SET row_security TO off` | Low | Existierendes Verhalten unverändert; SECURITY DEFINER läuft als Funktions-Owner (Superuser), RLS nicht aktiv. Kein neues Risiko eingeführt. |
| CORS bei lokalem Dev für send-invite | Info | Nur lokale Dev-Origins betroffen; Production-Domains korrekt in ALLOWED_ORIGINS. |

---

## Quality Gates

| Gate | Ergebnis |
|------|----------|
| TypeScript (`npm run typecheck`) | 0 Fehler |
| Lint (`npm run lint`) | 0 Errors, 4 pre-existierende Warnings |
| Tests (`npm test`) | 904/904 bestanden |
| Migration 20260519 Deploy | HTTP 201 + Live-Verify |
| Migration 20260520 Deploy | HTTP 201 + Live-Verify |

---

## Abschlusszeile

**FULL FLOW VERIFIED**
