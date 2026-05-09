# E2E Branch — Final Safety Audit (Commit-Vorbereitung)

**Erstellt:** 2026-05-07  
**Branch:** `e2e-test-environment`  
**Automatischer Commit:** bewusst **nicht** ausgeführt — nur Readiness-Report.

---

## 1. Branch

```text
e2e-test-environment
```

---

## 2. Geänderte / neue Dateien — Klassifikation

| Pfad | Klassifikation |
|------|----------------|
| `.gitignore` | Erlaubte Konfiguration (E2E-Artefakte, `.env.e2e*`, Seed-Manifest) |
| `package.json` | Erlaubte Konfiguration — Diff betrifft **nur** `scripts` (E2E-Aliase + `seed:e2e`, angepasste `test:e2e:*`-Pfade nach `tests/e2e`) |
| `playwright.config.ts` | Erlaubte Konfiguration (Testdir, Reporter, Projekte, `.env.e2e`-Load, Webserver-Logik) |
| `tsconfig.json` | Erlaubte Konfiguration — `exclude`: `e2e` → `tests/e2e` + `playwright.config.ts` (E2E-Exclusion) |
| `e2e/*.spec.ts` (gelöscht) | Erlaubtes Harness — alte Pfade, Inhalt nach `tests/e2e/` verschoben |
| `tests/e2e/**` (untracked) | Erlaubtes E2E-Harness |
| `scripts/e2e/**` (untracked) | Erlaubtes E2E-Harness |
| `.env.e2e.example` (untracked) | Erlaubtes Beispiel-Env (Placeholders) |
| `docs/e2e-*.md` (untracked) | Erlaubte Dokumentation |
| `e2e/README.md` (untracked) | Erlaubtes Harness-Doku (Legacy-Ordner-README) |

**Verbotene Pfade in diesem Diff:** Keine — **kein** `src/**`, **kein** `supabase/**`, **kein** `App.tsx`, **kein** `AuthContext`, **kein** Services/Stores/Routing-Produktcode.

**Verdächtig:** keine Datei außerhalb des erlaubten Umfangs erkannt.

---

## 3. Secrets / Artefakte — Status

| Ressource | `git check-ignore` | In Git getrackt (`git ls-files` + Muster) |
|-----------|-------------------|---------------------------------------------|
| `.env.e2e` | ✓ ignoriert | — (kein Treffer) |
| `.env.e2e1` | ✓ ignoriert | — |
| `docs/e2e-seed-manifest.json` | ✓ ignoriert | — |
| `playwright-report/` | ✓ ignoriert | — |
| `test-results/` | ✓ ignoriert | — |
| `e2e-artifacts/` | ✓ ignoriert | — |

Zusätzlicher Scan auf getrackte Artefakt-Muster (`trace.zip`, `video.webm`, `test-failed*.png`, …): **keine Treffer**.

**Hinweis:** Keine Klartext-Ausgabe von Secrets in diesem Dokument.

---

## 4. `.env.e2e.example` — Kurzprüfung

- Platzhalter/leere Werte für Passwort/Keys where applicable; Supabase-Variablen für Seed **auskommentiert**.
- `E2E_BASE_URL` Default `http://localhost:8081` — unkritisch.
- Write-Gates dokumentiert und **nicht** aktiv gesetzt (`#` / leer).
- **Verdict:** akzeptabel für Commit; keine echten Tokens/Keys/Passwörter sichtbar.

---

## 5. Seed-Script — `scripts/e2e/seed-e2e-world.mjs`

| Kriterium | Status |
|-----------|--------|
| `E2E_ALLOW_SEED_ON_THIS_DATABASE=I_UNDERSTAND` Pflicht | ✓ |
| Service Role nur aus Env, nicht geloggt | ✓ (Passwortlänge-Pflicht ≥16) |
| Nur `@index-casting.test`-Accounts | ✓ |
| E2E TEST / PLAYWRIGHT Labels in Daten | ✓ |
| `DELETE`-Statements | ✓ keine im Skript |
| Breite `UPDATE` ohne Filter | ✓ vermieden — Updates nutzen `.eq('id', …)` wo relevant |
| Migrationen | ✓ keine |

**Manifest:** schreibt IDs/Hosts in `docs/e2e-seed-manifest.json` — Datei ist **gitignored**; Inhalt ist ID-orientiert (kein Secret-Intent).

**Idempotenz — Restrisiko (Dokumentation, kein Blocker für Harness-Commit):**

- `calendar_entries`-`insert`-Schleife: erneuter Seed-Lauf kann **zusätzliche** Zeilen erzeugen (kein Upsert/Unique-Handling in diesem Block).
- `guest_links`-`insert`: ohne „existiert schon“-Pfad — wiederholter Lauf kann mehrere aktive Links erzeugen.

Skript behauptet bewusst „idempotent upserts where possible“ — die obigen Inserts sind die bekannten Ausnahmen/Härtefälle; für produktive Produkt-DB nicht gedacht, nur isolierte E2E-DB.

**Verdict:** **OK für Review-Commit** des Harness unter der Voraussetzung „nur isolierte DB + seltener Re-Seed oder Cleanup-Strategie extern“.

---

## 6. Write-Gates — Verifikation

| Gate | Variable | Implementierung (Kurz) |
|------|-----------|-------------------------|
| Chat | `E2E_ALLOW_CHAT_WRITES=I_UNDERSTAND` | `tests/e2e/helpers/env.ts` → `isWriteTestAllowed('chat')`; `p0-messaging.spec.ts` `test.skip` wenn false; hosted zusätzlich Hosted-Latch |
| Option-Lifecycle | `E2E_ALLOW_OPTION_LIFECYCLE_MUTATIONS=I_UNDERSTAND` | `p0-option-lifecycle-mutations.spec.ts` skip |
| Hosted (nicht local/LAN) | `E2E_ALLOW_HOSTED_WRITES=I_UNDERSTAND_HOSTED_WRITE_RISK` | `isWriteTestAllowed` blockt stateful writes ohne diesen Wert auf Production-like URLs |

- **`npm run e2e:read`:** `--grep-invert` entfernt titelbasiert u. a. Stateful-Chat-/Roundtrip-Fälle („linked option:|B2B full roundtrip:|agency sends to linked model“); **kein** vollständiges `e2e:p0`.
- **`npm run e2e:p0`:** enthält alle `@p0`-Tests; stateful Specs **skippen**, solange Gates aus sind (kein False-Pass durch stilles Weglassen der Assertions in geskippten Tests).

**Verdict:** Write-Pfade sind **nicht** „ungated“; Default bleibt sicher.

---

## 7. Validierung (npm)

| Schritt | Ergebnis |
|---------|----------|
| `npm run typecheck` | ✓ Exit 0 |
| `npm run lint` | ✓ Exit 0 |
| `npm test -- --ci --passWithNoTests` | ✓ 197 Suites / 2796 Tests |

---

## 8. Read-E2E (Playwright)

**Befehle (wie angefordert):**

```bash
PLAYWRIGHT_SKIP_WEB_SERVER=1 npm run e2e:preflight
PLAYWRIGHT_SKIP_WEB_SERVER=1 npm run e2e:read
```

| Suite | Ergebnis | Anmerkung |
|-------|----------|-----------|
| `e2e:preflight` | **1 passed** | Lauf auf dem **lokalen** Rechner des Audits; `E2E_BASE_URL` kam aus **lokaler** `.env.e2e` (gitignored) — ggf. Hosted-URL → Harness warnte zu Recht über Non-Local/Service-Role-Kombination ohne **Write**-Gates. |
| `e2e:read` | **38 passed**, 0 failed | Dauer ~5,3 min. **Kein** `e2e:p0` und **keine** Write-Gates gesetzt. |

**Wichtig für Reviewer:** CI/andere Maschinen müssen eigene `.env.e2e` + Ziel-URL haben; Ergebnisse sind **umgebungsgebunden**.

---

## 9. Verbleibende bekannte Lücken

Siehe **`docs/e2e-known-gaps.md`** (Selektoren, Seed/Env, Write-Gate-Leiter, P1-Blocker). Keine neuen Blocker aus diesem Audit gegen Commit des Harness.

---

## 10. Commit-fähig? Push-fähig?

| Frage | Antwort |
|-------|---------|
| Branch **sicher zu committen** (nur Harness + Docs + Config)? | **Ja** — sofern beim `git add` **nur** erlaubte Pfade aufgenommen werden (siehe §11) und **keine** Secret-Dateien. |
| Branch **sicher zu pushen**? | **Ja** aus Sicht „kein Produktcode“ — fachlich abhängig von Team-Review/CI; **kein** automatischer Push durch dieses Audit. |

---

## 11. Empfohlen für Commit (`git add`)

- `.gitignore`
- `package.json` (Scripts-Block — bereits E2E-only im Diff)
- `playwright.config.ts`
- `tsconfig.json`
- `.env.e2e.example`
- `docs/e2e-*.md` (alle gewünschten E2E-Dokus inkl. dieser Datei nach Freigabe)
- `e2e/README.md` (falls gewünscht)
- `scripts/e2e/`
- `tests/e2e/`
- **Staging der Löschungen** der alten `e2e/*.spec.ts`-Dateien (`git add -u e2e/` o. Ä.)

---

## 12. Untracked / ignoriert — **nicht** committen

| Pfad / Muster |
|----------------|
| `.env.e2e`, `.env.e2e1` |
| `docs/e2e-seed-manifest.json` |
| `playwright-report/` |
| `test-results/` |
| `e2e-artifacts/` |
| `trace.zip`, `*.webm`, fehlgeschlagene Screenshots aus Läufen |

---

## 13. Bestätigungen (Checkliste)

| # | Aussage |
|---|---------|
| 1 | **Kein** Produktcode (`src/**` etc.) in diesem Branch-Diff |
| 2 | **Kein** `src/**` geändert |
| 3 | **Kein** `supabase/**` geändert |
| 4 | **Keine** Write-Gates für dieses Audit aktiviert (`E2E_ALLOW_*` weiterhin default-off in **Beispieldatei**; tatsächliche `.env.e2e` nicht Teil des Repos) |
| 5 | **Keine** ausdrücklich angeforderten Hosted-**Write**-Flows als Teil des Audits ausgeführt (`e2e:p0` nicht gelaufen; `e2e:read`/`preflight` read-sicher) |
| 6 | **`npm run seed:e2e`** wurde im Rahmen dieses Audits **nicht** ausgeführt |

---

## 14. Nächster Schritt

Nach **expliziter Freigabe**: separater Commit-Prompt (z. B. Conventional Commit für `test(e2e): …` oder `chore(e2e): …`). Dieses Dokument dient als Nachweis für Review/PR-Beschreibung.
