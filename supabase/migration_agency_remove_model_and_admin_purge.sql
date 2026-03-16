-- =============================================================================
-- 1) Agency can remove a model: dissolve connection (agency_id nullable)
-- 2) Admin can purge user data (call before auth.admin.deleteUser in Edge Function)
-- =============================================================================

-- 1. Allow models to be unassigned from an agency (agency_id nullable)
ALTER TABLE public.models ALTER COLUMN agency_id DROP NOT NULL;

-- 2. Admin purge: delete all public data for a user (profile + CASCADE).
--    Call this from an Edge Function that then calls auth.admin.deleteUser(target_id).
--    Only admins can call this.
CREATE OR REPLACE FUNCTION public.admin_purge_user_data(target_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  caller_is_admin BOOLEAN;
BEGIN
  SELECT is_admin INTO caller_is_admin FROM public.profiles WHERE id = auth.uid();
  IF NOT COALESCE(caller_is_admin, false) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  DELETE FROM public.profiles WHERE id = target_id;
  INSERT INTO public.admin_logs (admin_id, action, target_user_id, details)
  VALUES (auth.uid(), 'admin_purge_user_data', target_id, '{}');
  RETURN true;
END;
$$;

COMMENT ON FUNCTION public.admin_purge_user_data(UUID) IS 'Admin only. Deletes profile (CASCADE removes related rows). Call auth.admin.deleteUser(target_id) from Edge Function to complete account deletion.';

-- 3. Agency can remove a model (unassign: set agency_id null, remove territories)
CREATE OR REPLACE FUNCTION public.agency_remove_model(
  p_model_id UUID,
  p_agency_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  can_act BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.bookers b WHERE b.user_id = auth.uid() AND b.agency_id = p_agency_id
  ) OR EXISTS (
    SELECT 1 FROM public.agencies a
    JOIN public.profiles p ON p.id = auth.uid() AND p.role = 'agent' AND LOWER(TRIM(p.email)) = LOWER(TRIM(a.email))
    WHERE a.id = p_agency_id
  ) INTO can_act;
  IF NOT can_act THEN
    RAISE EXCEPTION 'Not authorized for this agency';
  END IF;
  UPDATE public.models SET agency_id = NULL WHERE id = p_model_id AND agency_id = p_agency_id;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  DELETE FROM public.model_agency_territories WHERE model_id = p_model_id AND agency_id = p_agency_id;
  RETURN true;
END;
$$;
