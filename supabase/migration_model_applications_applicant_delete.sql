-- Models: eigene Bewerbungen löschen (nur pending/rejected), abgestimmt mit deleteApplication() im Client
ALTER TABLE public.model_applications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Applicants delete own pending or rejected applications" ON public.model_applications;
CREATE POLICY "Applicants delete own pending or rejected applications"
  ON public.model_applications FOR DELETE
  TO authenticated
  USING (
    applicant_user_id = auth.uid()
    AND status IN ('pending', 'rejected')
  );
