-- ============================================================================
-- handle_new_user: sanitize role — reject admin/superadmin via signup
-- 2026-04-06
--
-- Problem: handle_new_user reads role from raw_user_meta_data without
-- validation. Anyone who calls supabase.auth.signUp() with { data: { role: 'admin' } }
-- gets a profile with role='admin'. With the frontend routing fallback
-- (profile?.role === 'admin') this would show the AdminDashboard UI.
-- Even though server-side RPCs are UUID+email-pinned (no real data leaks),
-- the UI exposure is unacceptable.
--
-- Fix: allowlist — only 'client', 'agent', 'model', 'guest' are valid signup
-- roles. Any other value (including 'admin', 'super_admin', 'root', etc.)
-- falls back to 'client'.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_raw_role text;
  v_role     text;
BEGIN
  v_raw_role := NEW.raw_user_meta_data->>'role';

  -- Allowlist: only known safe signup roles are accepted.
  -- 'admin' and any unknown value fall back to 'client'.
  v_role := CASE
    WHEN v_raw_role IN ('client', 'agent', 'model', 'guest') THEN v_raw_role
    ELSE 'client'
  END;

  INSERT INTO public.profiles (id, email, display_name, role, is_active, is_admin, tos_accepted, privacy_accepted)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'display_name', NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
    v_role,
    CASE WHEN v_role = 'model' THEN true ELSE false END,
    false,   -- is_admin is ALWAYS false for new signups — only set via migration/service_role
    false,
    false
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

-- Verification:
-- Attempt signUp with role='admin' → profile.role should be 'client', is_admin=false
-- ============================================================================
