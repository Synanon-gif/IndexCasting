-- =============================================================================
-- System Hardening Migration
-- Covers:
--   Part 1: chat_type column on recruiting_chat_threads
--   Part 4: booking_events table (single source of truth for bookings)
--   Part 5: Tighten RLS on recruiting_chat_threads + messages (member removal)
--   Part 8: Data integrity guard (models.user_id unique)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- PART 1: chat_type on recruiting_chat_threads
-- ---------------------------------------------------------------------------
ALTER TABLE public.recruiting_chat_threads
  ADD COLUMN IF NOT EXISTS chat_type TEXT DEFAULT 'recruiting'
    CHECK (chat_type IN ('recruiting', 'active_model'));

COMMENT ON COLUMN public.recruiting_chat_threads.chat_type IS
  'recruiting = before acceptance; active_model = after agency accepts the application';

-- Backfill: threads already linked to accepted applications → active_model
UPDATE public.recruiting_chat_threads t
SET chat_type = 'active_model'
FROM public.model_applications a
WHERE t.application_id = a.id
  AND a.status = 'accepted'
  AND (t.chat_type IS NULL OR t.chat_type = 'recruiting');

-- ---------------------------------------------------------------------------
-- PART 4: booking_events table – single source of truth for booking lifecycle
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.booking_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id        UUID NOT NULL REFERENCES public.models(id) ON DELETE CASCADE,
  client_org_id   UUID REFERENCES public.organizations(id) ON DELETE SET NULL,
  agency_org_id   UUID REFERENCES public.organizations(id) ON DELETE SET NULL,
  date            DATE NOT NULL,
  type            TEXT NOT NULL CHECK (type IN ('option', 'job', 'casting')),
  status          TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'agency_accepted', 'model_confirmed', 'completed', 'cancelled')),
  title           TEXT,
  note            TEXT,
  source_option_request_id UUID REFERENCES public.option_requests(id) ON DELETE SET NULL,
  created_by      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_booking_events_model   ON public.booking_events (model_id);
CREATE INDEX IF NOT EXISTS idx_booking_events_client  ON public.booking_events (client_org_id);
CREATE INDEX IF NOT EXISTS idx_booking_events_agency  ON public.booking_events (agency_org_id);
CREATE INDEX IF NOT EXISTS idx_booking_events_date    ON public.booking_events (date);

ALTER TABLE public.booking_events ENABLE ROW LEVEL SECURITY;

-- updated_at trigger (reuses existing set_updated_at() if available)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'set_updated_at'
  ) THEN
    CREATE OR REPLACE TRIGGER booking_events_updated_at
      BEFORE UPDATE ON public.booking_events
      FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
  END IF;
END $$;

-- Helper: is current user a member of a given organization?
CREATE OR REPLACE FUNCTION public.is_org_member(p_org_id UUID)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.organization_members om
    WHERE om.organization_id = p_org_id
      AND om.user_id = auth.uid()
  )
  OR EXISTS (
    SELECT 1
    FROM public.organizations o
    WHERE o.id = p_org_id
      AND o.owner_id = auth.uid()
  );
$$;

REVOKE ALL ON FUNCTION public.is_org_member(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_org_member(UUID) TO authenticated;

-- RLS Policies for booking_events
-- SELECT: any party involved (agency member, client member, or the model's owner)
DROP POLICY IF EXISTS "booking_events_select" ON public.booking_events;
CREATE POLICY "booking_events_select"
  ON public.booking_events FOR SELECT
  TO authenticated
  USING (
    -- Agency org member
    (agency_org_id IS NOT NULL AND public.is_org_member(agency_org_id))
    -- Client org member
    OR (client_org_id IS NOT NULL AND public.is_org_member(client_org_id))
    -- Model owner (user account linked to model)
    OR EXISTS (
      SELECT 1 FROM public.models m
      WHERE m.id = booking_events.model_id
        AND m.user_id = auth.uid()
    )
  );

-- INSERT: agency org member or client org member
DROP POLICY IF EXISTS "booking_events_insert" ON public.booking_events;
CREATE POLICY "booking_events_insert"
  ON public.booking_events FOR INSERT
  TO authenticated
  WITH CHECK (
    (agency_org_id IS NOT NULL AND public.is_org_member(agency_org_id))
    OR (client_org_id IS NOT NULL AND public.is_org_member(client_org_id))
  );

-- UPDATE: any party involved may update status/notes
DROP POLICY IF EXISTS "booking_events_update" ON public.booking_events;
CREATE POLICY "booking_events_update"
  ON public.booking_events FOR UPDATE
  TO authenticated
  USING (
    (agency_org_id IS NOT NULL AND public.is_org_member(agency_org_id))
    OR (client_org_id IS NOT NULL AND public.is_org_member(client_org_id))
    OR EXISTS (
      SELECT 1 FROM public.models m
      WHERE m.id = booking_events.model_id
        AND m.user_id = auth.uid()
    )
  )
  WITH CHECK (
    (agency_org_id IS NOT NULL AND public.is_org_member(agency_org_id))
    OR (client_org_id IS NOT NULL AND public.is_org_member(client_org_id))
    OR EXISTS (
      SELECT 1 FROM public.models m
      WHERE m.id = booking_events.model_id
        AND m.user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- PART 5: Tighten RLS on recruiting_chat_threads (member removal)
-- ---------------------------------------------------------------------------

-- Drop overly permissive baseline policies
DROP POLICY IF EXISTS "Authenticated can read recruiting threads" ON public.recruiting_chat_threads;
DROP POLICY IF EXISTS "Authenticated can insert recruiting threads" ON public.recruiting_chat_threads;

-- SELECT: agency org member OR legacy agency profile OR the applicant (model user)
CREATE POLICY "recruiting_threads_select"
  ON public.recruiting_chat_threads FOR SELECT
  TO authenticated
  USING (
    -- Agency organisation member (owner / booker)
    (
      agency_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.organization_members om
        JOIN public.organizations o ON o.id = om.organization_id
        WHERE om.user_id = auth.uid()
          AND o.agency_id = recruiting_chat_threads.agency_id
      )
    )
    -- Legacy: profile email matches agency email (backward compat for owner-only setups)
    OR (
      agency_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.agencies a
        JOIN public.profiles p ON p.id = auth.uid()
        WHERE a.id = recruiting_chat_threads.agency_id
          AND trim(lower(COALESCE(p.email, ''))) = lower(trim(COALESCE(a.email, '')))
      )
    )
    -- The model applicant (model side of the chat)
    OR EXISTS (
      SELECT 1
      FROM public.model_applications app
      WHERE app.id = recruiting_chat_threads.application_id
        AND app.applicant_user_id = auth.uid()
    )
    -- Threads without agency_id yet: allow creator
    OR (agency_id IS NULL AND organization_id IS NULL AND created_by = auth.uid())
  );

-- INSERT: agency members may open threads (RPC handles permission check too)
CREATE POLICY "recruiting_threads_insert"
  ON public.recruiting_chat_threads FOR INSERT
  TO authenticated
  WITH CHECK (
    (
      agency_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.organization_members om
        JOIN public.organizations o ON o.id = om.organization_id
        WHERE om.user_id = auth.uid()
          AND o.agency_id = recruiting_chat_threads.agency_id
      )
    )
    OR (
      agency_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.agencies a
        JOIN public.profiles p ON p.id = auth.uid()
        WHERE a.id = recruiting_chat_threads.agency_id
          AND trim(lower(COALESCE(p.email, ''))) = lower(trim(COALESCE(a.email, '')))
      )
    )
    -- Allow inserts where agency_id not yet set (RPC will update it atomically)
    OR agency_id IS NULL
  );

-- UPDATE: agency members can update their own threads (e.g. set chat_type)
DROP POLICY IF EXISTS "recruiting_threads_update" ON public.recruiting_chat_threads;
CREATE POLICY "recruiting_threads_update"
  ON public.recruiting_chat_threads FOR UPDATE
  TO authenticated
  USING (
    (
      agency_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.organization_members om
        JOIN public.organizations o ON o.id = om.organization_id
        WHERE om.user_id = auth.uid()
          AND o.agency_id = recruiting_chat_threads.agency_id
      )
    )
    OR (
      agency_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.agencies a
        JOIN public.profiles p ON p.id = auth.uid()
        WHERE a.id = recruiting_chat_threads.agency_id
          AND trim(lower(COALESCE(p.email, ''))) = lower(trim(COALESCE(a.email, '')))
      )
    )
  )
  WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- Tighten recruiting_chat_messages RLS (inherits thread access check)
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "Authenticated can read recruiting messages" ON public.recruiting_chat_messages;
DROP POLICY IF EXISTS "Authenticated can insert recruiting messages" ON public.recruiting_chat_messages;

-- SELECT: only if the user can see the parent thread
CREATE POLICY "recruiting_messages_select"
  ON public.recruiting_chat_messages FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.recruiting_chat_threads t
      WHERE t.id = recruiting_chat_messages.thread_id
        AND (
          (
            t.agency_id IS NOT NULL
            AND EXISTS (
              SELECT 1
              FROM public.organization_members om
              JOIN public.organizations o ON o.id = om.organization_id
              WHERE om.user_id = auth.uid()
                AND o.agency_id = t.agency_id
            )
          )
          OR (
            t.agency_id IS NOT NULL
            AND EXISTS (
              SELECT 1
              FROM public.agencies a
              JOIN public.profiles p ON p.id = auth.uid()
              WHERE a.id = t.agency_id
                AND trim(lower(COALESCE(p.email, ''))) = lower(trim(COALESCE(a.email, '')))
            )
          )
          OR EXISTS (
            SELECT 1
            FROM public.model_applications app
            WHERE app.id = t.application_id
              AND app.applicant_user_id = auth.uid()
          )
          OR (t.agency_id IS NULL AND t.created_by = auth.uid())
        )
    )
  );

-- INSERT: same check
CREATE POLICY "recruiting_messages_insert"
  ON public.recruiting_chat_messages FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.recruiting_chat_threads t
      WHERE t.id = recruiting_chat_messages.thread_id
        AND (
          (
            t.agency_id IS NOT NULL
            AND EXISTS (
              SELECT 1
              FROM public.organization_members om
              JOIN public.organizations o ON o.id = om.organization_id
              WHERE om.user_id = auth.uid()
                AND o.agency_id = t.agency_id
            )
          )
          OR (
            t.agency_id IS NOT NULL
            AND EXISTS (
              SELECT 1
              FROM public.agencies a
              JOIN public.profiles p ON p.id = auth.uid()
              WHERE a.id = t.agency_id
                AND trim(lower(COALESCE(p.email, ''))) = lower(trim(COALESCE(a.email, '')))
            )
          )
          OR EXISTS (
            SELECT 1
            FROM public.model_applications app
            WHERE app.id = t.application_id
              AND app.applicant_user_id = auth.uid()
          )
          OR (t.agency_id IS NULL AND t.created_by = auth.uid())
        )
    )
  );

-- ---------------------------------------------------------------------------
-- PART 8: Data integrity – models.user_id unique (safe guard)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'models'
      AND indexname = 'models_user_id_unique'
  ) THEN
    CREATE UNIQUE INDEX models_user_id_unique
      ON public.models (user_id)
      WHERE user_id IS NOT NULL;
  END IF;
END $$;

-- model_agency_territories unique (model_id, country_code) – verify
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'model_agency_territories'
      AND indexname LIKE '%model_id%country_code%'
  ) THEN
    CREATE UNIQUE INDEX IF NOT EXISTS mat_unique_model_country
      ON public.model_agency_territories (model_id, country_code);
  END IF;
END $$;
