-- =============================================================================
-- Phase 29b: Admin Storage Override
--
-- Extends organization_storage_usage with per-org admin-controlled limits.
-- Admins can set a custom limit (bytes), mark an org as unlimited, or reset
-- back to the default 5 GB cap.
--
-- Run after Phase 28b (migration_storage_size_hardening.sql).
--
-- Changes:
--   • ALTER TABLE: adds storage_limit_bytes (nullable) + is_unlimited (bool)
--   • REPLACE: get_my_agency_storage_usage    — returns effective_limit_bytes + is_unlimited
--   • REPLACE: increment_agency_storage_usage — respects new limit columns
--   • NEW:     admin_get_org_storage_usage    — admin reads single-org snapshot
--   • NEW:     admin_set_storage_limit        — admin sets custom bytes limit
--   • NEW:     admin_set_unlimited_storage    — admin grants unlimited storage
--   • NEW:     admin_reset_to_default_storage_limit — admin restores 5 GB default
-- =============================================================================

-- ─── 1. Extend organization_storage_usage ────────────────────────────────────

ALTER TABLE public.organization_storage_usage
  ADD COLUMN IF NOT EXISTS storage_limit_bytes BIGINT       DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS is_unlimited         BOOLEAN NOT NULL DEFAULT false;

-- ─── 2. Helper: resolve effective limit ──────────────────────────────────────
-- Used inline in every RPC — not exposed as a standalone function to keep the
-- call graph shallow.
-- Logic: unlimited → NULL sentinel; custom → storage_limit_bytes; else → 5 GB

-- ─── 3. RPC: get_my_agency_storage_usage (UPDATED) ───────────────────────────
-- Now returns effective_limit_bytes and is_unlimited in addition to used_bytes.

CREATE OR REPLACE FUNCTION public.get_my_agency_storage_usage()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id         UUID;
  v_row            organization_storage_usage%ROWTYPE;
  v_default_limit  BIGINT := 5368709120; -- 5 GB
  v_effective      BIGINT;
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

  SELECT * INTO v_row
  FROM   organization_storage_usage
  WHERE  organization_id = v_org_id;

  -- Resolve effective limit.
  IF v_row.is_unlimited THEN
    v_effective := NULL; -- NULL signals unlimited to the frontend
  ELSIF v_row.storage_limit_bytes IS NOT NULL THEN
    v_effective := v_row.storage_limit_bytes;
  ELSE
    v_effective := v_default_limit;
  END IF;

  RETURN json_build_object(
    'organization_id',     v_org_id,
    'used_bytes',          COALESCE(v_row.used_bytes, 0),
    'limit_bytes',         COALESCE(v_effective, v_default_limit), -- kept for backward compat
    'effective_limit_bytes', v_effective,
    'is_unlimited',        v_row.is_unlimited
  );
END;
$$;

REVOKE ALL    ON FUNCTION public.get_my_agency_storage_usage() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_agency_storage_usage() TO authenticated;

-- ─── 4. RPC: increment_agency_storage_usage (UPDATED) ────────────────────────
-- Respects is_unlimited and storage_limit_bytes overrides.

CREATE OR REPLACE FUNCTION public.increment_agency_storage_usage(p_bytes BIGINT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id         UUID;
  v_row            organization_storage_usage%ROWTYPE;
  v_default_limit  BIGINT := 5368709120; -- 5 GB
  v_effective      BIGINT;
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
    -- Not an agency user — clients/models are unrestricted.
    RETURN json_build_object('allowed', true, 'used_bytes', 0, 'limit_bytes', v_default_limit, 'is_unlimited', false);
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

  -- Unlimited orgs are always allowed.
  IF v_row.is_unlimited THEN
    UPDATE organization_storage_usage
    SET    used_bytes = used_bytes + p_bytes,
           updated_at = now()
    WHERE  organization_id = v_org_id;

    RETURN json_build_object(
      'allowed',     true,
      'used_bytes',  v_row.used_bytes + p_bytes,
      'limit_bytes', v_default_limit,
      'is_unlimited', true
    );
  END IF;

  -- Resolve effective limit.
  IF v_row.storage_limit_bytes IS NOT NULL THEN
    v_effective := v_row.storage_limit_bytes;
  ELSE
    v_effective := v_default_limit;
  END IF;

  -- Block if limit would be exceeded.
  IF (v_row.used_bytes + p_bytes) > v_effective THEN
    RETURN json_build_object(
      'allowed',      false,
      'used_bytes',   v_row.used_bytes,
      'limit_bytes',  v_effective,
      'is_unlimited', false
    );
  END IF;

  -- Increment atomically.
  UPDATE organization_storage_usage
  SET    used_bytes  = used_bytes + p_bytes,
         updated_at  = now()
  WHERE  organization_id = v_org_id;

  RETURN json_build_object(
    'allowed',      true,
    'used_bytes',   v_row.used_bytes + p_bytes,
    'limit_bytes',  v_effective,
    'is_unlimited', false
  );
END;
$$;

REVOKE ALL    ON FUNCTION public.increment_agency_storage_usage(BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_agency_storage_usage(BIGINT) TO authenticated;

-- ─── 5. RPC: admin_get_org_storage_usage ─────────────────────────────────────
-- Admin-only: returns full storage snapshot for a single organization.

CREATE OR REPLACE FUNCTION public.admin_get_org_storage_usage(p_org_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row            organization_storage_usage%ROWTYPE;
  v_default_limit  BIGINT := 5368709120; -- 5 GB
  v_effective      BIGINT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = TRUE) THEN
    RAISE EXCEPTION 'admin_get_org_storage_usage: unauthorized';
  END IF;

  -- Upfront existence check: surfaces a clean JSON error instead of an unhandled FK exception.
  IF NOT EXISTS (SELECT 1 FROM organizations WHERE id = p_org_id) THEN
    RETURN json_build_object('error', 'Organization not found');
  END IF;

  -- Auto-create storage row if missing (legacy orgs or orgs without any uploads yet).
  INSERT INTO organization_storage_usage (organization_id, used_bytes)
  VALUES (p_org_id, 0)
  ON CONFLICT (organization_id) DO NOTHING;

  SELECT * INTO v_row
  FROM   organization_storage_usage
  WHERE  organization_id = p_org_id;

  IF v_row.is_unlimited THEN
    v_effective := NULL;
  ELSIF v_row.storage_limit_bytes IS NOT NULL THEN
    v_effective := v_row.storage_limit_bytes;
  ELSE
    v_effective := v_default_limit;
  END IF;

  RETURN json_build_object(
    'organization_id',       v_row.organization_id,
    'used_bytes',            v_row.used_bytes,
    'storage_limit_bytes',   v_row.storage_limit_bytes,
    'is_unlimited',          v_row.is_unlimited,
    'effective_limit_bytes', v_effective
  );
END;
$$;

REVOKE ALL    ON FUNCTION public.admin_get_org_storage_usage(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_get_org_storage_usage(UUID) TO authenticated;

-- ─── 6. RPC: admin_set_storage_limit ─────────────────────────────────────────
-- Admin-only: sets a custom byte limit for an org and clears the unlimited flag.
-- Validates: 1 byte ≤ limit ≤ 1 TB (1099511627776 bytes).

CREATE OR REPLACE FUNCTION public.admin_set_storage_limit(
  p_organization_id UUID,
  p_new_limit_bytes  BIGINT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = TRUE) THEN
    RAISE EXCEPTION 'admin_set_storage_limit: unauthorized';
  END IF;

  IF p_new_limit_bytes <= 0 THEN
    RAISE EXCEPTION 'admin_set_storage_limit: limit must be greater than 0 bytes';
  END IF;

  -- Max 1 TB to prevent accidental runaway values.
  IF p_new_limit_bytes > 1099511627776 THEN
    RAISE EXCEPTION 'admin_set_storage_limit: limit cannot exceed 1 TB (1099511627776 bytes)';
  END IF;

  INSERT INTO organization_storage_usage (organization_id, used_bytes, storage_limit_bytes, is_unlimited)
  VALUES (p_organization_id, 0, p_new_limit_bytes, false)
  ON CONFLICT (organization_id) DO UPDATE
    SET storage_limit_bytes = p_new_limit_bytes,
        is_unlimited        = false,
        updated_at          = now();
END;
$$;

REVOKE ALL    ON FUNCTION public.admin_set_storage_limit(UUID, BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_storage_limit(UUID, BIGINT) TO authenticated;

-- ─── 7. RPC: admin_set_unlimited_storage ─────────────────────────────────────
-- Admin-only: marks an org as having unlimited storage.

CREATE OR REPLACE FUNCTION public.admin_set_unlimited_storage(p_organization_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = TRUE) THEN
    RAISE EXCEPTION 'admin_set_unlimited_storage: unauthorized';
  END IF;

  INSERT INTO organization_storage_usage (organization_id, used_bytes, storage_limit_bytes, is_unlimited)
  VALUES (p_organization_id, 0, NULL, true)
  ON CONFLICT (organization_id) DO UPDATE
    SET is_unlimited        = true,
        storage_limit_bytes = NULL, -- clear any stale custom limit so DB state is unambiguous
        updated_at          = now();
END;
$$;

REVOKE ALL    ON FUNCTION public.admin_set_unlimited_storage(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_unlimited_storage(UUID) TO authenticated;

-- ─── 8. RPC: admin_reset_to_default_storage_limit ────────────────────────────
-- Admin-only: resets an org back to the 5 GB default (clears both overrides).

CREATE OR REPLACE FUNCTION public.admin_reset_to_default_storage_limit(p_organization_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = TRUE) THEN
    RAISE EXCEPTION 'admin_reset_to_default_storage_limit: unauthorized';
  END IF;

  INSERT INTO organization_storage_usage (organization_id, used_bytes, storage_limit_bytes, is_unlimited)
  VALUES (p_organization_id, 0, NULL, false)
  ON CONFLICT (organization_id) DO UPDATE
    SET storage_limit_bytes = NULL,
        is_unlimited        = false,
        updated_at          = now();
END;
$$;

REVOKE ALL    ON FUNCTION public.admin_reset_to_default_storage_limit(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_reset_to_default_storage_limit(UUID) TO authenticated;
