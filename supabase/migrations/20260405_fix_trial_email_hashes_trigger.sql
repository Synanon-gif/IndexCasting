-- =============================================================================
-- Fix record_trial_email_hashes(): search_path missing 'extensions'
--
-- The digest() function from pgcrypto lives in the extensions schema.
-- The trigger had SET search_path TO 'public' only, so digest() was not found.
-- Fix: add extensions to search_path.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.record_trial_email_hashes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  IF NEW.trial_ends_at IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.trial_ends_at IS NOT DISTINCT FROM OLD.trial_ends_at THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.used_trial_emails (email_hash, source_org)
  SELECT
    encode(digest(lower(au.email), 'sha256'), 'hex'),
    NEW.organization_id
  FROM public.organization_members om
  JOIN auth.users au ON au.id = om.user_id
  WHERE om.organization_id = NEW.organization_id
    AND au.email IS NOT NULL
  ON CONFLICT (email_hash) DO NOTHING;

  RETURN NEW;
END;
$function$;
