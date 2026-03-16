-- Apply as Model: Bewerber mit Account verknüpfen; Agentur-Model per E-Mail verknüpfen
-- 1. model_applications: Wer hat sich beworben (für "My Applications" und Zuordnung bei Accept)
ALTER TABLE public.model_applications
  ADD COLUMN IF NOT EXISTS applicant_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_model_applications_applicant ON public.model_applications(applicant_user_id);

-- 2. models: E-Mail des Models (von Agentur gesetzt); Model kann sich mit dieser E-Mail registrieren und wird zugeordnet
ALTER TABLE public.models
  ADD COLUMN IF NOT EXISTS email TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_models_email_unique ON public.models(email) WHERE email IS NOT NULL;

-- 3. Bei Accept: Model-Eintrag aus Bewerbung anlegen (per RPC oder App-Code)
-- RLS für model_applications: Models dürfen eigene Bewerbungen lesen (applicant_user_id = auth.uid())
DROP POLICY IF EXISTS "Models can read own applications" ON public.model_applications;
CREATE POLICY "Models can read own applications"
  ON public.model_applications FOR SELECT TO authenticated
  USING (applicant_user_id = auth.uid());

-- Apply nur noch mit Account: Anon-Insert entfernen, nur eingeloggte Models dürfen bewerben
DROP POLICY IF EXISTS "Anon can insert applications" ON public.model_applications;
DROP POLICY IF EXISTS "Models can insert own application" ON public.model_applications;
CREATE POLICY "Models can insert own application"
  ON public.model_applications FOR INSERT TO authenticated
  WITH CHECK (applicant_user_id = auth.uid());

-- 4. RPC: Model-Account mit E-Mail verknüpfen (wenn Agentur Model mit E-Mail angelegt hat)
CREATE OR REPLACE FUNCTION public.link_model_by_email()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  u_email text;
BEGIN
  SELECT email INTO u_email FROM auth.users WHERE id = auth.uid();
  IF u_email IS NULL OR trim(u_email) = '' THEN RETURN; END IF;

  UPDATE public.models
  SET user_id = auth.uid(), updated_at = now()
  WHERE trim(LOWER(email)) = trim(LOWER(u_email)) AND user_id IS NULL;

  UPDATE public.profiles SET is_active = true WHERE id = auth.uid();
END;
$$;
