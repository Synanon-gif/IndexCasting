-- B2B "Start chat": create (or return) a direct conversation row without relying on client-side INSERT RLS.
-- SECURITY DEFINER + row_security off for the function body so membership checks and INSERT are authoritative.
--
-- Run in Supabase SQL Editor after: organizations, organization_members, conversations (phase5 + connection_messenger_org_scope).

-- One row per b2b context_id (optional but prevents duplicate chats under concurrency).
CREATE UNIQUE INDEX IF NOT EXISTS conversations_b2b_context_id_uq
  ON public.conversations (context_id)
  WHERE context_id IS NOT NULL
    AND context_id LIKE 'b2b:%';

CREATE OR REPLACE FUNCTION public.create_b2b_org_conversation(
  p_context_id text,
  p_client_org_id uuid,
  p_agency_org_id uuid,
  p_participant_ids uuid[],
  p_title text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_existing uuid;
  v_new_id uuid;
  v_parts uuid[] := COALESCE(p_participant_ids, ARRAY[]::uuid[]);
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  IF p_client_org_id IS NULL OR p_agency_org_id IS NULL OR p_context_id IS NULL OR length(trim(p_context_id)) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_params');
  END IF;

  IF p_context_id NOT LIKE 'b2b:%' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_context');
  END IF;

  -- Caller must belong to at least one side of the pair.
  IF NOT EXISTS (
    SELECT 1
    FROM public.organization_members m
    WHERE m.user_id = v_uid
      AND (m.organization_id = p_client_org_id OR m.organization_id = p_agency_org_id)
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_org_member');
  END IF;

  IF NOT (v_uid = ANY (v_parts)) THEN
    v_parts := array_append(v_parts, v_uid);
  END IF;

  SELECT c.id INTO v_existing
  FROM public.conversations c
  WHERE c.type = 'direct'::conversation_type
    AND c.context_id = p_context_id
  LIMIT 1;

  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'conversation_id', v_existing, 'created', false);
  END IF;

  BEGIN
    INSERT INTO public.conversations (
      type,
      context_id,
      participant_ids,
      title,
      created_by,
      client_organization_id,
      agency_organization_id
    ) VALUES (
      'direct'::conversation_type,
      p_context_id,
      v_parts,
      COALESCE(NULLIF(trim(p_title), ''), 'Client ↔ Agency'),
      v_uid,
      p_client_org_id,
      p_agency_org_id
    )
    RETURNING id INTO v_new_id;

    RETURN jsonb_build_object('ok', true, 'conversation_id', v_new_id, 'created', true);
  EXCEPTION
    WHEN unique_violation THEN
      SELECT c.id INTO v_existing
      FROM public.conversations c
      WHERE c.type = 'direct'::conversation_type
        AND c.context_id = p_context_id
      LIMIT 1;
      IF v_existing IS NOT NULL THEN
        RETURN jsonb_build_object('ok', true, 'conversation_id', v_existing, 'created', false);
      END IF;
      RETURN jsonb_build_object('ok', false, 'error', 'unique_violation');
  END;
END;
$$;

ALTER FUNCTION public.create_b2b_org_conversation(text, uuid, uuid, uuid[], text) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.create_b2b_org_conversation(text, uuid, uuid, uuid[], text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_b2b_org_conversation(text, uuid, uuid, uuid[], text) TO authenticated;
