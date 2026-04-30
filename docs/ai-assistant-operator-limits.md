# AI Help Assistant — operative Limits und Usage-Telemetrie

Für Operators/Supabase-Admins: Anpassung der **persistierten** AI-Assistant-Limits und Auswertung von **Nutzerzählungen** — ohne Prompt- oder Antwort-Inhalte zu speichern.

## Warnung zu personenbezogenen / sensiblen Daten

Die Tabelle `ai_assistant_usage_events` speichert absichtlich **keine** vollständigen Nutzerprompts oder Assistentenantworten.

- **Keine** eigenen Migrationen ergänzen, die `prompt`, `answer`, `message_body`, Tokens mit Klartext, Chatlogs o. Ä. hinzufügen.
- Fehler-/Debug-Logs in Edge oder App dürfen **keine** vollständigen Nutzerfragen oder generierten Antworten persistieren oder in Dritt-Tools ohne Freigabe spiegeln.

## Limits pro Organisation überschreiben

Die Tabelle `public.ai_assistant_limits` enthält optional pro `organization_id` Grenzwerte (`user_hour_limit`, `user_day_limit`, `org_day_limit`). Fehlt eine Zeile, verwendet die Funktion konservative Defaults (siehe Migration `ai_assistant_persistent_rate_limits` / Folgemigrationen).

**Beispiel:** Org `ORG_UUID` höhere Tagesgrenzen geben:

```sql
INSERT INTO public.ai_assistant_limits (organization_id, user_hour_limit, user_day_limit, org_day_limit)
VALUES ('ORG_UUID'::uuid, 30, 120, 400)
ON CONFLICT (organization_id) DO UPDATE SET
  user_hour_limit = EXCLUDED.user_hour_limit,
  user_day_limit = EXCLUDED.user_day_limit,
  org_day_limit = EXCLUDED.org_day_limit,
  updated_at = now();
```

Administration nur mit passenden DB-Rollen außerhalb der normalen App-Authenticated-Session ausführen; die App hat **kein** DELETE/INSERT auf diese Tabelle unter `authenticated` (SECURITY DEFINER-RPCs sind die Schnittstelle).

## Usage-Events inspizieren

**Beispiel:** letzte Events einer Organisation:

```sql
SELECT id, created_at, user_id, organization_id, viewer_role, intent, result,
       estimated_input_chars, estimated_output_chars, duration_ms,
       provider, model, error_category
FROM public.ai_assistant_usage_events
WHERE organization_id = 'ORG_UUID'::uuid
ORDER BY created_at DESC
LIMIT 200;
```

Counts pro Intent/Result (Rolling-Fenster der RPCs entspricht 1 h / 1 Tag — für Ad-hoc-Reports):

```sql
SELECT intent, result, date_trunc('day', created_at) AS day, count(*) AS n
FROM public.ai_assistant_usage_events
WHERE created_at >= now() - interval '14 days'
GROUP BY 1, 2, 3
ORDER BY day DESC, n DESC;
```

## Diagnose: Limiter-RPC

Die Edge ruft **`ai_assistant_check_rate_limit(p_request_id, p_viewer_role, p_intent, p_organization_id, p_estimated_input_chars)`** mit dem User-JWT auf. Typische Fehlercodes in der Nachricht:

- `org_context_missing` / `org_context_ambiguous` — Nutzer passt nicht zum erwarteten eindeutigen Agency/Client-Kontext (oder Bucher/Employee-Rollen-Filter).
- `org_context_mismatch` — übergebene `p_organization_id` stimmt nicht mit der aus `organization_members` abgeleiteten Org überein (Spoof-Schutz).

`GRANT EXECUTE` nur an `authenticated`; kein `anon`. Kein `service_role` aus der Assistant-Edge.
