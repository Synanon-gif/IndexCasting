-- Atomically create/link recruiting_chat_threads and model_applications.recruiting_thread_id
-- so agency bookers are not blocked by RLS on SELECT-after-INSERT or split client round-trips.
-- Run in Supabase SQL Editor after organizations + model_applications exist.
--
-- Voraussetzung: recruiting_chat_threads hat Spalten agency_id, organization_id, created_by:
--   - migration_recruiting_thread_agency.sql (agency_id)
--   - migration_organizations_invitations_rls.sql (organization_id, created_by auf recruiting_chat_threads)
--
-- Nach dem Anlegen: Supabase Dashboard → Database → Functions → „Expose via API“ prüfen
-- (sonst meldet PostgREST PGRST202). Bei Schema-Cache: SQL „NOTIFY pgrst, 'reload schema';“
-- oder API neu starten / kurz warten.

-- Same access as UI (get_my_agency_member_role) + legacy agency master (profile email = agencies.email).
CREATE OR REPLACE FUNCTION public.agency_can_manage_recruiting_for_agency(p_agency_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.get_my_agency_member_role(p_agency_id)
  )
  OR EXISTS (
    SELECT 1
    FROM public.agencies a
    JOIN public.profiles p ON p.id = auth.uid()
    WHERE a.id = p_agency_id
      AND trim(lower(COALESCE(p.role::text, ''))) = 'agent'
      AND lower(trim(COALESCE(p.email, ''))) = lower(trim(COALESCE(a.email, '')))
  );
$$;

REVOKE ALL ON FUNCTION public.agency_can_manage_recruiting_for_agency(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.agency_can_manage_recruiting_for_agency(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.agency_start_recruiting_chat(
  p_application_id uuid,
  p_agency_id uuid,
  p_model_name text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  app public.model_applications%ROWTYPE;
  tid uuid;
  v_org uuid;
  v_name text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF NOT public.agency_can_manage_recruiting_for_agency(p_agency_id) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT * INTO app FROM public.model_applications WHERE id = p_application_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'application not found';
  END IF;

  IF app.agency_id IS NOT NULL AND app.agency_id IS DISTINCT FROM p_agency_id THEN
    RAISE EXCEPTION 'wrong agency for application';
  END IF;

  IF app.status IS DISTINCT FROM 'pending' THEN
    RAISE EXCEPTION 'application not pending';
  END IF;

  v_name := trim(COALESCE(p_model_name, ''));
  IF v_name = '' THEN
    v_name := trim(COALESCE(app.first_name, '') || ' ' || COALESCE(app.last_name, ''));
  END IF;
  IF v_name = '' THEN
    v_name := 'Model';
  END IF;

  IF app.recruiting_thread_id IS NOT NULL THEN
    tid := app.recruiting_thread_id;
    UPDATE public.recruiting_chat_threads
    SET agency_id = COALESCE(agency_id, p_agency_id)
    WHERE id = tid;
    RETURN tid;
  END IF;

  SELECT t.id INTO tid
  FROM public.recruiting_chat_threads t
  WHERE t.application_id = p_application_id
  ORDER BY t.created_at DESC
  LIMIT 1;

  IF tid IS NOT NULL THEN
    UPDATE public.model_applications
    SET recruiting_thread_id = tid
    WHERE id = p_application_id AND status = 'pending';
    UPDATE public.recruiting_chat_threads
    SET
      agency_id = COALESCE(agency_id, p_agency_id),
      created_by = COALESCE(created_by, auth.uid())
    WHERE id = tid;
    RETURN tid;
  END IF;

  SELECT o.id INTO v_org
  FROM public.organizations o
  WHERE o.agency_id = p_agency_id
  LIMIT 1;

  INSERT INTO public.recruiting_chat_threads (
    application_id,
    model_name,
    agency_id,
    organization_id,
    created_by
  )
  VALUES (
    p_application_id,
    v_name,
    p_agency_id,
    v_org,
    auth.uid()
  )
  RETURNING id INTO tid;

  UPDATE public.model_applications
  SET recruiting_thread_id = tid
  WHERE id = p_application_id AND status = 'pending';

  IF NOT EXISTS (
    SELECT 1 FROM public.model_applications
    WHERE id = p_application_id AND recruiting_thread_id = tid
  ) THEN
    RAISE EXCEPTION 'failed to link recruiting thread to application';
  END IF;

  RETURN tid;
END;
$$;

REVOKE ALL ON FUNCTION public.agency_start_recruiting_chat(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.agency_start_recruiting_chat(uuid, uuid, text) TO authenticated;

COMMENT ON FUNCTION public.agency_start_recruiting_chat(uuid, uuid, text) IS
  'Agency members: create or reuse recruiting thread and set model_applications.recruiting_thread_id (bypasses client RLS edge cases).';
