-- ============================================================================
-- 20260612_profiles_insert_policy.sql
-- Fix PROBLEM C: Profile upsert fails during signup (42501)
--
-- Root cause: The INSERT policy "Users can insert own profile" on public.profiles
-- existed only in schema.sql (deprecated) and root migration_guest_user_flow.sql
-- (not under migrations/). Without it, the client-side upsert in signUp() fails
-- with RLS violation when handle_new_user trigger hasn't committed yet.
-- ============================================================================

DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;

CREATE POLICY "Users can insert own profile"
  ON public.profiles FOR INSERT TO authenticated
  WITH CHECK (id = auth.uid());

COMMENT ON POLICY "Users can insert own profile" ON public.profiles IS
  '20260612: Canonical INSERT policy for profiles. Allows authenticated users '
  'to insert their own profile row (id must match auth.uid()). Required for the '
  'signUp() upsert in AuthContext — the handle_new_user trigger may not have '
  'committed before the client-side upsert runs.';
