-- =============================================================================
-- External Sync Extensions (Mediaslide / Netwalk — Bidirectional)
-- Date: 2026-10-27
--
-- Purely additive schema changes for the bidirectional Mediaslide/Netwalk sync.
-- Touches NO existing logic, RLS or workflow paths. Idempotent.
--
-- 1. public.models.photo_source
--    Per-model toggle: 'own' (default — local model_photos drive portfolio_images),
--    'mediaslide' or 'netwalk' (external connector overwrites portfolio_images).
--    Discovery / Client-Web pipelines remain unchanged — they keep reading from
--    portfolio_images / model_photos via the canonical pipeline (system-invariants
--    §27.1). The toggle only changes WHO writes those mirror columns.
--
-- 2. public.calendar_entries.external_source / external_event_id / external_updated_at
--    Allows storing remote calendar block-outs from Mediaslide / Netwalk alongside
--    canonical option_request_id rows.
--    Conflict resolution invariant (see system-invariants §G — Calendar as Projection):
--      Local rows with option_request_id IS NOT NULL ALWAYS win. External rows are
--      visual-only block-outs; they MUST stay outside the Smart-Attention pipeline.
--
-- 3. public.external_sync_outbox
--    Decouples job confirmation from outgoing HTTP calls. Job confirms NEVER fail
--    because of external API errors; instead an outbox row is queued and retried.
--
-- 4. public.set_model_photo_source(p_model_id, p_source)
--    SECURITY DEFINER RPC — same agency-membership guard as save_model_territories
--    / agency_update_model_full (org_members + type=agency or bookers fallback).
--
-- 5. public.enqueue_external_sync_outbox / public.list_pending_external_sync_outbox
--    public.mark_external_sync_outbox_sent / public.mark_external_sync_outbox_failed
--    SECURITY DEFINER helpers — write paths revoke direct INSERT/UPDATE.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. models.photo_source
-- ---------------------------------------------------------------------------

ALTER TABLE public.models
  ADD COLUMN IF NOT EXISTS photo_source text NOT NULL DEFAULT 'own';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'models_photo_source_check'
  ) THEN
    ALTER TABLE public.models
      ADD CONSTRAINT models_photo_source_check
      CHECK (photo_source IN ('own', 'mediaslide', 'netwalk'));
  END IF;
END $$;

COMMENT ON COLUMN public.models.photo_source IS
  'Per-model image source toggle. ''own'' = local uploads (model_photos) drive portfolio_images. '
  '''mediaslide''/''netwalk'' = external connector overwrites portfolio_images on each sync. '
  'Local model_photos are always saved but only mirrored when source = ''own''. '
  'Discovery/Client-Web reads remain unchanged — they only see portfolio_images/model_photos.';

-- ---------------------------------------------------------------------------
-- 2. calendar_entries — external source columns
-- ---------------------------------------------------------------------------

ALTER TABLE public.calendar_entries
  ADD COLUMN IF NOT EXISTS external_source     text,
  ADD COLUMN IF NOT EXISTS external_event_id   text,
  ADD COLUMN IF NOT EXISTS external_updated_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'calendar_entries_external_source_check'
  ) THEN
    ALTER TABLE public.calendar_entries
      ADD CONSTRAINT calendar_entries_external_source_check
      CHECK (external_source IS NULL OR external_source IN ('mediaslide', 'netwalk'));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_calendar_entries_external_unique
  ON public.calendar_entries (external_source, external_event_id)
  WHERE external_source IS NOT NULL AND external_event_id IS NOT NULL;

COMMENT ON COLUMN public.calendar_entries.external_source IS
  'Origin of an externally-synced calendar block-out (mediaslide / netwalk). NULL for canonical rows.';
COMMENT ON COLUMN public.calendar_entries.external_event_id IS
  'External system''s event ID (paired with external_source). Used for idempotent inbound sync.';
COMMENT ON COLUMN public.calendar_entries.external_updated_at IS
  'Remote updated_at timestamp — used for conflict resolution between two external rows.';

-- ---------------------------------------------------------------------------
-- 3. external_sync_outbox
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.external_sync_outbox (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id   uuid        NOT NULL REFERENCES public.agencies(id) ON DELETE CASCADE,
  model_id    uuid        REFERENCES public.models(id) ON DELETE CASCADE,
  provider    text        NOT NULL CHECK (provider IN ('mediaslide', 'netwalk')),
  operation   text        NOT NULL,
  payload     jsonb       NOT NULL,
  status      text        NOT NULL DEFAULT 'pending'
                           CHECK (status IN ('pending', 'sent', 'failed')),
  attempts    int         NOT NULL DEFAULT 0,
  last_error  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  sent_at     timestamptz,
  -- Idempotency key: same operation+model+payload-hash should never queue twice
  -- within a short window. Caller supplies a deterministic key when relevant.
  idempotency_key text
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_external_sync_outbox_idempotency
  ON public.external_sync_outbox (provider, idempotency_key)
  WHERE idempotency_key IS NOT NULL AND status <> 'failed';

CREATE INDEX IF NOT EXISTS idx_external_sync_outbox_pending
  ON public.external_sync_outbox (provider, status, created_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_external_sync_outbox_agency
  ON public.external_sync_outbox (agency_id, created_at DESC);

COMMENT ON TABLE public.external_sync_outbox IS
  'Queue of outgoing sync operations to Mediaslide/Netwalk. Decouples local job confirmation '
  'from external HTTP calls so confirmations never fail because of remote API issues. '
  'Insert via enqueue_external_sync_outbox RPC; processed by external-calendar-push edge function.';

ALTER TABLE public.external_sync_outbox ENABLE ROW LEVEL SECURITY;

-- Read policy: agency members and admins
DROP POLICY IF EXISTS "external_sync_outbox_select_agency_members"
  ON public.external_sync_outbox;
CREATE POLICY "external_sync_outbox_select_agency_members"
  ON public.external_sync_outbox
  FOR SELECT
  TO authenticated
  USING (
    public.is_current_user_admin()
    OR EXISTS (
      SELECT 1
      FROM public.organization_members om
      JOIN public.organizations org ON org.id = om.organization_id
      WHERE om.user_id = auth.uid()
        AND org.agency_id = external_sync_outbox.agency_id
        AND org.type = 'agency'
    )
    OR EXISTS (
      SELECT 1 FROM public.bookers b
      WHERE b.agency_id = external_sync_outbox.agency_id
        AND b.user_id = auth.uid()
    )
  );

-- Direct INSERT/UPDATE/DELETE blocked — use SECURITY DEFINER RPCs only.

-- ---------------------------------------------------------------------------
-- 4. set_model_photo_source RPC
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.set_model_photo_source(
  p_model_id uuid,
  p_source   text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
DECLARE
  v_uid              uuid := auth.uid();
  v_model_agency_id  uuid;
  v_caller_in_agency boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF p_source NOT IN ('own', 'mediaslide', 'netwalk') THEN
    RAISE EXCEPTION 'invalid_photo_source: % (must be own | mediaslide | netwalk)', p_source;
  END IF;

  SELECT agency_id INTO v_model_agency_id
  FROM public.models
  WHERE id = p_model_id;

  IF v_model_agency_id IS NULL THEN
    RAISE EXCEPTION 'set_model_photo_source: model not found or has no agency — model_id=%', p_model_id;
  END IF;

  -- Same agency-membership guard as update_model_sync_ids / save_model_territories.
  SELECT EXISTS (
    SELECT 1
    FROM public.organization_members om
    JOIN public.organizations org ON org.id = om.organization_id
    WHERE om.user_id = v_uid
      AND org.agency_id = v_model_agency_id
      AND org.type = 'agency'
  ) OR EXISTS (
    SELECT 1 FROM public.bookers b
    WHERE b.agency_id = v_model_agency_id AND b.user_id = v_uid
  ) OR public.is_current_user_admin()
  INTO v_caller_in_agency;

  IF NOT v_caller_in_agency THEN
    RAISE EXCEPTION 'set_model_photo_source: caller % is not a member of the agency that owns model %',
      v_uid, p_model_id;
  END IF;

  UPDATE public.models
  SET photo_source = p_source
  WHERE id = p_model_id;
END;
$$;

REVOKE ALL ON FUNCTION public.set_model_photo_source(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_model_photo_source(uuid, text) TO authenticated;

COMMENT ON FUNCTION public.set_model_photo_source IS
  'SECURITY DEFINER: sets models.photo_source. Agency-scoped guard matching update_model_sync_ids.';

-- ---------------------------------------------------------------------------
-- 5. enqueue_external_sync_outbox RPC
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.enqueue_external_sync_outbox(
  p_agency_id       uuid,
  p_model_id        uuid,
  p_provider        text,
  p_operation       text,
  p_payload         jsonb,
  p_idempotency_key text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_id     uuid;
  v_member boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF p_provider NOT IN ('mediaslide', 'netwalk') THEN
    RAISE EXCEPTION 'invalid_provider: %', p_provider;
  END IF;

  IF p_agency_id IS NULL THEN
    RAISE EXCEPTION 'agency_id_required';
  END IF;

  -- Caller must be a member of the agency (or admin).
  SELECT EXISTS (
    SELECT 1
    FROM public.organization_members om
    JOIN public.organizations org ON org.id = om.organization_id
    WHERE om.user_id = v_uid
      AND org.agency_id = p_agency_id
      AND org.type = 'agency'
  ) OR EXISTS (
    SELECT 1 FROM public.bookers b
    WHERE b.agency_id = p_agency_id AND b.user_id = v_uid
  ) OR public.is_current_user_admin()
  INTO v_member;

  IF NOT v_member THEN
    RAISE EXCEPTION 'enqueue_external_sync_outbox: caller % is not in agency %', v_uid, p_agency_id;
  END IF;

  -- Idempotency: if a pending/sent row with the same (provider, idempotency_key)
  -- exists, return it instead of inserting a duplicate.
  IF p_idempotency_key IS NOT NULL THEN
    SELECT id INTO v_id
    FROM public.external_sync_outbox
    WHERE provider = p_provider
      AND idempotency_key = p_idempotency_key
      AND status <> 'failed'
    ORDER BY created_at DESC
    LIMIT 1;

    IF v_id IS NOT NULL THEN
      RETURN v_id;
    END IF;
  END IF;

  INSERT INTO public.external_sync_outbox
    (agency_id, model_id, provider, operation, payload, idempotency_key)
  VALUES
    (p_agency_id, p_model_id, p_provider, p_operation, p_payload, p_idempotency_key)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_external_sync_outbox(uuid, uuid, text, text, jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enqueue_external_sync_outbox(uuid, uuid, text, text, jsonb, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 6. list / mark RPCs (for the edge-function worker)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.list_pending_external_sync_outbox(
  p_provider text DEFAULT NULL,
  p_limit    int  DEFAULT 50
)
RETURNS SETOF public.external_sync_outbox
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
BEGIN
  IF NOT public.is_current_user_admin() THEN
    RAISE EXCEPTION 'admin_only';
  END IF;

  RETURN QUERY
  SELECT *
  FROM public.external_sync_outbox
  WHERE status = 'pending'
    AND (p_provider IS NULL OR provider = p_provider)
  ORDER BY created_at ASC
  LIMIT GREATEST(1, LEAST(p_limit, 500));
END;
$$;

REVOKE ALL ON FUNCTION public.list_pending_external_sync_outbox(text, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_pending_external_sync_outbox(text, int) TO authenticated;

CREATE OR REPLACE FUNCTION public.mark_external_sync_outbox_sent(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
BEGIN
  IF NOT public.is_current_user_admin() THEN
    RAISE EXCEPTION 'admin_only';
  END IF;

  UPDATE public.external_sync_outbox
  SET status = 'sent', sent_at = now()
  WHERE id = p_id;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_external_sync_outbox_sent(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_external_sync_outbox_sent(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.mark_external_sync_outbox_failed(
  p_id    uuid,
  p_error text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
BEGIN
  IF NOT public.is_current_user_admin() THEN
    RAISE EXCEPTION 'admin_only';
  END IF;

  UPDATE public.external_sync_outbox
  SET attempts   = attempts + 1,
      last_error = p_error,
      status     = CASE WHEN attempts + 1 >= 5 THEN 'failed' ELSE 'pending' END
  WHERE id = p_id;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_external_sync_outbox_failed(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_external_sync_outbox_failed(uuid, text) TO authenticated;

COMMENT ON FUNCTION public.list_pending_external_sync_outbox IS
  'Admin-only: returns pending outbox rows for the worker (edge function / cron).';
COMMENT ON FUNCTION public.mark_external_sync_outbox_sent IS
  'Admin-only: marks a queued row as sent.';
COMMENT ON FUNCTION public.mark_external_sync_outbox_failed IS
  'Admin-only: increments attempts; auto-promotes status=failed after 5 attempts.';
