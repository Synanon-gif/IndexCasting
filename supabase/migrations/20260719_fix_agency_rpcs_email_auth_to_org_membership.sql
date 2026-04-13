-- P1 RISKY: Replace email-based authorization with org-membership model
-- in agency_link_model_to_user and agency_remove_model.
--
-- Problem: Both functions authorize via profiles.email = agencies.email
-- (Gefahr 2 / Risiko 9 family). Email can change, collide, or drift —
-- violates the org-membership model used everywhere else.
--
-- Fix: Replace email branch with organization_members + organizations
-- check (covers owner + booker); keep legacy bookers fallback.
-- Also add SET row_security TO off (SECDEF reads RLS-protected tables).

-- ── agency_link_model_to_user ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.agency_link_model_to_user(p_model_id uuid, p_agency_id uuid, p_email text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET row_security TO off
AS $function$
DECLARE
  can_act BOOLEAN;
  target_user UUID;
  rrole TEXT;
BEGIN
  IF p_email IS NULL OR trim(p_email) = '' THEN
    RETURN false;
  END IF;

  -- Authorization: org-membership (owner + booker) OR legacy bookers table
  SELECT EXISTS (
    SELECT 1 FROM public.organization_members om
    JOIN public.organizations o ON o.id = om.organization_id
    WHERE om.user_id = auth.uid()
      AND o.type = 'agency'
      AND o.agency_id = p_agency_id
  ) OR EXISTS (
    SELECT 1 FROM public.bookers b WHERE b.user_id = auth.uid() AND b.agency_id = p_agency_id
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
$function$;

-- ── agency_remove_model ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.agency_remove_model(p_model_id uuid, p_agency_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET row_security TO off
AS $function$
DECLARE
  can_act BOOLEAN;
BEGIN
  -- Authorization: org-membership (owner + booker) OR legacy bookers table
  SELECT EXISTS (
    SELECT 1 FROM public.organization_members om
    JOIN public.organizations o ON o.id = om.organization_id
    WHERE om.user_id = auth.uid()
      AND o.type = 'agency'
      AND o.agency_id = p_agency_id
  ) OR EXISTS (
    SELECT 1 FROM public.bookers b WHERE b.user_id = auth.uid() AND b.agency_id = p_agency_id
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
$function$;
