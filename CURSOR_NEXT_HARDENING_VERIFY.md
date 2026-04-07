# CURSOR_NEXT_HARDENING_VERIFY

## Regeln / Doku

1. Lesen [docs/LIVE_DB_DRIFT_GUARDRAIL.md](docs/LIVE_DB_DRIFT_GUARDRAIL.md); stichprobenartig eine Root-SQL-Datei mit einer Migration vergleichen — erwarten, dass Live nur durch `migrations/` reproduzierbar ist.

## Upload-Pipeline

1. **Automatisch:** `npm run typecheck && npm run lint && npm test -- --passWithNoTests --ci`.
2. **Manuell (Smoke):** B2B-Messenger: Datei anhängen (JPEG/PNG); optional HEIC nur wenn Produkt unterstützt — bei fehlgeschlagener HEIC-Konvertierung muss Upload **nicht** durchgehen.
3. **Manuell:** Recruiting-Chat-Attachment gleicher Check.
4. **Regression:** Pfad in Storage sollte Weiterhin unter `chat/{conversationId}/` bzw. `recruiting/{threadId}/` liegen; Dateiname nur aus erlaubtem Charset.

## SQL (P3)

Nach Deploy (bereits durchgeführt in dieser Session, erneut bei anderem Projekt möglich):

```sql
SELECT policyname, cmd
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'agency_invitations'
  AND policyname = 'Agents can insert own agency invitations';
-- Erwartung: eine Zeile, cmd = INSERT

SELECT with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'agency_invitations'
  AND policyname = 'Agents can insert own agency invitations';
-- Erwartung: kein Vorkommen von profiles / role = 'agent'
```

## Funktional Agency-Invite

- Als Agency-Booker/Owner: Einladung erzeugen (INSERT auf `agency_invitations`) — muss weiter funktionieren.
- Nicht-Zugehöriger User: INSERT muss weiter von RLS blockiert werden.

## Admin-Login

- Kein Code-Pfad geändert — stichprobenartig Admin-Login nach Deploy (Best Practice).
