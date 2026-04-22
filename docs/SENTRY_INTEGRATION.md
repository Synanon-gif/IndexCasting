# Sentry Integration — Minimal Setup

Stand: 2026-04-22 · Owner: Lead Engineer

Sentry läuft im **Minimal-Setup**:
nur Crash-/Error-Reporting, **kein** Session Replay, **kein** Performance/Tracing,
**kein** Profiling, **kein** Auto-User-Tracking.

Aktiv ab `EXPO_PUBLIC_APP_ENV=preview` oder `production`.
In `development` (Default) ist Sentry **stumm** (`enabled: false`),
auch wenn ein DSN gesetzt ist — kein Logspam beim lokalen Hacken.

---

## 1. Setup

### 1.1 Environment-Variablen

In `.env.local` (lokal) bzw. Vercel/EAS Build (Preview/Prod) setzen:

```bash
# Public Client-DSN aus dem Sentry-Projekt (org "index-casting", project "react-native").
# Niemals den Auth-Token committen oder als EXPO_PUBLIC_* exposen!
EXPO_PUBLIC_SENTRY_DSN=https://xxxxxxx@oXXXX.ingest.de.sentry.io/XXXXX

# Steuert Sentry environment-Tag. development → Sentry deaktiviert.
EXPO_PUBLIC_APP_ENV=production   # oder preview
```

Beide Werte werden über `app.config.js` → `extra.sentryDsn` / `extra.appEnv`
durchgereicht und in `src/observability/sentry.ts` gelesen.

Fehlt der DSN, ist Sentry komplett aus — ohne Fehler, ohne Warnung.

### 1.2 Lokale Verifikation

```bash
npm run typecheck
npm run lint
npm test -- --passWithNoTests --ci
```

Alle Sentry-Aufrufe sind im Test-Setup gegen einen No-Op-Stub gemockt
(`jest/sentry-react-native-stub.cjs`), Tests laden also nie das echte SDK.

### 1.3 Lokales Deaktivieren / Kontrolliertes Testen

* **Deaktivieren** (Default in dev): einfach `EXPO_PUBLIC_SENTRY_DSN` leer lassen
  oder `EXPO_PUBLIC_APP_ENV=development` (Sentry initialisiert nicht).
* **Lokal kontrolliert testen**: `EXPO_PUBLIC_APP_ENV=preview` setzen + DSN —
  dann gehen Errors an das Sentry-Projekt. Vorsicht: **niemals**
  Production-DSN mit dev-Daten mischen.

---

## 2. Was wird gemeldet

| Quelle                                         | Was geht zu Sentry                                          |
| ---------------------------------------------- | ----------------------------------------------------------- |
| `AppErrorBoundary`                             | Render-Crashes als `captureException` (mit componentStack). |
| `logger.error(...)` / `logger.fatal(...)`      | Als Sentry-Exception (wenn `context.error` ein `Error` ist) bzw. als `captureMessage`. |
| `logger.warn(...)`                             | Nur als Breadcrumb (level=warning), keine separate Event.   |
| `PackageImportPane` (Agency UI)                | Breadcrumbs für `analyze_start`, `drift_block`, `drift_override`, `commit_start`, `commit_persist_image_issues`, `commit_fail`. |
| `finalizePendingInviteOrClaim`                 | `captureMessage` für `model_claim_fatal:*` (inkl. `already_claimed_by_other_user`) und `invite_accept_fatal:*`. |
| Unhandled Errors / Promise Rejections (RN/Web) | Vom SDK automatisch erfasst.                                |

Tags, die wir setzen (für Sentry-Filter):

* `area`: `agency` | `client` | `model` | `admin` | `guest` | `auth` | `public`
* `screen`: z. B. `package-import`
* `provider`: `mediaslide` | `netwalk`
* `import_phase`: z. B. `analyze_start`

---

## 3. Was bewusst NICHT gemeldet wird (DSGVO/Datensicherheit)

`beforeSend` und `redactDeep` in `src/observability/sentry.ts` filtern aktiv:

* **Tokens / Capability-URLs** (jeweils im Query-Param **und** im Pfad):
  `model_invite`, `invite_token`, `invite`, `token`, `code`,
  `access_token`, `refresh_token`,
  `package_url`, `package_capability_url`, `capability_url`, `capability`,
  `apikey`, `api_key`, `key`, `secret`, `authorization`.
* **Header**: `authorization`, `cookie`, `set-cookie`, `apikey`,
  `x-supabase-auth`, `x-api-key`, `x-csrf-token`.
* **JWTs** (`eyJ...`), **Bearer**-Tokens, **lange Hex-Blobs**, **E-Mail-Adressen**.
* **Cookies** im Request-Body werden komplett auf `[REDACTED]` gesetzt.
* **Object-Keys** mit Namen wie `password`, `access_token`, `refresh_token`,
  `api_key`, `secret`, `service_role`, `token` werden als `[REDACTED]` ersetzt.
* **Default-PII**: `sendDefaultPii: false` → keine IPs, keine Cookies,
  keine User-Agent-Details automatisch.
* **User-Identität**: nur pseudonyme `auth.uid()`, niemals E-Mail/Name.
* **Mother Agency / Netwalk**: keine speziellen Tags / kein „live"-Marker
  (Mother Agency ist rein informativ; Netwalk-Provider nicht implementiert
  und wird auch in Sentry nur generisch als `provider:netwalk` getaggt).

Tests dazu: `src/observability/__tests__/sentry.scrub.test.ts` (lauffähig in CI).

---

## 4. Datenschutzerklärung — verpflichtender Hinweis

In die Datenschutzerklärung (`src/screens/PrivacyScreen.tsx` o. ä.)
muss der folgende Abschnitt aufgenommen werden, sobald Sentry produktiv
eingeschaltet ist:

> **Fehleranalyse mit Sentry**
> Wir nutzen Sentry (Functional Software, Inc., Vertragspartner: Sentry GmbH,
> Hosting in der EU – `*.de.sentry.io`) zur technischen Fehleranalyse.
> Bei einem Fehler übermitteln wir den Fehlertext, einen Stacktrace, das
> Gerätemodell, Betriebssystem, App-Version und einen pseudonymen Nutzer-Identifier.
> Wir übermitteln **keine** E-Mail-Adressen, **keine** Klartext-Tokens,
> **keine** Capability-URLs (z. B. Package-Importe) und **keine** vollständige
> IP-Adresse (`sendDefaultPii: false`). Rechtsgrundlage: Art. 6 Abs. 1 lit. f
> DSGVO (berechtigtes Interesse an Stabilität und Sicherheit der Anwendung).

---

## 5. Was bewusst nicht eingebaut wurde (optional, später)

Diese Erweiterungen sind **vorbereitet, aber nicht aktiv** — bewusst, um
Build-Risiko und Datenmenge gering zu halten. Aktivierung jeweils ein PR:

1. **Source-Map-/Debug-Symbol-Upload via Expo-Plugin**
   `@sentry/react-native/expo` und `@sentry/react-native/metro` sind
   **nicht** in `app.json` / `metro.config.js` eingetragen.
   → Aktivieren: später per `npx @sentry/wizard@latest -i reactNative`
   plus `SENTRY_AUTH_TOKEN` als Build-Secret. Kein App-Code-Change nötig.
2. **Performance-Monitoring (`tracesSampleRate`)** — aktuell `0`.
3. **Session Replay (`replaysSessionSampleRate`)** — nicht installiert.
4. **OTA-Update-Kontext** (Expo Updates Integration) — nicht aktiviert.

---

## 6. Architektur-Zusammenfassung

```
index.ts
  └── initSentry()                       (no-op ohne DSN / dev)
       └── Sentry.init({ beforeSend, beforeBreadcrumb, sendDefaultPii: false })

src/observability/sentry.ts
  ├── redactUrl()      — Query-Param-Maskierung + JWT/Email/Hex
  ├── redactDeep()     — rekursive Object-Maskierung
  ├── sanitizeEvent()  — beforeSend
  ├── sanitizeBreadcrumb()
  ├── captureException() / captureMessage() / addBreadcrumb()  — sichere Wrapper
  └── setFlowContext() / setUserContext()

src/utils/logger.ts
  └── shipToSentry()   — error/fatal → captureException/Message; warn → breadcrumb

src/components/AppErrorBoundary.tsx
  └── captureException(error, { component_stack })

src/components/PackageImportPane.tsx
  └── breadcrumbs: analyze_start | drift_block | drift_override | commit_start | commit_persist_image_issues | commit_fail

src/services/finalizePendingInviteOrClaim.ts
  └── captureMessage: model_claim_fatal:* | invite_accept_fatal:*
```

Alle Wrapper sind **fail-closed**: wenn Sentry nicht initialisiert ist,
laufen die Aufrufer einfach durch — die App wird nie blockiert oder gebrochen.
