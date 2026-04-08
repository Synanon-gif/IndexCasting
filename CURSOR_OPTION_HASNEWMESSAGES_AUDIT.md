# CURSOR_OPTION_HASNEWMESSAGES_AUDIT.md

## 1. Executive Summary

`hasNewMessages()` prüfte nur `requestsCache.length > 0` und steuerte damit den **Messages-Tab-Punkt** in der Client-Web-App. Das ist **kein** Unread-Mechanismus: Nutzer mit dauerhaft vorhandenen (aber abgeschlossenen) Option-/Casting-Threads sahen den Punkt **ständig** — typisches „Badge lügt“-Verhalten. Es wurde ein **minimaler Fix** umgesetzt: neue, klar benannte Funktion `hasOpenOptionRequestAttention()` mit Predicate über **`toDisplayStatus`** (nur nicht-terminale Zustände: *In negotiation* / *Draft*). Keine DB-, Auth- oder Read-Receipt-Änderungen.

## 2. Aktuelle Semantik von `hasNewMessages()` (historisch)

| Aspekt | Inhalt |
|--------|--------|
| **Technische Prüfung (vor Fix)** | `return requestsCache.length > 0` |
| **Datenquelle** | Nur `requestsCache` im Store [`src/store/optionRequests.ts`](src/store/optionRequests.ts); `messagesCache` wurde **nicht** ausgewertet |
| **Aufrufer** | Ausschließlich [`src/web/ClientWebApp.tsx`](src/web/ClientWebApp.tsx): `useEffect` + `subscribe()` → State `hasNew` → **Dot** auf dem Bottom-Tab „Messages“ |
| **Unread/Read** | Kein `read_at`, kein lokales „last seen“ für Option-Chats in diesem Pfad |

**Nach Fix:** `hasNewMessages` entfernt; ersetzt durch `hasOpenOptionRequestAttention()` und Hilfsfunktion `optionRequestNeedsMessagesTabAttention()` in [`src/utils/optionRequestAttention.ts`](src/utils/optionRequestAttention.ts).

## 3. Nutzererwartung vs. Realität

- **Erwartung:** Ein roter/unaufälliger **Dot** auf „Messages“ wirkt wie **„es gibt etwas Neues / Ungelesenes“** oder zumindest **„Aktion nötig“**.
- **Realität (alt):** **„Mindestens ein Option-Request existiert im Cache“** — inkl. längst abgeschlossener Verhandlungen.
- **UI-Implikation:** Tab heißt „Messages“ und bündelt u. a. B2B-Chats und Option-Threads; der Dot hing **nur** am Option-Store, nicht an B2B — bereits vor dem Fix ein Scope-Thema; der größte klare Fehler war das **permanente** Dot bei nur historischen Threads.

## 4. Bestätigt oder nicht bestätigt

**Bestätigt: `CONFIRMED_BADGE_BEHAVIOR_BUG`** (irreführendes Dauer-Badge bei vorhandenen, aber terminalen Requests).

Nicht als alleiniger Fix adressiert (bewusst klein gehalten): vollständige **Label-Semantik** „Unread“ vs. „Attention“ über alle Surfaces (z. B. Dashboard `unread_threads`); das wäre weiterhin **separate** Produkt-/Architekturabstimmung.

## 5. Kleinster sicherer Fix (umgesetzt)

1. **`optionRequestNeedsMessagesTabAttention`**: nutzt `toDisplayStatus` — Dot nur wenn Display-Status **In negotiation** oder **Draft** (konsistent mit bestehender Status-UX).
2. **`hasOpenOptionRequestAttention`**: `requestsCache.some(optionRequestNeedsMessagesTabAttention)`.
3. **`ClientWebApp`**: Import und `useEffect` auf neue Funktion umgestellt.
4. **Tests**: [`src/utils/__tests__/optionRequestAttention.test.ts`](src/utils/__tests__/optionRequestAttention.test.ts) für das reine Predicate (ohne Store-Mocking).

## 6. Warum Auth / Admin / Login unberührt blieb

Keine Änderungen an `AuthContext`, `App.tsx`, `signIn`, Paywall, RPCs oder RLS. Nur Store-Export, eine neue Util-Datei, ein Screen-Import und Audit-Map-Zeilen für den umbenannten Export.

## 7. Nächste sinnvolle Schritte

- **Kurz:** Dokumentation in älteren CURSOR_OPTION_CASTING_* Dateien verweist noch auf `hasNewMessages` — bei Bedarf verlinken oder einen Satz „ersetzt durch hasOpenOptionRequestAttention“ ergänzen.
- **Größer (nicht jetzt):** echte **Unread**-Semantik für Option-Messages oder **einheitliches** Badge über B2B + Option nur mit Produkt-Spec und ggf. Backend-Feldern.
