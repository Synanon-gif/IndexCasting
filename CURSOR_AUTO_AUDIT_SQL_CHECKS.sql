-- =============================================================================
-- CURSOR_AUTO_AUDIT_SQL_CHECKS.sql
-- Manually runnable verification queries (Supabase SQL Editor or psql).
-- Generated as part of static repo audit — not executed by the audit runner.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- A) FOR ALL on watchlist tables (expect 0 rows on healthy DB)
-- -----------------------------------------------------------------------------
SELECT tablename, policyname, cmd, roles::text
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

-- Admin-only FOR ALL elsewhere is intentional; model_claim_tokens admin policy:
SELECT tablename, policyname, cmd
FROM pg_policies
WHERE schemaname = 'public'
  AND cmd = 'ALL'
ORDER BY tablename, policyname;

-- -----------------------------------------------------------------------------
-- B) profiles.is_admin / profiles.role in policy quals (expect 0 for is_admin)
-- -----------------------------------------------------------------------------
SELECT tablename, policyname, cmd, LEFT(qual, 400) AS qual_snip
FROM pg_policies
WHERE schemaname = 'public'
  AND (
    qual ILIKE '%is_admin = true%'
    OR qual ILIKE '%is_admin=true%'
    OR (qual ILIKE '%profiles%' AND qual ILIKE '%.role%')
  )
ORDER BY tablename, policyname;

-- -----------------------------------------------------------------------------
-- C) model_agency_territories — self-reference / self_mat anti-regression
-- -----------------------------------------------------------------------------
SELECT policyname, cmd, LEFT(qual, 500) AS qual_snip
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'model_agency_territories'
  AND (
    qual ILIKE '%self_mat%'
    OR qual ILIKE '%from public.model_agency_territories %'
    OR qual ILIKE '%from model_agency_territories %'
  );

-- -----------------------------------------------------------------------------
-- D) Email-based matching in policies (manual triage — not all hits are bad)
-- -----------------------------------------------------------------------------
SELECT tablename, policyname, cmd
FROM pg_policies
WHERE schemaname = 'public'
  AND qual ILIKE '%email%'
  AND tablename <> 'profiles'
ORDER BY tablename, policyname;

-- -----------------------------------------------------------------------------
-- E) SECURITY DEFINER functions + proconfig (row_security=off presence)
-- -----------------------------------------------------------------------------
SELECT p.proname AS function_name,
       pg_get_function_identity_arguments(p.oid) AS args,
       p.prosecdef AS security_definer,
       p.proconfig AS config
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public'
  AND p.prokind = 'f'
  AND p.prosecdef = true
ORDER BY p.proname;

-- SECDEF without row_security in proconfig (review each — some may not need it)
SELECT p.proname,
       pg_get_function_identity_arguments(p.oid) AS args,
       p.proconfig
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public'
  AND p.prokind = 'f'
  AND p.prosecdef = true
  AND (
    p.proconfig IS NULL
    OR NOT EXISTS (
      SELECT 1 FROM unnest(p.proconfig) c WHERE c::text ILIKE '%row_security%'
    )
  )
ORDER BY p.proname;

-- -----------------------------------------------------------------------------
-- F) Duplicate function OIDs / overloads (sanity — use pg_proc count by name)
-- -----------------------------------------------------------------------------
SELECT proname, COUNT(*) AS overload_count
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public' AND p.prokind = 'f'
GROUP BY proname
HAVING COUNT(*) > 1
ORDER BY overload_count DESC, proname;

-- -----------------------------------------------------------------------------
-- G) Territory / location constraints (canonical names)
-- -----------------------------------------------------------------------------
SELECT con.conname, con.contype AS type, rel.relname AS table_name,
       pg_get_constraintdef(con.oid) AS definition
FROM pg_constraint con
JOIN pg_class rel ON rel.oid = con.conrelid
JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
WHERE nsp.nspname = 'public'
  AND rel.relname IN ('model_agency_territories', 'model_locations')
ORDER BY rel.relname, con.conname;

-- Expect model_locations: UNIQUE (model_id, source) — not UNIQUE(model_id) alone
SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'public.model_locations'::regclass
  AND contype IN ('u', 'p');

-- -----------------------------------------------------------------------------
-- H) Admin helper / pin — existence check
-- -----------------------------------------------------------------------------
SELECT proname
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public'
  AND proname IN (
    'assert_is_admin',
    'is_current_user_admin',
    'get_own_admin_flags',
    'is_current_user_super_admin',
    'log_failed_admin_attempt'
  )
ORDER BY proname;

-- -----------------------------------------------------------------------------
-- I) Storage policies (documentspictures / chat) — no direct models JOIN in policy text
-- -----------------------------------------------------------------------------
SELECT schemaname, tablename, policyname, cmd,
       LEFT(COALESCE(qual, '') || COALESCE(with_check, ''), 300) AS snip
FROM pg_policies
WHERE schemaname = 'storage'
ORDER BY tablename, policyname;

-- -----------------------------------------------------------------------------
-- J) Trigger inventory (public)
-- -----------------------------------------------------------------------------
SELECT c.relname AS table_name, t.tgname AS trigger_name,
       LEFT(pg_get_triggerdef(t.oid), 200) AS def_snip
FROM pg_trigger t
JOIN pg_class c ON t.tgrelid = c.oid
JOIN pg_namespace n ON c.relnamespace = n.oid
WHERE n.nspname = 'public' AND NOT t.tgisinternal
ORDER BY c.relname, t.tgname;

-- -----------------------------------------------------------------------------
-- K) RPC list (all public functions)
-- -----------------------------------------------------------------------------
SELECT p.proname AS function_name,
       pg_get_function_identity_arguments(p.oid) AS args,
       p.prosecdef AS security_definer
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public' AND p.prokind = 'f'
ORDER BY p.proname;
