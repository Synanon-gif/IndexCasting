# Client Project Conservative Hardening — Report

## 1. Executive Summary

Der Client-Project-Flow wurde minimal gehärtet: (a) **Hydration** lädt Projekt-Modelle mit **einer** `can_access_platform`-Prüfung und **gebatchten** `models`-SELECTs statt N+1 Einzelabfragen; (b) **`add_model_to_project`** akzeptiert optional **`p_organization_id`** mit Membership-Check, sodass bei bekannter Client-Org kein implizites `LIMIT 1` mehr nötig ist. AuthContext, Paywall-Reihenfolge und Package/Shared-Isolation wurden nicht angefasst.

## 2. Was geprüft wurde

| Bereich | Ergebnis |
|--------|----------|
| Multi-Org / RPC `LIMIT 1` | Adressiert durch optionalen Org-Parameter + ClientWebApp übergibt `clientOrgId` |
| Hydration N+1 / Paywall-RPC | Reduziert durch `getModelsByIdsForClientFromSupabase` |
| Owner-only Delete UX | Bereits konsistent (`canDeleteProject` + Handler) — keine Änderung |
| Reconciliation nach Add/Remove | Bereits vorhanden — keine Änderung |
| Empty DB vs. localStorage | Kurzer LS-Ghost vor Hydration-Effect bleibt dokumentiertes Restrisiko |
| Package / Shared / externer Link | Keine Änderung an Filtern oder Modi |

## 3. Umgesetzte kleine Härtungen

- **`getModelsByIdsForClientFromSupabase`** in `src/services/modelsSupabase.ts` (Chunk-Größe 80).
- **`fetchHydratedClientProjectsForOrg`** nutzt die Map statt pro-Model `getModelByIdForClientFromSupabase`.
- **Migration** `supabase/migrations/20260410_add_model_to_project_explicit_org.sql`: 3-Parameter-RPC, explizite Org mit Membership-Guard, Fallback `LIMIT 1` wenn `p_organization_id` fehlt.
- **`addModelToProject(..., organizationId?)`** + **ClientWebApp** übergibt `clientOrgId` wenn gesetzt.
- **Regel** in `.cursor/rules/auto-review.mdc` (eine Bullet-Zeile).

## 4. Bewusst nicht geändert

- Auth/bootstrap, `can_access_platform`-Logik, Admin, Calendar/RLS, Invite/Claim, Location-Priorität, Discovery.
- Kein Full-Refetch nach Project-Delete, kein Hydration-Gate gegen LS-Flash (UX-Tradeoff).
- Kein Redesign der Project-UI.

## 5. Geänderte / neue Dateien

| Datei |
|-------|
| `src/services/modelsSupabase.ts` |
| `src/services/projectsSupabase.ts` |
| `src/web/ClientWebApp.tsx` |
| `supabase/migrations/20260410_add_model_to_project_explicit_org.sql` |
| `.cursor/rules/auto-review.mdc` |
| `CURSOR_CLIENT_PROJECT_CONSERVATIVE_HARDENING_*.md` / `.json` (Deliverables) |

## 6. Rules angepasst?

Ja — minimal: `.cursor/rules/auto-review.mdc` (eine Zeile zu `addModelToProject` + `p_organization_id`).

## 7. Migration / Live-Verify

- Migration `20260410_add_model_to_project_explicit_org.sql` per `scripts/supabase-push-verify-migration.sh` deployed (**HTTP 201**).
- Verify: Live `add_model_to_project` mit **pronargs = 3**.

## 8. Quality Gates

- `npm run typecheck` — **OK**
- `npm run lint` — **OK**
- `npm test -- --passWithNoTests --ci` — **OK**

## 9. Verbleibende Restrisiken

- **localStorage:** Sehr kurz können veraltete Projekte angezeigt werden, bis der Hydration-`useEffect` läuft.
- **RPC ohne Org-Parameter:** Alte Clients, die nur zwei Argumente senden, nutzen weiterhin `LIMIT 1` (bewusster Fallback).
- **Batch-Hydration:** Einzelne Chunk-Fehler werden geloggt; andere Chunks können trotzdem geladen werden — partielle Listen möglich (selten).

---

**CLIENT PROJECT CONSERVATIVE HARDENING COMPLETE — MINOR RISKS REMAIN**
