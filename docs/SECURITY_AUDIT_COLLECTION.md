# Security-Audit: Dateien sammeln (ohne Secrets)

Dieses Repo hat **keinen** Ordner `supabase/sql/` — alle SQL-Migrationen liegen unter `supabase/migrations/` und zusätzlich viele Root-Dateien `supabase/migration_*.sql`.

## Ein Befehl: alles in **einer** Datei (empfohlen)

```bash
npm run security-audit-bundle
```

Ergebnis (lokal, nicht im Git): **`docs/SECURITY_AUDIT_CODE_BUNDLE.md`** (~50k+ Zeilen, ~1–2 MB).  
Inhalt in der Reihenfolge:

| Priorität | Inhalt |
|-----------|--------|
| **1 — Database** | `MIGRATION_ORDER.md`, `README.md`, **alle** `supabase/**/*.sql` (ohne `.temp`) |
| **2 — Edge Functions** | `supabase/functions/*/index.ts` (vollständig) |
| **3 — Services** | `src/services/**/*.ts` ohne `__tests__` |
| **4 — Context** | `src/context/*` |
| **5 — Config / Client** | `src/config/env.ts`, `lib/supabase.ts` |
| **6 — Store** | `src/store/*.ts` ohne Tests |
| **7 — DB (lokal)** | `src/db/*.ts` |
| **8 — Utils** | `src/utils/*.ts` ohne `__tests__` |
| **9 — Env** | `.env.example` nur (Platzhalter) |

**Nicht enthalten (absichtlich):**

- `.env`, `.env.local`, `.env.supabase` — **niemals** teilen
- `src/**/__tests__/**` — Testcode
- Große UI-Monolithen (`ClientWebApp.tsx`, `AgencyControllerView.tsx`) — Logik für Discovery/Filters liegt in Services/Utils; bei Bedarf manuell ergänzen

## Manuelle Ergänzungen für „Frontend-Queries“

Wenn der Auditor **konkret** UI-Data-Flow sehen soll:

- `src/web/ClientWebApp.tsx` (sehr groß)
- `App.tsx`
- ggf. `src/components/ModelFiltersPanel.tsx`

Diese optional nach dem Bundle anhängen oder in zweiter Datei senden.

## Validierung vor dem Upload

- [ ] Keine echten Keys, Tokens oder vollständigen `.env`-Dateien
- [ ] Nur `EXPO_PUBLIC_*` / Platzhalter aus `.env.example` erwähnen
- [ ] Bei Bedarf Bundle-Größe prüfen: `wc -c docs/SECURITY_AUDIT_CODE_BUNDLE.md`

## Architektur-Kontext (kleiner, getrennt)

Für Überblick **ohne** vollständigen Code: `docs/LLM_FULL_REVIEW_CONTEXT.md` generieren mit:

```bash
npm run review-context
```
