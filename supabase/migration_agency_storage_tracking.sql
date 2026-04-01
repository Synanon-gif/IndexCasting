-- =============================================================================
-- Phase 28: Agency Storage Tracking
--
-- Creates organization_storage_usage table with RLS.
-- Adds SECURITY DEFINER RPCs for atomic storage tracking and admin control.
-- Adds trigger to auto-create a storage row for every new agency organization.
-- Backfills existing agency organizations with default (0 bytes) row.
--
-- Run after Phase 27 (migration_fix_option_requests_org_id_comment.sql).
--
-- Storage limit: 5 GB per agency organization.
-- Applies ONLY to agency organizations — clients and models are unrestricted.
-- =============================================================================

-- ─── 1. Table ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.organization_storage_usage (
  organization_id  UUID        PRIMARY KEY
                                 REFERENCES public.organizations(id) ON DELETE CASCADE,
  used_bytes       BIGINT      NOT NULL DEFAULT 0
                                 CHECK (used_bytes >= 0),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── 2. RLS ───────────────────────────────────────────────────────────────────

ALTER TABLE public.organization_storage_usage ENABLE ROW LEVEL SECURITY;

-- Agency members can read their own storage row.
DROP POLICY IF EXISTS "agency_members_select_own_storage" ON public.organization_storage_usage;
CREATE POLICY "agency_members_select_own_storage"
  ON public.organization_storage_usage
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.organization_members om
      WHERE om.organization_id = organization_storage_usage.organization_id
        AND om.user_id = auth.uid()
    )
  );

-- Admins have full access. Normal users never INSERT/UPDATE/DELETE directly.
DROP POLICY IF EXISTS "admin_full_access_storage_usage" ON public.organization_storage_usage;
CREATE POLICY "admin_full_access_storage_usage"
  ON public.organization_storage_usage
  FOR ALL
  TO authenticated
  USING     (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = TRUE))
  WITH CHECK(EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = TRUE));

-- ─── 3. Constant: 5 GB in bytes ───────────────────────────────────────────────

-- 5 * 1024 * 1024 * 1024 = 5368709120
-- Referenced in all storage RPCs via this expression directly.

-- ─── 4. RPC: get_my_agency_storage_usage ──────────────────────────────────────
-- Returns current storage snapshot for the caller's agency organization.
-- Auto-creates a row if none exists yet (e.g. legacy orgs before trigger).
-- Returns null when the caller is not a member of an agency organization.

CREATE OR REPLACE FUNCTION public.get_my_agency_storage_usage()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id    UUID;
  v_used      BIGINT;
  v_limit     BIGINT := 5368709120; -- 5 GB
BEGIN
  SELECT om.organization_id INTO v_org_id
  FROM   organization_members om
  JOIN   organizations o ON o.id = om.organization_id
  WHERE  om.user_id = auth.uid()
    AND  o.type     = 'agency'
  LIMIT 1;

  IF v_org_id IS NULL THEN
    RETURN json_build_object('error', 'No agency organization found for current user');
  END IF;

  INSERT INTO organization_storage_usage (organization_id, used_bytes)
  VALUES (v_org_id, 0)
  ON CONFLICT (organization_id) DO NOTHING;

  SELECT used_bytes INTO v_used
  FROM   organization_storage_usage
  WHERE  organization_id = v_org_id;

  RETURN json_build_object(
    'organization_id', v_org_id,
    'used_bytes',      COALESCE(v_used, 0),
    'limit_bytes',     v_limit
  );
END;
$$;

REVOKE ALL    ON FUNCTION public.get_my_agency_storage_usage() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_agency_storage_usage() TO authenticated;

-- ─── 5. RPC: increment_agency_storage_usage ───────────────────────────────────
-- Pre-checks the 5 GB limit and, if allowed, atomically increments used_bytes.
-- Uses FOR UPDATE to prevent race conditions on concurrent uploads.
-- Returns { allowed, used_bytes, limit_bytes, error? }.

CREATE OR REPLACE FUNCTION public.increment_agency_storage_usage(p_bytes BIGINT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id  UUID;
  v_row     organization_storage_usage%ROWTYPE;
  v_limit   BIGINT := 5368709120; -- 5 GB
BEGIN
  IF p_bytes <= 0 THEN
    RETURN json_build_object('allowed', false, 'error', 'File size must be greater than 0');
  END IF;

  SELECT om.organization_id INTO v_org_id
  FROM   organization_members om
  JOIN   organizations o ON o.id = om.organization_id
  WHERE  om.user_id = auth.uid()
    AND  o.type     = 'agency'
  LIMIT 1;

  IF v_org_id IS NULL THEN
    -- Not an agency user — allow the upload (clients/models are unrestricted).
    RETURN json_build_object('allowed', true, 'used_bytes', 0, 'limit_bytes', v_limit);
  END IF;

  -- Lock the row to prevent concurrent increments.
  SELECT * INTO v_row
  FROM   organization_storage_usage
  WHERE  organization_id = v_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO organization_storage_usage (organization_id, used_bytes)
    VALUES (v_org_id, 0)
    ON CONFLICT (organization_id) DO NOTHING;
    SELECT * INTO v_row
    FROM   organization_storage_usage
    WHERE  organization_id = v_org_id
    FOR UPDATE;
  END IF;

  -- Block if limit would be exceeded.
  IF (v_row.used_bytes + p_bytes) > v_limit THEN
    RETURN json_build_object(
      'allowed',    false,
      'used_bytes', v_row.used_bytes,
      'limit_bytes', v_limit
    );
  END IF;

  -- Increment atomically.
  UPDATE organization_storage_usage
  SET    used_bytes  = used_bytes + p_bytes,
         updated_at  = now()
  WHERE  organization_id = v_org_id;

  RETURN json_build_object(
    'allowed',     true,
    'used_bytes',  v_row.used_bytes + p_bytes,
    'limit_bytes', v_limit
  );
END;
$$;

REVOKE ALL    ON FUNCTION public.increment_agency_storage_usage(BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_agency_storage_usage(BIGINT) TO authenticated;

-- ─── 6. RPC: decrement_agency_storage_usage ───────────────────────────────────
-- Safely decrements used_bytes after file deletion.
-- Floors at 0 to prevent negative values.
-- Returns the new used_bytes value.

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

-- ─── 7. RPC: get_chat_thread_file_paths ────────────────────────────────────────
-- Returns file paths and sizes for all attachments in a conversation.
-- Frontend uses this to perform storage.remove() calls before decrementing.

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
  -- Only agency members may bulk-delete thread files.
  SELECT om.organization_id INTO v_org_id
  FROM   public.organization_members om
  JOIN   public.organizations o ON o.id = om.organization_id
  WHERE  om.user_id = auth.uid()
    AND  o.type     = 'agency'
  LIMIT 1;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'get_chat_thread_file_paths: unauthorized';
  END IF;

  SELECT json_agg(
    json_build_object(
      'file_url',  m.file_url,
      'path',      CASE
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

-- ─── 8. RPC: get_model_portfolio_file_paths ────────────────────────────────────
-- Returns file paths and sizes for all storage-backed photos of a model.
-- Frontend uses this before bulk-deleting a model portfolio.

CREATE OR REPLACE FUNCTION public.get_model_portfolio_file_paths(p_model_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, storage
AS $$
DECLARE
  v_org_id UUID;
  v_result JSON;
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

-- ─── 9. RPC: admin_set_agency_storage_usage ────────────────────────────────────
-- Allows admins to manually correct storage usage (e.g. after a bulk import).

CREATE OR REPLACE FUNCTION public.admin_set_agency_storage_usage(
  p_organization_id UUID,
  p_used_bytes      BIGINT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = TRUE) THEN
    RAISE EXCEPTION 'admin_set_agency_storage_usage: unauthorized';
  END IF;

  IF p_used_bytes < 0 THEN
    RAISE EXCEPTION 'admin_set_agency_storage_usage: used_bytes must be >= 0';
  END IF;

  INSERT INTO organization_storage_usage (organization_id, used_bytes)
  VALUES (p_organization_id, p_used_bytes)
  ON CONFLICT (organization_id) DO UPDATE
    SET used_bytes = p_used_bytes,
        updated_at = now();
END;
$$;

REVOKE ALL    ON FUNCTION public.admin_set_agency_storage_usage(UUID, BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_agency_storage_usage(UUID, BIGINT) TO authenticated;

-- ─── 10. Trigger: auto-create storage row for new agency organizations ─────────

CREATE OR REPLACE FUNCTION public.auto_create_agency_storage_usage()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.type = 'agency' THEN
    INSERT INTO public.organization_storage_usage (organization_id, used_bytes)
    VALUES (NEW.id, 0)
    ON CONFLICT (organization_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_auto_create_agency_storage_usage ON public.organizations;
CREATE TRIGGER trigger_auto_create_agency_storage_usage
  AFTER INSERT ON public.organizations
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_create_agency_storage_usage();

-- ─── 11. Backfill: existing agency organizations ───────────────────────────────

INSERT INTO public.organization_storage_usage (organization_id, used_bytes)
SELECT id, 0
FROM   public.organizations
WHERE  type = 'agency'
ON CONFLICT (organization_id) DO NOTHING;
