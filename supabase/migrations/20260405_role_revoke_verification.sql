-- Role & Admin Hardening: belt-and-suspenders REVOKE + CHECK verification.
-- All statements are idempotent — safe to apply even if already present.

-- Ensure no authenticated user can mutate privileged columns directly.
-- These REVOKEs are no-ops if the privilege was never granted (PostgreSQL is safe here).
REVOKE UPDATE (role) ON public.profiles FROM authenticated;
REVOKE UPDATE (is_admin) ON public.profiles FROM authenticated;
REVOKE UPDATE (is_super_admin) ON public.profiles FROM authenticated;

-- Ensure CHECK constraint exists (creates it only if missing).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name   = 'profiles'
      AND constraint_name = 'chk_profile_role'
      AND constraint_type = 'CHECK'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT chk_profile_role
      CHECK (role IN ('admin', 'model', 'agent', 'client', 'guest'));
  END IF;
END $$;
