# CURSOR_OPTION_HASNEWMESSAGES_VERIFY.md

## Badge- / Hinweis-Semantik passt zur Logik

- [x] Tab-Dot erscheint nur, wenn mindestens ein Eintrag in `requestsCache` **nicht-terminal** per `toDisplayStatus` ist (*In negotiation* oder *Draft*).
- [x] Abgeschlossene / abgelehnte Threads (*Confirmed* / *Rejected* laut `toDisplayStatus`) triggern **keinen** Dot mehr allein durch „Cache nicht leer“.

## Keine Änderung an Business-Statuslogik (Server / DB)

- [x] Keine Migrationen, keine RPC-/RLS-Änderungen.
- [x] Keine Änderung an `final_status` / `model_approval` Serverpfaden — nur Leselogik im Client für ein UI-Badge.

## Keine Änderung an Auth / Admin / Login / Paywall

- [x] `AuthContext.tsx`, `App.tsx`, `signIn`, `bootstrapThenLoadProfile`, `loadProfile` unberührt.
- [x] Paywall-Kern unberührt.

## typecheck / lint / tests

Ausgeführt im Repo-Root:

```bash
npm run typecheck && npm run lint && npm test -- --passWithNoTests --ci
```

- [x] Exit code 0 (alle grün).
