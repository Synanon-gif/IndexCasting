-- =============================================================================
-- SECDEF mini-wave: storage path listing RPCs — SET row_security TO off
-- Date: 2026-04-08
--
-- Context (live pg_proc): both functions were SECURITY DEFINER with only
-- search_path set. They read organization_members, conversations/messages or
-- models/model_photos and storage.objects under explicit caller guards.
--
-- Per rls-security-patterns Risiko 4 / system-invariants Rule 21: SECDEF that
-- reads RLS-protected tables should use SET row_security TO off; internal
-- guards (auth.uid(), org/conversation/model ownership) remain the auth layer.
--
-- NOT touched: admin RPCs, assert_is_admin, get_my_org_context, auth triggers.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_chat_thread_file_paths(p_conversation_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'storage'
 SET row_security TO off
AS $function$
DECLARE
  v_org_id   UUID;
  v_result   JSON;
BEGIN
  SELECT om.organization_id INTO v_org_id
  FROM   public.organization_members om
  JOIN   public.organizations o ON o.id = om.organization_id
  WHERE  om.user_id = auth.uid()
    AND  o.type     = 'agency'
  LIMIT 1;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'get_chat_thread_file_paths: unauthorized';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.conversations c
    WHERE  c.id = p_conversation_id
      AND  c.agency_organization_id = v_org_id
  ) THEN
    RAISE EXCEPTION 'get_chat_thread_file_paths: conversation does not belong to your organization';
  END IF;

  SELECT json_agg(
    json_build_object(
      'file_url',   m.file_url,
      'path',       CASE
                      WHEN m.file_url LIKE '%/storage/v1/object/public/chat-files/%'
                        THEN split_part(m.file_url, '/storage/v1/object/public/chat-files/', 2)
                      WHEN m.file_url LIKE '%/storage/v1/object/sign/chat-files/%'
                        THEN regexp_replace(
                               split_part(m.file_url, '/storage/v1/object/sign/chat-files/', 2),
                               '\?.*$', ''
                             )
                      ELSE m.file_url
                    END,
      'size_bytes', COALESCE((
                      SELECT (so.metadata->>'size')::bigint
                      FROM   storage.objects so
                      WHERE  so.bucket_id = 'chat-files'
                        AND  so.name = CASE
                                         WHEN m.file_url LIKE '%/storage/v1/object/public/chat-files/%'
                                           THEN split_part(m.file_url, '/storage/v1/object/public/chat-files/', 2)
                                         WHEN m.file_url LIKE '%/storage/v1/object/sign/chat-files/%'
                                           THEN regexp_replace(
                                                  split_part(m.file_url, '/storage/v1/object/sign/chat-files/', 2),
                                                  '\?.*$', ''
                                                )
                                         ELSE m.file_url
                                       END
                      LIMIT 1
                    ), 0)
    )
  ) INTO v_result
  FROM   public.messages m
  WHERE  m.conversation_id = p_conversation_id
    AND  m.file_url IS NOT NULL;

  RETURN COALESCE(v_result, '[]'::json);
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_model_portfolio_file_paths(p_model_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'storage'
 SET row_security TO off
AS $function$
DECLARE
  v_org_id    UUID;
  v_agency_id UUID;
  v_result    JSON;
BEGIN
  SELECT om.organization_id INTO v_org_id
  FROM   public.organization_members om
  JOIN   public.organizations o ON o.id = om.organization_id
  WHERE  om.user_id = auth.uid()
    AND  o.type     = 'agency'
  LIMIT 1;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'get_model_portfolio_file_paths: unauthorized';
  END IF;

  SELECT o.agency_id INTO v_agency_id
  FROM   public.organizations o
  WHERE  o.id = v_org_id
  LIMIT 1;

  IF v_agency_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.models m
    WHERE  m.id        = p_model_id
      AND  m.agency_id = v_agency_id
  ) THEN
    RAISE EXCEPTION 'get_model_portfolio_file_paths: model does not belong to your organization';
  END IF;

  SELECT json_agg(
    json_build_object(
      'photo_id',   mp.id,
      'url',        mp.url,
      'bucket',     CASE
                      WHEN mp.url LIKE 'supabase-private://documents/%' THEN 'documents'
                      ELSE 'documentspictures'
                    END,
      'path',       CASE
                      WHEN mp.url LIKE 'supabase-private://documents/%'
                        THEN replace(mp.url, 'supabase-private://documents/', '')
                      WHEN mp.url LIKE '%/storage/v1/object/public/documentspictures/%'
                        THEN split_part(mp.url, '/storage/v1/object/public/documentspictures/', 2)
                      ELSE NULL
                    END,
      'size_bytes', CASE
                      WHEN mp.url LIKE 'supabase-private://documents/%'
                        THEN COALESCE(
                          NULLIF(mp.file_size_bytes, 0),
                          (SELECT (so.metadata->>'size')::bigint
                           FROM   storage.objects so
                           WHERE  so.bucket_id = 'documents'
                             AND  so.name = replace(mp.url, 'supabase-private://documents/', '')
                           LIMIT 1),
                          0
                        )
                      WHEN mp.url LIKE '%/storage/v1/object/public/documentspictures/%'
                        THEN COALESCE(
                          NULLIF(mp.file_size_bytes, 0),
                          (SELECT (so.metadata->>'size')::bigint
                           FROM   storage.objects so
                           WHERE  so.bucket_id = 'documentspictures'
                             AND  so.name = split_part(mp.url, '/storage/v1/object/public/documentspictures/', 2)
                           LIMIT 1),
                          0
                        )
                      ELSE 0
                    END
    )
  ) INTO v_result
  FROM   public.model_photos mp
  WHERE  mp.model_id = p_model_id
    AND  (
      mp.url LIKE 'supabase-private://documents/%'
      OR mp.url LIKE '%/storage/v1/object/public/documentspictures/%'
      OR mp.url LIKE '%/storage/v1/object/sign/%'
    );

  RETURN COALESCE(v_result, '[]'::json);
END;
$function$;

COMMENT ON FUNCTION public.get_chat_thread_file_paths(uuid) IS
  'Agency-scoped chat file path listing. SECURITY DEFINER + row_security=off; '
  'guards: agency org membership + conversation.agency_organization_id match. '
  'Updated 20260408: add row_security=off for stable reads under PG15+ RLS.';

COMMENT ON FUNCTION public.get_model_portfolio_file_paths(uuid) IS
  'Agency-scoped portfolio/doc path listing for storage metrics. SECURITY DEFINER + row_security=off; '
  'guards: agency org + model.agency_id match. '
  'Updated 20260408: add row_security=off for stable reads under PG15+ RLS.';

-- Verification
DO $$
BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_chat_thread_file_paths'
      AND p.prosecdef = true
      AND 'row_security=off' = ANY (p.proconfig)
  ), 'get_chat_thread_file_paths must have row_security=off in proconfig';

  ASSERT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_model_portfolio_file_paths'
      AND p.prosecdef = true
      AND 'row_security=off' = ANY (p.proconfig)
  ), 'get_model_portfolio_file_paths must have row_security=off in proconfig';

  RAISE NOTICE '20260408_secdef_row_security_storage_path_helpers: OK';
END $$;
