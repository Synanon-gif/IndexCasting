-- =============================================================================
-- My Models roster: active contract vs soft-ended (history & stats preserved)
-- Run in Supabase SQL Editor after migration_agency_remove_model_and_admin_purge.sql
-- =============================================================================

ALTER TABLE public.models
  ADD COLUMN IF NOT EXISTS agency_relationship_status TEXT DEFAULT 'active';

ALTER TABLE public.models
  ADD COLUMN IF NOT EXISTS agency_relationship_ended_at TIMESTAMPTZ;

COMMENT ON COLUMN public.models.agency_relationship_status IS 'active = listed under My Models; ended = soft-removed, bookings history kept; pending_link = optional, awaiting model signup';

COMMENT ON COLUMN public.models.agency_relationship_ended_at IS 'When the agency ended representation (soft delete).';

ALTER TABLE public.models
  DROP CONSTRAINT IF EXISTS models_agency_relationship_status_check;

ALTER TABLE public.models
  ADD CONSTRAINT models_agency_relationship_status_check
  CHECK (agency_relationship_status IS NULL OR agency_relationship_status IN ('active', 'pending_link', 'ended'));

-- Legacy rows: treat as active roster
UPDATE public.models
SET agency_relationship_status = 'active'
WHERE agency_id IS NOT NULL
  AND (agency_relationship_status IS NULL OR agency_relationship_status = '');

-- Models unassigned by old RPC (agency_id null): nothing to fix here

-- Soft-end instead of wiping agency_id (keeps referential context for reporting)
CREATE OR REPLACE FUNCTION public.agency_remove_model(
  p_model_id UUID,
  p_agency_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

  UPDATE public.models SET
    agency_relationship_status = 'ended',
    agency_relationship_ended_at = now(),
    is_visible_commercial = false,
    is_visible_fashion = false,
    updated_at = now()
  WHERE id = p_model_id AND agency_id = p_agency_id;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  DELETE FROM public.model_agency_territories WHERE model_id = p_model_id AND agency_id = p_agency_id;
  RETURN true;
END;
$$;

COMMENT ON FUNCTION public.agency_remove_model(UUID, UUID) IS 'Soft-ends agency representation: model hidden from My Models and client discovery; historical option_requests unchanged.';

-- Agency attaches an existing app user (model role) to a roster row (e.g. after API import + model signup)
CREATE OR REPLACE FUNCTION public.agency_link_model_to_user(
  p_model_id UUID,
  p_agency_id UUID,
  p_email TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  can_act BOOLEAN;
  target_user UUID;
  rrole TEXT;
BEGIN
  IF p_email IS NULL OR trim(p_email) = '' THEN
    RETURN false;
  END IF;

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

  SELECT id INTO target_user
  FROM auth.users
  WHERE LOWER(TRIM(email)) = LOWER(TRIM(p_email))
  LIMIT 1;

  IF target_user IS NULL THEN
    RETURN false;
  END IF;

  SELECT role::text INTO rrole FROM public.profiles WHERE id = target_user;
  IF rrole IS DISTINCT FROM 'model' THEN
    RETURN false;
  END IF;

  UPDATE public.models
  SET
    user_id = target_user,
    agency_relationship_status = 'active',
    agency_relationship_ended_at = NULL,
    updated_at = now()
  WHERE id = p_model_id
    AND agency_id = p_agency_id
    AND agency_relationship_status IS DISTINCT FROM 'ended';

  RETURN FOUND;
END;
$$;

GRANT EXECUTE ON FUNCTION public.agency_link_model_to_user(UUID, UUID, TEXT) TO authenticated;
