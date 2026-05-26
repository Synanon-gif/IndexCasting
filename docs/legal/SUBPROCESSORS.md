# Unterauftragsverarbeiterliste — Index Casting

Stand: 26. Mai 2026

Verantwortlicher: Ruben Helge, Einzelunternehmen, Betreiber der Plattform „Index Casting“

Diese Liste ergänzt das Verzeichnis von Verarbeitungstätigkeiten und die TOMs. Sie ist aktuell zu halten, insbesondere bei Einführung neuer Dienstleister.

## Aktuelle Unterauftragsverarbeiter

### 1. Supabase

Zweck: Authentifizierung, Datenbank, Storage, Realtime, Edge Functions

Daten: Plattformdaten, Accountdaten, Nachrichten, Dateien, technische Daten

### 2. Stripe

Zweck: Zahlungsabwicklung, Rechnungen, Abonnementstatus

Daten: Zahlungs-/Rechnungsdaten, Kontaktdaten, Transaktionsdaten

### 3. Vercel (Hosting / Deployment)

Zweck: Hosting und Auslieferung der Web-App (Expo-Web-Export; `vercel.json` im Repository)

Daten: technische Zugriffsdaten, IP-Adressen, Logdaten

**[TODO — produktiv bestätigen:** Im Code/Repo ist Vercel als Hosting-Ziel konfiguriert (`vercel.json`, Build → `dist`). Ob die Live-Domain `index-casting.com` aktuell über Vercel ausgeliefert wird, ist aus dem Repository allein nicht zweifelsfrei — bitte im Vercel-Dashboard / DNS final bestätigen.]

### 4. Resend (transaktionaler E-Mail-Versand)

Zweck: Versand von Einladungen, transaktionalen E-Mails, Rechnungs-E-Mails und Benachrichtigungen über Supabase Edge Functions (u. a. `send-invite`, `send-invoice-via-email`, `send-agency-share-invite`; Secret `RESEND_API_KEY`)

Daten: E-Mail-Adresse, Name, Einladungstokens, Kommunikationsmetadaten, Rechnungsmetadaten

**Hinweis:** Transaktionaler Versand läuft technisch über die Resend-API — nicht über ein SMTP-Postfach.

### 5. Proton Mail (geschäftliches Kontakt-Postfach)

Zweck: Betreiber-Kontakt und geschäftliche E-Mail-Kommunikation (z. B. `ruben@index-casting.com`)

Daten: Kontakt- und Support-Korrespondenz, soweit außerhalb der automatisierten Resend-Flows

**Hinweis:** Proton Mail ist im Code **nicht** als programmatischer Versand-API-Anbieter angebunden; transaktionale System-Mails laufen über Resend (siehe oben).

### 6. Sentry (Fehlerdiagnose)

Zweck: Fehlerdiagnose, Stabilität, technische Sicherheit (Integration `@sentry/react-native`; Env `EXPO_PUBLIC_SENTRY_DSN`)

Daten: technische Fehlerdaten, Geräte-/Browserinformationen, ggf. pseudonyme Nutzerkennung (PII-reduziert per Code-Konfiguration)

**[TODO — produktiv bestätigen:** Sentry ist im Code integriert, initialisiert sich aber nur, wenn `EXPO_PUBLIC_APP_ENV` nicht `development` ist **und** `EXPO_PUBLIC_SENTRY_DSN` gesetzt ist. Bitte prüfen, ob der DSN in Production/Preview (z. B. Vercel/EAS) tatsächlich konfiguriert ist.]

### 7. Mistral AI (optionaler AI Help Assistant)

Zweck: Beantwortung von Produkt-Hilfe-Anfragen über die Edge Function `ai-assistant` (La Plateforme API; Secret `MISTRAL_API_KEY`; Modell `mistral-small-latest`)

Daten: vom Nutzer eingegebene Fragen, minimierte Fakten je Rolle, technische Metadaten — nur nach In-App-Einwilligung; keine vollständigen Chat-/Billing-Exporte

**[TODO — produktiv bestätigen:** Feature ist im Code vorhanden, aber ohne gesetztes `MISTRAL_API_KEY` nicht verfügbar. Bitte prüfen, ob der Key in Supabase Secrets gesetzt ist und das Feature produktiv freigegeben ist.]

## Hinweise

- Die englische Trust-Center-Übersicht unter `/trust/subprocessors` beschreibt dieselben Kategorien für internationale Kunden und RFPs.
- Drittlandtransfers sind möglich bei Einsatz internationaler Dienstleister; Absicherung durch Standardvertragsklauseln, Angemessenheitsbeschluss oder zusätzliche Maßnahmen, soweit erforderlich.
- Änderungen an dieser Liste werden anlassbezogen dokumentiert und bei wesentlichen Änderungen den betroffenen Auftraggebern mitgeteilt, soweit vertraglich vorgesehen.
