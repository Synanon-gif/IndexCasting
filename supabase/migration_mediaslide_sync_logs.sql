-- =============================================================================
-- Mediaslide Sync Logs
--
-- Persists error/audit entries written by mediaslideSyncService.ts
-- (logMediaslideError, syncSingleModelFromMediaslide, runMediaslideCronSync).
--
-- RLS:
--   SELECT  — agency owners and bookers of the same agency as the model, plus
--             the model itself can read its own row.
--   INSERT  — only via service functions (authenticated), no direct client write.
--   UPDATE/DELETE — blocked entirely (append-only audit log).
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.mediaslide_sync_logs (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  operation    text        NOT NULL,
  model_id     uuid        REFERENCES public.models(id) ON DELETE SET NULL,
  mediaslide_id text,
  status_code  int,
  message      text        NOT NULL,
  details      jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- Index for fast lookup by model and by time
CREATE INDEX IF NOT EXISTS idx_mediaslide_sync_logs_model_id
  ON public.mediaslide_sync_logs (model_id);

CREATE INDEX IF NOT EXISTS idx_mediaslide_sync_logs_created_at
  ON public.mediaslide_sync_logs (created_at DESC);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

ALTER TABLE public.mediaslide_sync_logs ENABLE ROW LEVEL SECURITY;

-- Agency owners and bookers can read logs for models that belong to their agency.
DROP POLICY IF EXISTS "Agency members can read sync logs for own models" ON public.mediaslide_sync_logs;
CREATE POLICY "Agency members can read sync logs for own models"
  ON public.mediaslide_sync_logs
  FOR SELECT
  TO authenticated
  USING (
    model_id IS NULL -- system-level entries (no specific model) are visible to all authenticated
    OR EXISTS (
      SELECT 1
      FROM public.models m
      WHERE m.id = mediaslide_sync_logs.model_id
        AND (
          -- agency owner via organization_members
          EXISTS (
            SELECT 1
            FROM public.organization_members om
            WHERE om.user_id = auth.uid()
              AND om.organization_id = m.agency_id
              AND om.role IN ('owner', 'booker')
          )
          -- agency booker via bookers table (older path)
          OR EXISTS (
            SELECT 1
            FROM public.bookers b
            WHERE b.user_id = auth.uid()
              AND b.agency_id = m.agency_id
          )
        )
    )
  );

-- Authenticated service code may insert (no WITH CHECK restriction on columns).
DROP POLICY IF EXISTS "Service can insert sync logs" ON public.mediaslide_sync_logs;
CREATE POLICY "Service can insert sync logs"
  ON public.mediaslide_sync_logs
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- No UPDATE or DELETE (append-only log).

COMMENT ON TABLE public.mediaslide_sync_logs IS
  'Append-only audit/error log for Mediaslide sync operations. '
  'Written by mediaslideSyncService.ts (logMediaslideError). '
  'Agency members can read logs for their own models; no updates or deletes allowed.';
