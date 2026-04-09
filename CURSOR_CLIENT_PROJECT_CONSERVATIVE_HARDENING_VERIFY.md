# Client Project Conservative Hardening — Verify

## Automatisch (CI)

- [ ] `npm run typecheck`
- [ ] `npm run lint`
- [ ] `npm test -- --passWithNoTests --ci`

## SQL (nach Deploy)

- [ ] `scripts/supabase-push-verify-migration.sh` für `20260410_add_model_to_project_explicit_org.sql`
- [ ] Live: `pg_get_functiondef` für `public.add_model_to_project` — prüfen: `p_organization_id`, Membership-Branch, `LIMIT 1` nur im NULL-Zweig

## Manuell — Client Web (authenticated)

1. **Hydration:** Login als Client mit Org, Tab Projects — Projekte und Modelle laden ohne Fehler.
2. **Add to project:** Modell aus Discover einem Projekt hinzufügen — Erfolg + Reconcile (keine falschen Duplikate).
3. **Remove:** Modell aus Projekt entfernen — UI und DB konsistent.
4. **Delete project:** Nur als Owner sichtbar/ausführbar; Nicht-Owner sieht keinen Delete-Button (bzw. Feedback beim Klick).

## Package / Shared (Regression)

5. **Package mode:** Keine Änderung am `filteredModels`-Guard erwartet — kurz öffnen, Detail prüfen.
6. **Shared internal project:** `isSharedMode` — Projekt öffnen, keine Discovery-Filter auf falsches Set.

## Multi-Org (falls testbar)

7. User in zwei Client-Orgs: Projekt in Org B — Add mit gesetztem `clientOrgId` = B muss gelingen; falsche Org muss serverseitig scheitern.
