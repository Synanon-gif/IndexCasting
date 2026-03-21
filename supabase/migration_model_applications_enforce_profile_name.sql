-- Bewerbung: Vor-/Nachname müssen mit profiles.display_name übereinstimmen (wie beim Account).
-- Nach Supabase SQL Editor ausführen.

CREATE OR REPLACE FUNCTION public.model_applications_names_match_profile()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  pname text;
  exp_first text;
  exp_last text;
  sp int;
BEGIN
  IF NEW.applicant_user_id IS NULL THEN
    RAISE EXCEPTION 'applicant_user_id is required';
  END IF;

  SELECT display_name INTO pname FROM public.profiles WHERE id = NEW.applicant_user_id;
  pname := trim(regexp_replace(coalesce(pname, ''), '\s+', ' ', 'g'));

  IF pname = '' THEN
    RAISE EXCEPTION 'profile display_name is required before applying';
  END IF;

  sp := position(' ' in pname);
  IF sp = 0 THEN
    exp_first := pname;
    exp_last := '';
  ELSE
    exp_first := trim(substring(pname from 1 for sp - 1));
    exp_last := trim(substring(pname from sp + 1));
  END IF;

  IF lower(trim(NEW.first_name)) IS DISTINCT FROM lower(exp_first)
     OR lower(trim(coalesce(NEW.last_name, ''))) IS DISTINCT FROM lower(exp_last) THEN
    RAISE EXCEPTION 'application first_name and last_name must match profile display_name';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_model_applications_enforce_profile_name ON public.model_applications;
CREATE TRIGGER tr_model_applications_enforce_profile_name
  BEFORE INSERT OR UPDATE OF first_name, last_name, applicant_user_id
  ON public.model_applications
  FOR EACH ROW
  EXECUTE FUNCTION public.model_applications_names_match_profile();

COMMENT ON FUNCTION public.model_applications_names_match_profile() IS
  'Ensures model_applications first/last name match profiles.display_name for applicant_user_id.';
