-- Workflow Audit Fixes 2026-04
-- Enthält M-1, M-2, M-3, M-4, M-6 aus dem End-to-End-Audit.

-- ============================================================
-- M-1: Unique Index auf calendar_entries.option_request_id
-- Verhindert doppelte Kalendereinträge für dieselbe Option bei parallelen Aufrufen.
-- ============================================================
CREATE UNIQUE INDEX IF NOT EXISTS uidx_calendar_entries_option_request
  ON public.calendar_entries (option_request_id)
  WHERE option_request_id IS NOT NULL;


-- ============================================================
-- M-2: DB-Trigger — Kalendereintrag bei Client-Acceptance via counter
-- Die App-Funktion clientAcceptCounterPrice (Client-Session) kann wegen RLS
-- keinen calendar_entries-Insert durchführen (INSERT nur für Agency-Mitglieder).
-- Dieser Trigger läuft SECURITY DEFINER-äquivalent als DB-Trigger und legt
-- den Eintrag an, wenn final_status → option_confirmed wechselt.
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_ensure_calendar_on_option_confirmed()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only fire when final_status transitions TO option_confirmed (any path)
  IF (OLD.final_status IS DISTINCT FROM 'option_confirmed')
     AND NEW.final_status = 'option_confirmed'
     AND NEW.model_id IS NOT NULL
  THEN
    -- Insert calendar_entry only if none exists for this option_request_id yet
    INSERT INTO calendar_entries (
      model_id,
      date,
      start_time,
      end_time,
      client_name,
      option_request_id,
      entry_type,
      created_by_agency,
      booking_details
    )
    SELECT
      NEW.model_id,
      NEW.requested_date::date,
      NEW.start_time,
      NEW.end_time,
      NEW.client_name,
      NEW.id,
      CASE
        WHEN NEW.request_type = 'casting' THEN 'casting'
        ELSE 'option'
      END,
      false,
      '{}'::jsonb
    WHERE NOT EXISTS (
      SELECT 1 FROM calendar_entries
       WHERE option_request_id = NEW.id
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ensure_calendar_on_option_confirmed ON public.option_requests;
CREATE TRIGGER trg_ensure_calendar_on_option_confirmed
  AFTER UPDATE ON public.option_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_ensure_calendar_on_option_confirmed();


-- ============================================================
-- M-3: link_model_by_email — Status auf 'active' setzen
-- Die bisherige RPC hat nur user_id gesetzt, aber agency_relationship_status
-- blieb auf 'pending_link'. UI zeigte Modelle dauerhaft als „Pending".
-- ============================================================
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
     SET user_id                   = auth.uid(),
         agency_relationship_status = 'active',
         updated_at                = now()
   WHERE trim(LOWER(email)) = trim(LOWER(u_email))
     AND user_id IS NULL;

  UPDATE public.profiles SET is_active = true WHERE id = auth.uid();
END;
$$;


-- ============================================================
-- M-4: RLS UPDATE-Policy für Models — Model kann eigenes Profil bearbeiten
-- Bisher gab es nur "Agency owner or member can update model" und admin_update_model_all.
-- Models können ihren eigenen Eintrag (location, etc.) nicht speichern.
-- ============================================================
DROP POLICY IF EXISTS "model_update_own_profile" ON public.models;
CREATE POLICY "model_update_own_profile"
  ON public.models
  FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (
    -- Models dürfen nur ihre eigenen Profil-Felder ändern, nicht agency_id, user_id, etc.
    user_id = auth.uid()
  );


-- ============================================================
-- M-6: DB-Trigger Guard — confirmed → rejected blockieren
-- Der bestehende Trigger fn_validate_option_status_transition blockiert
-- rejected→* und confirmed→in_negotiation, aber nicht confirmed→rejected.
-- Bereits bestätigte Buchungen sollen nicht manuell storniert werden können.
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_validate_option_status_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Terminal states: rejected rows cannot be changed
  IF OLD.status = 'rejected' AND NEW.status <> OLD.status THEN
    RAISE EXCEPTION 'Cannot transition from terminal state rejected (option_request %)', OLD.id;
  END IF;

  -- confirmed → in_negotiation is not allowed (no un-confirming)
  IF OLD.status = 'confirmed' AND NEW.status = 'in_negotiation' THEN
    RAISE EXCEPTION 'Cannot revert confirmed booking to in_negotiation (option_request %)', OLD.id;
  END IF;

  -- confirmed → rejected is not allowed (bookings cannot be arbitrarily cancelled via status)
  IF OLD.status = 'confirmed' AND NEW.status = 'rejected' THEN
    RAISE EXCEPTION 'Cannot reject an already confirmed booking (option_request %)', OLD.id;
  END IF;

  -- final_status: job_confirmed is terminal
  IF OLD.final_status = 'job_confirmed' AND NEW.final_status <> OLD.final_status THEN
    RAISE EXCEPTION 'Cannot change final_status after job_confirmed (option_request %)', OLD.id;
  END IF;

  -- final_status: option_confirmed → option_pending is not allowed
  IF OLD.final_status = 'option_confirmed' AND NEW.final_status = 'option_pending' THEN
    RAISE EXCEPTION 'Cannot revert option_confirmed to option_pending (option_request %)', OLD.id;
  END IF;

  RETURN NEW;
END;
$$;

-- Re-attach the trigger (replaces the function body in-place)
DROP TRIGGER IF EXISTS trg_validate_option_status ON public.option_requests;
CREATE TRIGGER trg_validate_option_status
  BEFORE UPDATE ON public.option_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_validate_option_status_transition();
