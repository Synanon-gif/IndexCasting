-- =============================================================================
-- RLS Open-Policy Audit – Security Audit (H-3)
--
-- Führe dieses Skript im Supabase SQL-Editor (oder psql) aus, um zu prüfen,
-- ob kritische Tabellen noch immer die historisch offenen USING (true) /
-- WITH CHECK (true) Policies haben.
--
-- Erwartetes Ergebnis: Keine Zeilen (alle offenen Policies wurden durch spätere
-- Migrationen ersetzt / eingeschränkt).
--
-- Falls Zeilen zurückgegeben werden, müssen die entsprechenden DROP POLICY
-- Statements ausgeführt und die restriktiveren Policies angewandt werden.
-- =============================================================================

-- 1. Alle Policies mit USING (true) auf kritischen Tabellen
SELECT
  schemaname,
  tablename,
  policyname,
  cmd,
  qual AS using_expression,
  with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN (
    'calendar_entries',
    'bookings',
    'verifications',
    'model_applications',
    'bookers',
    'agency_invitations',
    'option_documents',
    'model_agency_territories',
    'agency_connections',
    'profiles'
  )
  AND (
    qual = 'true'
    OR with_check = 'true'
  )
ORDER BY tablename, policyname;

-- 2. Alle Policies auf 'profiles' (Übersicht)
SELECT
  policyname,
  cmd,
  roles,
  qual AS using_expression,
  with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'profiles'
ORDER BY policyname;

-- 3. RLS aktiviert?
SELECT
  relname AS tablename,
  relrowsecurity AS rls_enabled,
  relforcerowsecurity AS rls_forced
FROM pg_class
WHERE relnamespace = 'public'::regnamespace
  AND relkind = 'r'
  AND relname IN (
    'calendar_entries', 'bookings', 'verifications',
    'model_applications', 'bookers', 'agency_invitations',
    'option_documents', 'model_agency_territories', 'profiles'
  )
ORDER BY relname;
