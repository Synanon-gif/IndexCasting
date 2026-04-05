-- =============================================================================
-- handle_new_user: capture company_name from user_metadata
-- 2026-04-09
--
-- Problem: handle_new_user never read company_name from raw_user_meta_data.
-- This left profiles.company_name = NULL at user-creation time. Any downstream
-- code (ensure_client_organization, ensure_agency_for_current_agent) that
-- reads profiles.company_name would get NULL and fall back to 'My Organization'
-- / 'Agency' if the subsequent frontend profiles.upsert had not yet committed
-- or had failed silently.
--
-- Fix: add company_name to the INSERT — only for client/agent roles (same guard
-- as the frontend). All other security invariants are unchanged:
--   • allowlist (client/agent/model/guest only)
--   • is_admin always false
--   • ON CONFLICT (id) DO NOTHING (invited users keep their existing row)
-- =============================================================================

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

  INSERT INTO public.profiles
    (id, email, display_name, role, is_active, is_admin, tos_accepted, privacy_accepted, company_name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'display_name', NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
    v_role,
    CASE WHEN v_role = 'model' THEN true ELSE false END,
    false,   -- is_admin is ALWAYS false for new signups — only set via migration/service_role
    false,
    false,
    -- Only capture company_name for B2B roles; strip whitespace and treat empty as NULL.
    CASE WHEN v_role IN ('client', 'agent')
         THEN NULLIF(trim(NEW.raw_user_meta_data->>'company_name'), '')
         ELSE NULL END
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

-- Verification:
-- SELECT company_name FROM profiles WHERE id = '<new_b2b_user_id>';
-- Expected: the value passed as options.data.company_name at signUp.
-- =============================================================================
