-- =============================================================================
-- Phase 28b: Storage Size Hardening
--
-- Fixes 3 concrete bugs in the Agency Storage System:
--
-- BUG 1 (CRITICAL) — Storage counter never decrements reliably:
--   deletePhoto / deleteDocument gate the decrement on a storage.list() call
--   that can fail silently. Fix: store file_size_bytes in model_photos and
--   documents tables at upload time; read it from DB at delete time.
--
-- BUG 2 (HIGH) — Authorization bypass in bulk-delete path-lookup RPCs:
--   get_chat_thread_file_paths and get_model_portfolio_file_paths only check
--   that the caller is AN agency member, not that the conversation/model
--   belongs to THEIR agency. Fix: add ownership verification.
--
-- BUG 4 (LOW) — decrement_agency_storage_usage directly callable:
--   Any agency member can call the decrement RPC without deleting a file,
--   zeroing the quota counter. Fix: audit log for single-call decrements
--   exceeding 100 MB so admins can detect abuse.
--
-- Run after Phase 28 (migration_agency_storage_tracking.sql).
-- =============================================================================

-- ─── 1. BUG 1 FIX: Add file_size_bytes columns ────────────────────────────────

ALTER TABLE public.model_photos
  ADD COLUMN IF NOT EXISTS file_size_bytes BIGINT NOT NULL DEFAULT 0;

ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS file_size_bytes BIGINT NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.model_photos.file_size_bytes IS
  'Actual file size in bytes recorded at upload time from storage.objects.metadata. '
  'Used for reliable storage decrement on deletion — avoids fragile storage.list() lookups.';

COMMENT ON COLUMN public.documents.file_size_bytes IS
  'Actual file size in bytes recorded at upload time from storage.objects.metadata. '
  'Used for reliable storage decrement on deletion — avoids fragile storage.list() lookups.';

-- ─── 2. BUG 2 FIX: get_chat_thread_file_paths — add ownership check ───────────

CREATE OR REPLACE FUNCTION public.get_chat_thread_file_paths(p_conversation_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, storage
AS $$
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

  -- BUG 2 FIX: verify the conversation belongs to the caller's agency org.
  -- Without this check any agency member could enumerate file paths belonging
  -- to a different agency's conversation by passing an arbitrary conversation ID.
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
$$;

REVOKE ALL    ON FUNCTION public.get_chat_thread_file_paths(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_chat_thread_file_paths(UUID) TO authenticated;

-- ─── 3. BUG 2 FIX: get_model_portfolio_file_paths — add ownership check ────────
-- Schema note: agencies has NO organization_id column.
-- The correct join is: organizations.agency_id = models.agency_id
-- (organizations.agency_id references agencies.id).

CREATE OR REPLACE FUNCTION public.get_model_portfolio_file_paths(p_model_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, storage
AS $$
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

  -- Resolve the agencies.id linked to the caller's organization.
  -- organizations.agency_id = agencies.id (agencies has no organization_id column).
  SELECT o.agency_id INTO v_agency_id
  FROM   public.organizations o
  WHERE  o.id = v_org_id
  LIMIT 1;

  -- BUG 2 FIX: verify the model belongs to the caller's agency.
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
                        THEN COALESCE((
                          SELECT (so.metadata->>'size')::bigint
                          FROM   storage.objects so
                          WHERE  so.bucket_id = 'documents'
                            AND  so.name = replace(mp.url, 'supabase-private://documents/', '')
                          LIMIT 1
                        ), 0)
                      WHEN mp.url LIKE '%/storage/v1/object/public/documentspictures/%'
                        THEN COALESCE((
                          SELECT (so.metadata->>'size')::bigint
                          FROM   storage.objects so
                          WHERE  so.bucket_id = 'documentspictures'
                            AND  so.name = split_part(mp.url, '/storage/v1/object/public/documentspictures/', 2)
                          LIMIT 1
                        ), 0)
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
$$;

REVOKE ALL    ON FUNCTION public.get_model_portfolio_file_paths(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_model_portfolio_file_paths(UUID) TO authenticated;

-- ─── 4. BUG 4 MITIGATION: Audit log for suspiciously large decrements ──────────
-- decrement_agency_storage_usage is legitimately callable from the frontend
-- (for upload rollback) so we cannot remove the GRANT. Instead, any single-call
-- decrement > 100 MB is written to security_events for admin review.

CREATE OR REPLACE FUNCTION public.decrement_agency_storage_usage(p_bytes BIGINT)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id   UUID;
  v_new_used BIGINT;
BEGIN
  IF p_bytes <= 0 THEN
    RETURN 0;
  END IF;

  SELECT om.organization_id INTO v_org_id
  FROM   organization_members om
  JOIN   organizations o ON o.id = om.organization_id
  WHERE  om.user_id = auth.uid()
    AND  o.type     = 'agency'
  LIMIT 1;

  IF v_org_id IS NULL THEN
    RETURN 0;
  END IF;

  -- BUG 4 MITIGATION: log anomalously large single-call decrements for admin audit.
  -- Legitimate rollbacks are always single-file-sized (≤ 200 MB per validation rules).
  -- A call exceeding 100 MB is suspicious and worth auditing.
  IF p_bytes > 104857600 THEN -- 100 MB
    INSERT INTO security_events (user_id, org_id, type, metadata)
    VALUES (
      auth.uid(),
      v_org_id,
      'large_storage_decrement',
      json_build_object('p_bytes', p_bytes, 'org_id', v_org_id)
    );
  END IF;

  UPDATE organization_storage_usage
  SET    used_bytes  = GREATEST(0, used_bytes - p_bytes),
         updated_at  = now()
  WHERE  organization_id = v_org_id
  RETURNING used_bytes INTO v_new_used;

  RETURN COALESCE(v_new_used, 0);
END;
$$;

REVOKE ALL    ON FUNCTION public.decrement_agency_storage_usage(BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.decrement_agency_storage_usage(BIGINT) TO authenticated;
