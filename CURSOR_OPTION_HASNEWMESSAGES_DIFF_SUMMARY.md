# CURSOR_OPTION_HASNEWMESSAGES_DIFF_SUMMARY.md

## Geänderte Dateien

| Datei | Zweck |
|-------|--------|
| [`src/utils/optionRequestAttention.ts`](src/utils/optionRequestAttention.ts) | Neues, testbares Predicate: Tab-Attention nur bei nicht-terminalen Option-States (via `toDisplayStatus`). |
| [`src/store/optionRequests.ts`](src/store/optionRequests.ts) | `hasNewMessages` entfernt; `hasOpenOptionRequestAttention()` exportiert. |
| [`src/web/ClientWebApp.tsx`](src/web/ClientWebApp.tsx) | Messages-Tab-Dot nutzt `hasOpenOptionRequestAttention`. |
| [`src/utils/__tests__/optionRequestAttention.test.ts`](src/utils/__tests__/optionRequestAttention.test.ts) | Unit-Tests für das Predicate. |
| [`docs/AUDIT_EXPORT_MAP.json`](docs/AUDIT_EXPORT_MAP.json) | Export-Name / Import-Spiegel aktualisiert. |

## Risiko

**Niedrig:** Rein clientseitige Badge-Logik; gleiche Terminal-Definition wie bestehende Status-Badges (`toDisplayStatus`). Keine Schreibpfade oder Auth.

**Bekanntes Restrisiko:** Der Dot spiegelt weiterhin **nicht** B2B-Chat-Unread und **kein** echtes Message-Read — bewusst out-of-scope.

## Testbezug

- `npm test` — neuer Test `optionRequestAttention.test.ts`.
- Gesamtlauf: `typecheck`, `lint`, `test` grün (siehe VERIFY).
