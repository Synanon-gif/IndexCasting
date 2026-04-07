# CURSOR_REMEDIATION_SQL_VERIFY.md

Nach Anwendung der Migration `20260426_remediation_three_policies_no_profiles_rls.sql` in der **Live-DB** ausführen.

---

## 1) Die drei Policies ohne `profiles`-Referenz

```sql
SELECT tablename, policyname, cmd,
       (qual IS NOT NULL AND qual::text ILIKE '%profiles%') AS qual_has_profiles,
       (with_check IS NOT NULL AND with_check::text ILIKE '%profiles%') AS check_has_profiles
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('agency_invitations', 'model_photos')
  AND policyname IN (
    'Agents can read own agency invitations',
    'Agents can update own agency invitations',
    'Clients see visible model photos'
  )
ORDER BY tablename, policyname;
```

**Erwartung:** `qual_has_profiles` und `check_has_profiles` für diese Zeilen = `false`.

---

## 2) Kein neues FOR ALL auf Watchlist (Regression)

```sql
SELECT tablename, policyname, cmd
FROM pg_policies
WHERE schemaname = 'public'
  AND cmd = 'ALL'
  AND tablename IN (
    'model_embeddings',
    'model_locations',
    'model_agency_territories',
    'calendar_entries',
    'model_minor_consent'
  )
ORDER BY tablename, policyname;
```

**Erwartung:** 0 Zeilen.

---

## 3) MAT Self-Reference (unchanged)

```sql
SELECT COUNT(*) AS self_ref_hits
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'model_agency_territories'
  AND (
    qual ILIKE '%self_mat%'
    OR qual ILIKE '%from public.model_agency_territories %'
    OR qual ILIKE '%from model_agency_territories %'
  );
```

**Erwartung:** `0`.

---

## 4) Geänderte Policies — kein neues Email-Matching

```sql
SELECT tablename, policyname, cmd
FROM pg_policies
WHERE schemaname = 'public'
  AND qual ILIKE '%email%'
  AND tablename <> 'profiles'
  AND policyname IN (
    'Agents can read own agency invitations',
    'Agents can update own agency invitations',
    'Clients see visible model photos'
  );
```

**Erwartung:** 0 Zeilen.

---

## 5) Smoke: `caller_is_client_org_member` existiert

```sql
SELECT proname, prosecdef, proconfig::text
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND proname = 'caller_is_client_org_member';
```

**Erwartung:** eine Zeile, `prosecdef` true, `proconfig` enthält `row_security=off`.

---

## 6) Optional: verbleibendes `profiles` + `role` in anderen Policies

```sql
SELECT tablename, policyname, cmd
FROM pg_policies
WHERE schemaname = 'public'
  AND qual ILIKE '%profiles%'
  AND qual ILIKE '%.role%'
ORDER BY tablename, policyname;
```

**Erwartung:** u. a. weiterhin `Agents can insert own agency invitations` bis follow-up — dokumentiert als offen.
