# EAS (Expo Application Services) — Anbindung

Dieses Projekt nutzt **EAS Build** und optional **EAS Submit** für native iOS-/Android-Builds. Web-Deployments laufen weiter über **Vercel** (`npm run build:web` / CI).

## Voraussetzungen

- Konto auf [expo.dev](https://expo.dev) (kostenloser Plan reicht für den Einstieg)
- Node 20+ (siehe `package.json` → `engines`)
- `eas-cli` ist als **devDependency** installiert (`npx eas` bzw. `npm run eas`)

## Einmalig: Projekt verbinden

Im Projektroot:

```bash
npx eas login
npx eas init
```

`eas init` legt bzw. verknüpft das EAS-Projekt und trägt die **Project ID** in `app.json` unter `expo.extra.eas.projectId` ein. `app.config.js` liest dieselbe ID (bzw. `EAS_PROJECT_ID` aus der Umgebung) und reicht sie an die App weiter.

Falls `app.json` noch `projectId: ""` enthält, ist kein echter Build möglich — zuerst `eas init` ausführen.

## Bundle-IDs (anpassen bei Bedarf)

Standard in `app.json` (für TestFlight/Play Store einheitlich wählbar):

| Plattform | Feld              | Wert                 |
| --------- | ----------------- | -------------------- |
| iOS       | `bundleIdentifier` | `com.indexcasting.app` |
| Android   | `package`         | `com.indexcasting.app` |

Wenn du eigene App-Store-Einträge hast, ersetze diese Strings **bevor** du die erste Store-Registrierung machst. Danach nur noch mit Vorsicht ändern.

**Deep Link / URL Scheme:** `indexcasting` (`expo.scheme` in `app.json`).

## Build-Profile (`eas.json`)

| Profile         | Typische Nutzung                                      | `EXPO_PUBLIC_APP_ENV` |
| --------------- | ----------------------------------------------------- | --------------------- |
| `development`   | iOS-Simulator, interne APK, Entwicklungs-Env          | `development`         |
| `preview`       | interne Tester (Ad-hoc/Internal)                      | `preview`             |
| `production`    | App Store / Play Store (`autoIncrement` für Versionen) | `production`          |

- **`development`** erbt von **`preview`**, setzt iOS **Simulator** und Android **APK**.
- **Sentry:** In `development` sendet die App **keine** Sentry-Events (siehe `src/observability/sentry.ts`); `preview`/`production` passen zu den Profilen.

## Umgebungsvariablen für EAS-Builds

`EXPO_PUBLIC_*` muss **beim Build** in den JavaScript-Bundle (Metro) einfließen. Setze sie im [Expo Dashboard](https://expo.dev) unter **Project → Environment variables** oder per CLI, z. B.:

- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_ANON_KEY` (bzw. Publishable Key je nach Setup)
- optional `EXPO_PUBLIC_SENTRY_DSN`, `EXPO_PUBLIC_APP_URL`, …

`EXPO_PUBLIC_APP_ENV` wird durch die **Build-Profile** in `eas.json` gesetzt und sollte **nicht** widersprüchlich überschrieben werden, außer du weißt genau, was du tust (z. B. Sentry-Tests auf Gerät).

Lokal kannst du zusätzlich `.env.local` nutzen; für **Remote-Builds** zählen primär EAS-Variablen bzw. Secrets.

## Typische Befehle

```bash
npm run eas:whoami
npm run eas:build:preview:ios
npm run eas:build:preview:android
npm run eas:build:production:ios
npm run eas:build:production:android
```

Store-Upload (nach erfolgreichem Build und konfigurierten Credentials):

```bash
npm run eas:submit:ios
npm run eas:submit:android
```

## Optional: EAS Update (OTA)

Für **Over-the-Air-Updates** (ohne App-Store-Review) brauchst du `expo-updates` und ggf. `channel`-Einträge in `eas.json` — **aktuell nicht vorkonfiguriert**. Wenn du das brauchst, in einem separaten Schritt `npx expo install expo-updates` und die Expo-Doku zu EAS Update befolgen.

## Referenzen

- [EAS Build – Expo-Doku](https://docs.expo.dev/build/introduction/)
- [EAS Submit](https://docs.expo.dev/submit/introduction/)
- Sentry/Env-Abstimmung: [docs/SENTRY_INTEGRATION.md](./SENTRY_INTEGRATION.md)
