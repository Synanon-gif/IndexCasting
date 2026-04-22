# Sentry Integration — Minimal Setup

Stand: 2026-04-22 · Owner: Lead Engineer

Sentry läuft im **Minimal-Setup**:
nur Crash-/Error-Reporting, **kein** Session Replay, **kein** Performance/Tracing,
**kein** Profiling, **kein** Auto-User-Tracking.

Aktiv ab `EXPO_PUBLIC_APP_ENV=preview` oder `production`.
In `development` (Default) wird Sentry **gar nicht erst initialisiert** —
auch wenn ein DSN gesetzt ist. Kein Logspam, keine Hooks, keine Listener
beim lokalen Hacken. Unbekannte Werte (`staging`, `qa`, …) werden ebenfalls
als „kein Sentry" behandelt (fail-closed by design).

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

### 1.2 Vercel (Preview-Build scheitert oft an **Namen** oder **Environment-Scope**)

Der Web-Export (`npm run build` / `expo export --platform web`) liest **`app.config.js`** nur zur **Build-Zeit**. Auf Vercel gibt es **kein** `.env.local` — alles kommt aus dem Vercel-Dashboard.

| Vercel-Variable | Pflicht? | Hinweis |
|-----------------|----------|---------|
| `EXPO_PUBLIC_SENTRY_DSN` | Optional (ohne DSN: Sentry aus) | **Exakt dieser Name** — nicht `SENTRY_DSN`, nicht `NEXT_PUBLIC_SENTRY_DSN` allein (wir lesen primär `EXPO_PUBLIC_*`). |
| `EXPO_PUBLIC_APP_ENV` | Für aktives Sentry: `preview` oder `production` | Ohne Eintrag: Default `development` → **Sentry wird nicht initialisiert** (Absicht). |
| `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Für laufende App | Oft schon gesetzt; Preview-Deploys brauchen dieselben **EXPO_PUBLIC_**-Keys wie Production, falls die App sie erwartet. |

**Preview-Deployment:** Pro Variable im Vercel-Dashboard **Environment „Preview“** ankreuzen (nicht nur Production). Sonst fehlen die Werte beim Preview-Build.

**DSN eintragen:** Ohne umschließende **Anführungszeichen**, **eine Zeile**, vollständige URL (`https://…@…ingest…/…`).

**Sentry-Seite:** Für reines Error-Tracking ist **kein** Auth-Token (Build-Upload, Sourcemaps) nötig — nur der **öffentliche Client-DSN** unter *Settings → Client Keys (DSN)*. Alerts/Team/Projekt-Einstellungen sind optional.

### 1.3 Lokale Verifikation

```bash
npm run typecheck
npm run lint
npm test -- --passWithNoTests --ci
```

Alle Sentry-Aufrufe sind im Test-Setup gegen einen No-Op-Stub gemockt
(`jest/sentry-react-native-stub.cjs`), Tests laden also nie das echte SDK.

### 1.4 Lokales Deaktivieren / Kontrolliertes Testen

* **Deaktivieren** (Default in dev): einfach `EXPO_PUBLIC_SENTRY_DSN` leer lassen
  oder `EXPO_PUBLIC_APP_ENV=development` (Sentry initialisiert nicht).
* **Lokal kontrolliert testen**: `EXPO_PUBLIC_APP_ENV=preview` setzen + DSN —
  dann gehen Errors an das Sentry-Projekt. Vorsicht: **niemals**
  Production-DSN mit dev-Daten mischen.

### 1.5 Test-Exception manuell auslösen

Im Preview-/Production-Build temporär einen Knopf einbauen:

```ts
import { captureException } from './observability/sentry';
captureException(new Error('sentry smoke test ' + Date.now()), { source: 'manual-smoke' });
```

…und nach Verifikation im Sentry-Dashboard wieder entfernen. Niemals dauerhaft
einbauen, kein Smoke-Trigger im UI lassen.

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

`beforeSend`, `beforeBreadcrumb` und `redactDeep` in `src/observability/sentry.ts`
filtern in **mehreren Schichten** vor dem Versand:

### Query-Parameter und URL-Hash-Fragmente
Werden ersetzt durch `[REDACTED]`, sowohl in `?…` als auch in `#…`
(Supabase Magic-Links transportieren `access_token`/`refresh_token` im Hash):
`model_invite`, `invite_token`, `invite`, `token`, `code`,
`access_token`, `refresh_token`,
`package_url`, `package_capability_url`, `capability_url`, `capability`,
`apikey`, `api_key`, `key`, `secret`, `authorization`.

### HTTP-Header (Request-Headers, automatisch von Sentry erfasst)
`authorization`, `cookie`, `set-cookie`, `apikey`,
`x-supabase-auth`, `x-api-key`, `x-csrf-token` → komplett `[REDACTED]`.

### String-Pattern (in jedem freien Text — Error-Message, breadcrumb.message,
exception.value, transaction-Name, Extras)
* **JWTs** (`eyJ…` 3-teilig, mind. 10 Zeichen pro Segment) → `[REDACTED_JWT]`
* **Supabase-Secret-Keys** (`sb_secret_…`, `sbp_…`, `service_role_…`) → `[REDACTED_SUPABASE_KEY]`
* **Bearer-Tokens** (`Bearer abc…`, ≥ 20 Zeichen) → `Bearer [REDACTED]`
* **E-Mail-Adressen** → `[REDACTED_EMAIL]`
* **Lange Hex-Blobs** (≥ 32 Zeichen) → `[REDACTED_HEX]`

### Object-Keys (rekursiv tief, case-insensitive, normalisiert auf
lower-snake_case — fängt also `claimToken`, `claim_token`, `CLAIM-TOKEN`)
**Vollständig durch `[REDACTED]` ersetzt** (Hardening 2026-04, F4):
* Auth: `password`, `pwd`, `pass`, `secret`, `service_role`, `service_role_key`,
  `api_key`, `apikey`, `authorization`, `auth_token`, `access_token`,
  `refresh_token`, `token`, `jwt`, `bearer`, `cookie`, `session_token`,
  `magic_link`, `recovery_token`, `reset_token`, `verify_token`,
  `verification_token`, `webhook_secret`, `signing_secret`, `private_key`
* Supabase RPC-Param-Namen: `p_token`, `p_invite_token`, `p_claim_token`
* Invite/Claim: `invite`, `invite_token`, `invitation_token`, `claim`,
  `claim_token`, `model_invite`
* Capability-URLs: `capability`, `capability_url`, `capability_token`,
  `package_url`, `package_capability_url`, `package_capability`

**URL-redaktiert** (Routing-Info bleibt, Tokens raus):
`url`, `href`, `link`, `from`, `to`, `origin`, `referrer`, `redirect`,
`callback`, `next_url`, `request_url`, `response_url`, `webhook_url`.

### Sentry-Event-Felder
* `event.exception.values[].value` und `.type` durchlaufen `redactString`
  (Hardening F6) — die Hauptzeile im Sentry-Dashboard ist immer geprüft.
* `event.transaction` (Screen-/Route-Name) wird als URL behandelt (F7).
* `event.user` wird auf `{ id }` (Pseudonym) reduziert.
* `event.request.cookies` wird komplett auf `[REDACTED]` gesetzt.

### Default-PII komplett aus
`sendDefaultPii: false` → keine IPs, keine Cookies, keine User-Agent-Details
automatisch. Performance/Tracing/Replay/Profiling sind explizit `0` bzw.
nicht installiert.

### User-Identität
Nur pseudonyme `auth.uid()` (UUID), niemals E-Mail/Name/Telefon. Die ID wird
bei Login/Logout über `setUserContext` in `AuthContext` gesetzt (kein PII).

### Mother Agency / Netwalk
Keine speziellen Tags, kein „live"-Marker:
* **Mother Agency** ist rein informativ (Anzeige), wird **nicht** an
  Observability angebunden. Sollte ein Mother-Agency-Wert versehentlich
  in einem Error-Context landen, greifen die generischen Scrubber.
* **Netwalk** ist als Provider noch **nicht implementiert** und wird in
  Sentry nur generisch als `provider:netwalk` getaggt — keine spezielle
  Telemetrie, keine Erfolgsmeldungen, keine Marketing-Optik.

Tests: `src/observability/__tests__/sentry.scrub.test.ts` (34 Cases, lauffähig in CI).
Diese Tests sind die DSGVO-Sicherung der Integration und dürfen niemals
stillschweigend rot werden.

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

1. **Expo-Plugin + Metro (Debug-IDs, Release fürs Web-Bundle)** — **aktiv:**
   `app.json` → `plugins` mit `@sentry/react-native` (Org `index-casting`,
   Projekt `react-native`, EU-URL `https://de.sentry.io`), `metro.config.js`
   → `getSentryExpoConfig` mit `includeWebReplay: false` (kein Replay).
   **Sourcemap-Upload** zu Sentry (lesbare Stacks in der UI): weiterhin optional
   — dafür `SENTRY_AUTH_TOKEN` in EAS/Vercel Build-Umgebung setzen und
   Sentry-CLI-Upload beim Release-Build (siehe Sentry-Doku „Expo“).
2. **Performance-Monitoring (`tracesSampleRate`)** — aktuell `0`.
3. **Session Replay (`replaysSessionSampleRate`)** — nicht installiert.
4. **OTA-Update-Kontext** (Expo Updates Integration) — nicht aktiviert.

---

## 6. Architektur-Zusammenfassung

```
app.json          — Expo-Config-Plugin @sentry/react-native (native Projekte + Build-Metadaten)
metro.config.js   — getSentryExpoConfig (Debug-IDs, Web-Release-Injection, kein Replay)

index.ts
  └── initSentry()     (no-op ohne DSN / dev)
       └── Sentry.init({ release: slug@version, dist: web|…, beforeSend, sendClientReports: false, … })

src/context/AuthContext.tsx
  └── setUserContext(session.user.id)   — pseudonym, bei Session-Wechsel

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
  └── logger.fatal('AppErrorBoundary', msg, { error, componentStack, boundary })
       (genau EIN Sentry-Event pro Render-Crash; Logger-Forwarder routet
        wegen `error: error` automatisch in captureException)

src/components/PackageImportPane.tsx
  └── breadcrumbs: analyze_start | drift_block | drift_override | commit_start | commit_persist_image_issues | commit_fail

src/services/finalizePendingInviteOrClaim.ts
  └── captureMessage: model_claim_fatal:* | invite_accept_fatal:*
```

Alle Wrapper sind **fail-closed**: wenn Sentry nicht initialisiert ist,
laufen die Aufrufer einfach durch — die App wird nie blockiert oder gebrochen.
