-- Migration: pending_territories auf model_applications
--
-- HINTERGRUND (CRIT-R1):
--   acceptApplication() gibt immer modelId: null zurück, weil das Model noch nicht bestätigt hat.
--   Territorien, die die Agency beim Accept-Schritt wählt, wurden bisher nie persistiert.
--
-- LÖSUNG:
--   1. pending_territories JSONB-Spalte auf model_applications, befüllt beim Agency-Accept.
--   2. Beim Model-Confirm (confirmApplicationByModel) werden die gespeicherten Territorien
--      automatisch auf den neu angelegten Model-Eintrag übertragen (Trigger).

-- ─── Spalte ──────────────────────────────────────────────────────────────────

ALTER TABLE public.model_applications
  ADD COLUMN IF NOT EXISTS pending_territories jsonb DEFAULT NULL;

COMMENT ON COLUMN public.model_applications.pending_territories IS
  'Territory codes (array of ISO-3166-1 alpha-2 strings) chosen by the agency at accept-time. '
  'Persisted here and transferred to model_agency_territories when the model confirms.';

-- ─── Trigger: Territorien übertragen nach Model-Bestätigung ──────────────────

CREATE OR REPLACE FUNCTION public.fn_transfer_pending_territories()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_territory_code text;
  v_model_id       uuid;
  v_agency_id      uuid;
BEGIN
  -- Nur feuern wenn status zu 'accepted' wechselt und pending_territories gesetzt ist
  IF NEW.status <> 'accepted' THEN
    RETURN NEW;
  END IF;
  IF OLD.status = 'accepted' THEN
    RETURN NEW;
  END IF;
  IF NEW.pending_territories IS NULL OR jsonb_array_length(NEW.pending_territories) = 0 THEN
    RETURN NEW;
  END IF;

  -- Model-Eintrag finden, der durch confirmApplicationByModel → create_model_from_accepted_application
  -- für diesen Applicant + Agency angelegt wurde.
  SELECT m.id, m.agency_id INTO v_model_id, v_agency_id
  FROM public.models m
  WHERE m.user_id  = NEW.applicant_user_id
    AND m.agency_id = NEW.accepted_by_agency_id
  ORDER BY m.created_at DESC
  LIMIT 1;

  IF v_model_id IS NULL THEN
    -- Model noch nicht angelegt (Timing) — die Applikationslogik ruft den Transfer
    -- ggf. über den Service-Layer nach; kein Hard-Error hier.
    RETURN NEW;
  END IF;

  -- Upsert je Territory-Code
  FOR v_territory_code IN
    SELECT jsonb_array_elements_text(NEW.pending_territories)
  LOOP
    INSERT INTO public.model_agency_territories (model_id, agency_id, country_code)
    VALUES (v_model_id, v_agency_id, v_territory_code)
    ON CONFLICT (model_id, agency_id, country_code) DO NOTHING;
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_transfer_pending_territories ON public.model_applications;

CREATE TRIGGER tr_transfer_pending_territories
  AFTER UPDATE OF status ON public.model_applications
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_transfer_pending_territories();

COMMENT ON TRIGGER tr_transfer_pending_territories ON public.model_applications IS
  'Transfers agency-chosen territories to model_agency_territories when the model confirms (status → accepted).';
