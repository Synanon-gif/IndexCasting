# CURSOR_RULES_UPDATE_REPORT

**Datum:** 2026-04-07  
**Zweck:** Dauerhafte Guardrails für Upload-Härtung, Consent-Matrix, Live-DB-Drift, uiCopy, externe Syncs — **nur Regel- und Doku-Artefakte**, keine App- oder DB-Schema-Änderungen in diesem Schritt.

---

## Geänderte Dateien

| Datei | Ergänzung / Schärfung |
|-------|------------------------|
| [.cursorrules](.cursorrules) | **4b:** Pflicht, Security-/Consent-/Media-/Upload-Fehler-Copy nur über `uiCopy`, keine neuen Hardcodes in Views/Panels. **4b.1:** Verweis auf `upload-consent-matrix.mdc` für technische Upload-Parität + Kurzfassung der Mindestkette. |
| [.cursor/rules/upload-consent-matrix.mdc](.cursor/rules/upload-consent-matrix.mdc) | **Consent vs technical hardening:** zwei Schichten (legal/audit vs. technische Dateivalidierung). **Upload technical parity:** tabellarische Pflichtschritte (MIME, Magic Bytes, Extension, Pfad, `upsert: false`, HEIC, Parität zwischen Services). Matrix-Zeilen für Option-Dokumente, User-Dokumente und Verifikation: klar **Legal** vs **Technical**; Option-Flow präziser. Regel 3 für neue Upload-Oberflächen geschärft. |
| [.cursor/rules/system-invariants.mdc](.cursor/rules/system-invariants.mdc) | **LIVE-DB SOURCE OF TRUTH:** Root-SQL ≠ Production; Drift-Risiko; Pflicht-Live-Check nach SECDEF-/Funktions-Fix (`pg_get_functiondef`, `prokind = 'f'`). **EXTERNE PROFIL-SYNCS:** kein impliziter Storage-Mirror; Verweis auf `docs/MEDIASLIDE_NETWALK_SYNC.md`. **BROWSER-UPLOAD TECHNISCHE PARITÄT:** Verweis auf Matrix. |
| [.cursor/rules/auto-review.mdc](.cursor/rules/auto-review.mdc) | Neue **Risiko-Einträge:** Upload-Parity-Drift; Root-SQL vs Live-DB. **§2b:** Zusatz zu Funktions-Drift / `pg_get_functiondef`. **Stop-Bedingungen:** fehlende Upload-Parity. |
| [.cursor/rules/dev-workflow.mdc](.cursor/rules/dev-workflow.mdc) | Neue Regel **Security-/Hardening-Release:** nach SQL/Storage/SECDEF/Upload-Services typecheck+lint+test **plus** gezielte Live-Verifikation wenn DB betroffen; explizit **ohne** Berührung von Auth/Admin-Routing. |
| [.cursor/rules/rls-security-patterns.mdc](.cursor/rules/rls-security-patterns.mdc) | Kurzer **Einstiegsparagraf:** SQL Source of Truth / Live-Drift + Verweis auf Upload-Matrix (technische Parität). |

---

## Warum diese Änderungen

1. **Upload-Parity:** Verhindert, dass neue Flows nur „Consent“ oder nur „MIME“ implementieren — technische Härtung ist für alle Browser-Uploads verbindlich, unabhängig von `image_rights_confirmations`.
2. **Matrix:** Option-Dokumente und sensible Pfade sind nicht mehr vage „deprecated“, sondern klar in Legal vs Technical getrennt.
3. **Live-Drift:** Dokumentiert den realen Vorfall (Root-SQL vs. deployte Funktion); verlangt explizite Live-Prüfung nach Security-relevanten DB-Änderungen.
4. **uiCopy:** Reduziert Regression zu Hardcode-Alerts in Media/Legal-Bereichen.
5. **Mediaslide/Netwalk:** Verbindliche Trennung Metadaten-Sync vs. Asset-Mirror — vermeidet falsche Annahme „Sync = eigener Bucket“.

---

## Bewusst nicht geändert

- `src/context/AuthContext.tsx`, `App.tsx`, `signIn`, `bootstrapThenLoadProfile`, `loadProfile`, Admin-Routing, `get_my_org_context()` und zugehörige DB-RPC-Texte in diesem Commit: **keine Änderungen**.
- **Keine** neuen SQL-Migrationen, **keine** RLS-/Policy-/RPC-Änderungen in diesem Schritt (nur Regeln).
- **Keine** Service- oder Produktionscode-Anpassungen — die beschriebenen Härtungen waren bereits umgesetzt; hier nur **Normierung in den Regeln**.

---

## Explizite Bestätigung

- **Keine** Änderungen an Auth-, Admin-, Login- oder Routing-Implementierung.
- **Keine** DB-/RLS-/RPC-/Migrations-Änderungen im Rahmen dieser Regel-Aktualisierung.

---

## Status

**RULES UPDATED**

Geänderte / neu relevante Artefakte: siehe Tabelle oben; zusätzlich dieses Report-File `CURSOR_RULES_UPDATE_REPORT.md`.
