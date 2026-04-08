# Security Audit A — Verifikation (manuell + SQL)

Alle Checks gegen **Production** (oder Staging mit gleichem RLS-Stand). Credentials nur aus `.env.supabase`, nicht committen.

---

## 1. `calendar_entries` RLS (Pflicht)

```sql
SELECT policyname, cmd,
       length(coalesce(qual::text, '')) AS qual_len,
       left(qual::text, 120) AS qual_head
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'calendar_entries'
ORDER BY cmd, policyname;
```

**Erwartung:**

- Es existiert `calendar_entries_select_scoped` mit **keinem** bloßen `true` als gesamte USING-Bedingung.
- Es gibt **keine** Policy `calendar_entries_select_authenticated` mit `USING (true)` (oder vergleichbares Open-Read).

**Zusatz nach Fix (Client-Update):**

- Mindestens eine UPDATE-Policy, die **Client-Org-Zugriff** bei nicht-rejected `option_requests` erlaubt (siehe DIFF_PLAN P0).

---

## 2. Offene SELECT-Policies (Regression-Check)

```sql
SELECT tablename, policyname
FROM pg_policies
WHERE schemaname = 'public'
  AND cmd = 'SELECT'
  AND qual IS NOT NULL
  AND trim(qual::text) = 'true'
  AND tablename IN ('calendar_entries', 'models', 'option_requests', 'profiles');
```

**Erwartung:** Keine überraschenden Zeilen auf produktkritischen Tabellen (leer oder bewusst dokumentierte Ausnahmen).

---

## 3. Option Requests Sichtbarkeit

```sql
SELECT policyname, cmd
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'option_requests'
ORDER BY cmd, policyname;
```

**Erwartung:** SELECT/UPDATE nutzen `option_request_visible_to_me` oder explizite org-scoped Branches; keine `profiles.is_admin = true`-Subqueries (Projektregel).

---

## 4. Funktionen Booking / Option

```sql
SELECT proname
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND proname IN (
    'fn_ensure_calendar_on_option_confirmed',
    'option_request_visible_to_me'
  );
```

**Erwartung:** Beide existieren.

Optional:

```sql
SELECT pg_get_functiondef('public.option_request_visible_to_me(uuid)'::regprocedure);
```

**Prüfen:** Kein Gate über `client_assignment_flags` / Assignment als Zugriffsbedingung.

---

## 5. UI / End-to-End

| Schritt | Rolle | Aktion | Erwartung |
|--------|--------|--------|-----------|
| 5a | Client | Option nicht `rejected`, Kalender/Brief öffnen, „Save“ Booking Brief | HTTP 200 auf `PATCH`/`UPDATE` `calendar_entries` (nach Fix P0); vor Fix: ggf. 401/RLS-Fehler dokumentieren |
| 5b | Agency | Gleiche Option, Brief speichern | Erfolg |
| 5c | Model | Eigenes Profil, Kalender mit Eintrag | Model-Self-Update weiterhin ok |
| 5d | Client | Sichtbares Portfolio-Foto | Signed URL lädt; `model-private-photos` für Client **kein** Zugriff |
| 5e | Neu | Invite-Link + separat Model-Claim in Storage | Nach Invite-Abschluss zweiter Login/Effect: Claim läuft |

---

## 6. Recruiting (Stichprobe)

```sql
SELECT tablename, policyname, cmd
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('recruiting_chat_threads', 'recruiting_chat_messages')
ORDER BY tablename, cmd;
```

**Erwartung:** Policies vorhanden; keine Email-Match-Zweige (laut Migration `20260405_security_three_dangers_fix.sql`).

---

## 7. Nach neuer Migration (Governance)

- `npm run typecheck && npm run lint && npm test` (bei TS-Änderungen).
- Management-API Query erneut wie in Abschnitt 1; Diff zu vorherigem Export archivieren.
