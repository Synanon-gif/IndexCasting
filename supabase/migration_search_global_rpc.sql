-- =============================================================================
-- Global Search RPC
--
-- search_global(p_query, p_org_id):
--   Searches models, option_requests, and conversations scoped to the caller's
--   organization. Returns up to 5 results per category.
--
-- Security:
--   - Verifies caller is a member of p_org_id.
--   - All sub-queries are explicitly scoped by org_id / agency link.
--   - Uses ILIKE (case-insensitive) with indexed columns.
-- =============================================================================

-- ─── Optional: GIN index on models.name for fast full-text search ──────────
-- Only adds if not already present; safe to re-run.
CREATE INDEX IF NOT EXISTS idx_models_name_trgm
  ON public.models USING gin (name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_models_mediaslide_trgm
  ON public.models USING gin (mediaslide_sync_id gin_trgm_ops);

-- Enable pg_trgm extension if not yet enabled (idempotent).
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ─── RPC ──────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.search_global(
  p_query  text,
  p_org_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_member   boolean;
  v_org_type    text;
  v_agency_id   uuid;
  v_pattern     text;
  v_models      jsonb;
  v_options     jsonb;
  v_convs       jsonb;
BEGIN
  -- ── Security guard ─────────────────────────────────────────────────────────
  SELECT EXISTS (
    SELECT 1
    FROM public.organization_members om
    WHERE om.organization_id = p_org_id
      AND om.user_id = auth.uid()
  ) INTO v_is_member;

  IF NOT v_is_member THEN
    RAISE EXCEPTION 'Access denied: not a member of this organization';
  END IF;

  -- Sanitize: empty query returns empty results.
  p_query := trim(p_query);
  IF length(p_query) < 2 THEN
    RETURN jsonb_build_object('models', '[]'::jsonb, 'option_requests', '[]'::jsonb, 'conversations', '[]'::jsonb);
  END IF;

  v_pattern := '%' || p_query || '%';

  -- Detect org type + linked agency id.
  SELECT o.type::text, o.agency_id
  INTO   v_org_type, v_agency_id
  FROM   public.organizations o
  WHERE  o.id = p_org_id;

  -- ── 1. Models ──────────────────────────────────────────────────────────────
  IF v_org_type = 'agency' AND v_agency_id IS NOT NULL THEN
    SELECT jsonb_agg(row_to_json(r))
    INTO   v_models
    FROM (
      SELECT m.id, m.name, m.mediaslide_sync_id AS mediaslide_id, m.city, m.country
      FROM   public.models m
      WHERE  m.agency_id = v_agency_id
        AND  (m.name ILIKE v_pattern OR m.mediaslide_sync_id ILIKE v_pattern)
      ORDER  BY m.name
      LIMIT  5
    ) r;
  ELSE
    -- Clients see models linked via confirmed option requests.
    SELECT jsonb_agg(row_to_json(r))
    INTO   v_models
    FROM (
      SELECT DISTINCT ON (m.id) m.id, m.name, m.mediaslide_sync_id AS mediaslide_id, m.city, m.country
      FROM   public.models m
      JOIN   public.option_requests op ON op.model_id = m.id
      WHERE  op.organization_id = p_org_id
        AND  (m.name ILIKE v_pattern OR m.mediaslide_sync_id ILIKE v_pattern)
      ORDER  BY m.id, m.name
      LIMIT  5
    ) r;
  END IF;

  -- ── 2. Option Requests ─────────────────────────────────────────────────────
  IF v_org_type = 'agency' AND v_agency_id IS NOT NULL THEN
    SELECT jsonb_agg(row_to_json(r))
    INTO   v_options
    FROM (
      SELECT op.id, op.model_name AS model_name, op.status, op.final_status,
             op.requested_date, op.request_type AS role
      FROM   public.option_requests op
      WHERE  op.agency_id = v_agency_id
        AND  (op.model_name ILIKE v_pattern OR op.request_type ILIKE v_pattern OR op.client_name ILIKE v_pattern)
      ORDER  BY op.created_at DESC
      LIMIT  5
    ) r;
  ELSE
    SELECT jsonb_agg(row_to_json(r))
    INTO   v_options
    FROM (
      SELECT op.id, op.model_name AS model_name, op.status, op.final_status,
             op.requested_date, op.request_type AS role
      FROM   public.option_requests op
      WHERE  op.organization_id = p_org_id
        AND  (op.model_name ILIKE v_pattern OR op.request_type ILIKE v_pattern)
      ORDER  BY op.created_at DESC
      LIMIT  5
    ) r;
  END IF;

  -- ── 3. Conversations ───────────────────────────────────────────────────────
  SELECT jsonb_agg(row_to_json(r))
  INTO   v_convs
  FROM (
    SELECT c.id, c.title,
           (SELECT m2.text FROM public.messages m2
            WHERE m2.conversation_id = c.id
            ORDER BY m2.created_at DESC LIMIT 1) AS last_message
    FROM   public.conversations c
    WHERE  (
             auth.uid() = ANY(c.participant_ids)
             OR c.client_organization_id = p_org_id
             OR c.agency_organization_id = p_org_id
           )
      AND  (
             c.title ILIKE v_pattern
             OR EXISTS (
               SELECT 1 FROM public.messages mx
               WHERE mx.conversation_id = c.id
                 AND mx.text ILIKE v_pattern
             )
           )
    ORDER  BY c.updated_at DESC
    LIMIT  5
  ) r;

  RETURN jsonb_build_object(
    'models',          COALESCE(v_models,  '[]'::jsonb),
    'option_requests', COALESCE(v_options, '[]'::jsonb),
    'conversations',   COALESCE(v_convs,   '[]'::jsonb)
  );
END;
$$;

ALTER FUNCTION public.search_global(text, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.search_global(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_global(text, uuid) TO authenticated;
