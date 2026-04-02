-- =============================================================================
-- Scale Indexes — Bookings, Territories, Notifications
--
-- Applied as part of the Scale & Stress hardening (April 2026).
-- All indexes use IF NOT EXISTS — safe to apply multiple times.
--
-- NOTE: CREATE INDEX cannot run inside a transaction block in Supabase's
-- migration runner. Run each statement individually if needed.
-- =============================================================================

-- ── Bookings ──────────────────────────────────────────────────────────────────

-- getBookingsForAgency + getAgencyRevenue: agency_id filter + status filter
-- Covers: WHERE agency_id = $1 AND status IN ('completed','invoiced')
CREATE INDEX IF NOT EXISTS idx_bookings_agency_status
  ON public.bookings (agency_id, status);

-- getBookingsForModel + Model calendar view
-- Covers: WHERE model_id = $1 ORDER BY booking_date DESC
CREATE INDEX IF NOT EXISTS idx_bookings_model_date
  ON public.bookings (model_id, booking_date DESC);

-- Tages-/Monatsansichten and date-range queries
-- Covers: WHERE booking_date BETWEEN $start AND $end
CREATE INDEX IF NOT EXISTS idx_bookings_date
  ON public.bookings (booking_date DESC);

-- getBookingsForClient
-- Covers: WHERE client_id = $1 ORDER BY booking_date DESC
CREATE INDEX IF NOT EXISTS idx_bookings_client_date
  ON public.bookings (client_id, booking_date DESC);

-- ── Model Agency Territories ──────────────────────────────────────────────────

-- Near-Me RPC JOIN: model_agency_territories mat ON mat.model_id = m.id
-- Without this index the JOIN becomes a seq-scan over 30k+ rows at 10k models.
CREATE INDEX IF NOT EXISTS idx_mat_model_id
  ON public.model_agency_territories (model_id);

-- Agency roster queries: WHERE agency_id = $1
CREATE INDEX IF NOT EXISTS idx_mat_agency_id
  ON public.model_agency_territories (agency_id);

-- ── Notifications ─────────────────────────────────────────────────────────────

-- NotificationBell feed: WHERE user_id = $1 ORDER BY created_at DESC
CREATE INDEX IF NOT EXISTS idx_notifications_user_created
  ON public.notifications (user_id, created_at DESC);

-- ── Recruiting Chat Messages ──────────────────────────────────────────────────

-- Recruiting chat paging (mirrors existing idx_messages_conversation_created)
CREATE INDEX IF NOT EXISTS idx_recruiting_messages_thread_created
  ON public.recruiting_chat_messages (thread_id, created_at DESC);

-- ── Option Requests ───────────────────────────────────────────────────────────

-- Agency calendar status filter: WHERE agency_id = $1 AND status = $2
CREATE INDEX IF NOT EXISTS idx_option_requests_agency_status
  ON public.option_requests (agency_id, status);

-- ── pg_trgm for hair_color ILIKE ──────────────────────────────────────────────

-- Enables GIN-accelerated ILIKE with % wildcards on models.hair_color.
-- Required by get_models_near_location RPC: hair_color ILIKE '%value%'
-- Without this, every Near-Me query does a full seq-scan on the JOIN result.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_models_hair_color_trgm
  ON public.models USING gin (hair_color gin_trgm_ops);
