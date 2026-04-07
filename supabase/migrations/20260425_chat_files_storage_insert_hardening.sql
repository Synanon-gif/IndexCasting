-- =============================================================================
-- chat-files storage INSERT hardening (2026-04-25)
--
-- Replaces broad INSERT policies (any authenticated user under chat/ or
-- recruiting/) with a single policy that requires conversation / thread /
-- option-request access via SECURITY DEFINER helper (row_security off).
-- Aligns INSERT with the intent of chat_files_recruiting_select (participant
-- or org-scoped access). Does NOT bind to image_rights_confirmations (still
-- client-enforced before upload).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.storage_can_insert_chat_files_object(
  p_bucket_id text,
  p_name text
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
DECLARE
  parts   text[];
  seg1    text;
  seg2    text;
  v_uuid  uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN false;
  END IF;

  IF p_bucket_id IS DISTINCT FROM 'chat-files'
     OR p_name IS NULL
     OR btrim(p_name) = '' THEN
    RETURN false;
  END IF;

  parts := string_to_array(p_name, '/');
  seg1 := parts[1];
  seg2 := parts[2];

  IF seg1 IS NULL OR seg2 IS NULL OR btrim(seg2) = '' THEN
    RETURN false;
  END IF;

  -- UUID path segments (conversation_id, thread_id, option_request_id)
  BEGIN
    v_uuid := seg2::uuid;
  EXCEPTION
    WHEN invalid_text_representation THEN
      RETURN false;
  END;

  IF seg1 = 'chat' THEN
    RETURN EXISTS (
      SELECT 1
      FROM public.conversations c
      WHERE c.id = v_uuid
        AND (
          auth.uid() = ANY (c.participant_ids)
          OR (
            c.client_organization_id IS NOT NULL
            AND EXISTS (
              SELECT 1
              FROM public.organization_members m
              WHERE m.organization_id = c.client_organization_id
                AND m.user_id = auth.uid()
            )
          )
          OR (
            c.agency_organization_id IS NOT NULL
            AND EXISTS (
              SELECT 1
              FROM public.organization_members m
              WHERE m.organization_id = c.agency_organization_id
                AND m.user_id = auth.uid()
            )
          )
        )
    );

  ELSIF seg1 = 'recruiting' THEN
    RETURN EXISTS (
      SELECT 1
      FROM public.recruiting_chat_threads rt
      JOIN public.organizations o ON o.agency_id = rt.agency_id
      JOIN public.organization_members om ON om.organization_id = o.id
      WHERE rt.id = v_uuid
        AND om.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1
      FROM public.recruiting_chat_threads rt
      JOIN public.model_applications app ON app.id = rt.application_id
      WHERE rt.id = v_uuid
        AND app.applicant_user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1
      FROM public.recruiting_chat_threads rt
      JOIN public.bookers b ON b.agency_id = rt.agency_id
      WHERE rt.id = v_uuid
        AND b.user_id = auth.uid()
    );

  ELSIF seg1 = 'options' THEN
    RETURN public.option_request_visible_to_me(v_uuid);

  ELSE
    RETURN false;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.storage_can_insert_chat_files_object(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.storage_can_insert_chat_files_object(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.storage_can_insert_chat_files_object(text, text) TO service_role;

COMMENT ON FUNCTION public.storage_can_insert_chat_files_object(text, text) IS
  'Storage INSERT guard for chat-files: chat/ = conversation_accessible pattern; '
  'recruiting/ = agency org member, applicant, or legacy booker; options/ = option_request_visible_to_me.';

DROP POLICY IF EXISTS chat_files_recruiting_upload ON storage.objects;
DROP POLICY IF EXISTS chat_files_chat_upload ON storage.objects;

CREATE POLICY chat_files_scoped_insert
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'chat-files'
    AND public.storage_can_insert_chat_files_object(bucket_id, name)
  );
