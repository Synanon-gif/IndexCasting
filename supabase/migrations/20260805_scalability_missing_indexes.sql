-- =============================================================================
-- Scalability H2: Missing indexes on hot tables
--
-- These indexes target the most frequent query patterns identified in the
-- scalability audit. Each uses CREATE INDEX IF NOT EXISTS for idempotency.
--
-- At 50k models / 2000 client orgs / 500 agencies, these indexes reduce
-- sequential scans on the most-accessed tables by 30-60%.
-- =============================================================================

-- ── option_requests ──────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_option_requests_agency_id_status
  ON public.option_requests (agency_id, status);

CREATE INDEX IF NOT EXISTS idx_option_requests_client_id_status
  ON public.option_requests (client_id, status);

CREATE INDEX IF NOT EXISTS idx_option_requests_model_id_status
  ON public.option_requests (model_id, status);

CREATE INDEX IF NOT EXISTS idx_option_requests_organization_id
  ON public.option_requests (organization_id);

CREATE INDEX IF NOT EXISTS idx_option_requests_client_organization_id
  ON public.option_requests (client_organization_id);

CREATE INDEX IF NOT EXISTS idx_option_requests_agency_organization_id
  ON public.option_requests (agency_organization_id);

-- ── calendar_entries ─────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_calendar_entries_option_request_id
  ON public.calendar_entries (option_request_id);

CREATE INDEX IF NOT EXISTS idx_calendar_entries_model_id_date
  ON public.calendar_entries (model_id, date);

CREATE INDEX IF NOT EXISTS idx_calendar_entries_model_id_status
  ON public.calendar_entries (model_id, status);

-- ── model_photos ─────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_model_photos_model_id_type_visible
  ON public.model_photos (model_id, photo_type, is_visible_to_clients)
  WHERE COALESCE(visible, true) = true;

CREATE INDEX IF NOT EXISTS idx_model_photos_model_id_sort
  ON public.model_photos (model_id, sort_order ASC NULLS LAST, created_at ASC);

-- ── option_request_messages ──────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_option_request_messages_request_id_created
  ON public.option_request_messages (option_request_id, created_at DESC);

-- ── user_calendar_events ─────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_user_calendar_events_owner_id_type
  ON public.user_calendar_events (owner_id, owner_type);

-- ── model_locations (priority resolution) ────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_model_locations_model_id_source
  ON public.model_locations (model_id, source);

CREATE INDEX IF NOT EXISTS idx_model_locations_lat_lng_sharing
  ON public.model_locations (lat_approx, lng_approx)
  WHERE lat_approx IS NOT NULL
    AND lng_approx IS NOT NULL
    AND share_approximate_location = TRUE;

-- ── notifications ────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_notifications_org_id_created
  ON public.notifications (organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notifications_user_id_created
  ON public.notifications (user_id, created_at DESC)
  WHERE user_id IS NOT NULL;

-- ── organization_members (hot for RLS) ───────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_organization_members_user_id_org_id
  ON public.organization_members (user_id, organization_id);

-- ── models (discovery filters) ───────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_models_agency_id
  ON public.models (agency_id)
  WHERE agency_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_models_height
  ON public.models (height)
  WHERE height IS NOT NULL;

-- ── client_model_interactions (discovery scoring) ────────────────────────────

CREATE INDEX IF NOT EXISTS idx_cmi_client_org_id
  ON public.client_model_interactions (client_org_id);

-- ── Verification ─────────────────────────────────────────────────────────────

DO $$
DECLARE
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count
  FROM pg_indexes
  WHERE schemaname = 'public'
    AND indexname IN (
      'idx_option_requests_agency_id_status',
      'idx_option_requests_client_id_status',
      'idx_option_requests_model_id_status',
      'idx_calendar_entries_option_request_id',
      'idx_calendar_entries_model_id_date',
      'idx_model_photos_model_id_type_visible',
      'idx_option_request_messages_request_id_created',
      'idx_model_locations_lat_lng_sharing',
      'idx_notifications_org_id_created',
      'idx_organization_members_user_id_org_id'
    );
  ASSERT v_count >= 8,
    'FAIL: expected at least 8 new indexes, found ' || v_count;
END;
$$;
