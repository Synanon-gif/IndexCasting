-- =============================================================================
-- Diagnose: Recruiting-RPCs (Supabase SQL Editor)
-- =============================================================================
--
-- WICHTIG – häufiger Fehler 42601:
--   Niemals nur einen Funktionsnamen wie get_my_agency_member_role ausführen.
--   Immer den kompletten Block ab "-- BLOCK 1" bis zum Semikolon markieren und RUN.
-- =============================================================================

-- ========== BLOCK 0 – Spalten auf recruiting_chat_threads (Voraussetzung für RPC) ==========
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'recruiting_chat_threads'
ORDER BY ordinal_position;
-- Erwartung u. a.: agency_id, organization_id, created_by (sonst migration_recruiting_thread_agency.sql
-- bzw. migration_organizations_invitations_rls.sql nachziehen)

-- ========== BLOCK 1 – komplett auswählen und einmal ausführen ==========
-- Zeigt, ob die drei Funktionen in der Datenbank existieren:
SELECT
  proname AS function_name,
  pg_get_function_identity_arguments(p.oid) AS arguments
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'public'
WHERE proname IN (
  'get_my_agency_member_role',
  'agency_can_manage_recruiting_for_agency',
  'agency_start_recruiting_chat'
)
ORDER BY proname;

-- Erwartung: 3 Zeilen. Fehlt get_my_agency_member_role → zuerst
-- migration_organizations_invitations_rls.sql (Abschnitt get_my_agency_member_role)
-- in derselben Datenbank ausführen, danach migration_agency_start_recruiting_chat_rpc.sql

-- ========== BLOCK 2 – komplett auswählen und ausführen ==========
SELECT
  has_function_privilege(
    'authenticated',
    'public.agency_start_recruiting_chat(uuid,uuid,text)',
    'EXECUTE'
  ) AS authenticated_can_run_agency_start_recruiting_chat,
  has_function_privilege(
    'authenticated',
    'public.agency_can_manage_recruiting_for_agency(uuid)',
    'EXECUTE'
  ) AS authenticated_can_run_can_manage;

-- Erwartung: beide Spalten = true (t)

-- ========== BLOCK 3 – optional, nach Deploy der Funktionen ==========
NOTIFY pgrst, 'reload schema';

-- ========== BLOCK 4 – optional: nur prüfen, ob can_manage ohne Crash läuft ==========
-- (Ergebnis false ist ok, weil im SQL-Editor kein JWT / auth.uid() gesetzt ist)
SELECT public.agency_can_manage_recruiting_for_agency('00000000-0000-0000-0000-000000000000'::uuid)
  AS can_manage_dummy_agency;
