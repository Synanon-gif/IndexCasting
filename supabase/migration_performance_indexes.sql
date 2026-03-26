-- =============================================================================
-- Performance-Indizes für 100k-Scale
--
-- HINWEIS: CREATE INDEX CONCURRENTLY darf NICHT in einer Transaktion laufen.
-- Supabase Dashboard + CLI wrappen Migrations standardmäßig in BEGIN/COMMIT.
-- Daher hier reguläres CREATE INDEX (IF NOT EXISTS = idempotent + sicher).
--
-- Für Live-Prod ohne Downtime: Indizes einzeln im SQL-Editor außerhalb einer
-- Transaktion mit CONCURRENTLY ausführen (jede Zeile separat als Statement).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. GIN-Index auf conversations.participant_ids (KRITISCH)
--    .contains('participant_ids', [userId]) macht ohne diesen Index einen
--    Full Table Scan → bei 100k gleichzeitigen Nutzern sofortiger DB-Absturz.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_conversations_participant_ids_gin
  ON public.conversations USING GIN (participant_ids);

-- ---------------------------------------------------------------------------
-- 2. B-Tree auf conversations.updated_at (Inbox-Sortierung)
--    Alle Inbox-Queries ORDER BY updated_at DESC profitieren davon.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_conversations_updated_at
  ON public.conversations (updated_at DESC);

-- ---------------------------------------------------------------------------
-- 3. B-Tree auf conversations.context_id (Guest-Chat + B2B Lookups)
--    getGuestConversation() und getOrCreateConversation() filtern per context_id.
--    Bisher nur partieller Unique für 'b2b:%' — dieser Index deckt ALLE Kontexte.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_conversations_context_id
  ON public.conversations (context_id)
  WHERE context_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 4. B-Tree auf option_requests.model_id (fehlt komplett)
--    getOptionRequestsForModel() filtert per model_id ohne Index → Seq-Scan
--    bei 500 gleichzeitigen Agenturen mit jeweils vielen Options.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_option_requests_model_id
  ON public.option_requests (model_id);

-- ---------------------------------------------------------------------------
-- 5. B-Tree auf models.agency_id (FK ohne automatischen PG-Index)
--    getModelsForAgencyFromSupabase() filtert per agency_id.
--    PostgreSQL legt für FK-Spalten auf der Child-Seite KEINEN Index an.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_models_agency_id
  ON public.models (agency_id);

-- ---------------------------------------------------------------------------
-- 6. B-Tree auf models.country_code (Hybrid-Discovery)
--    Hybrid-Location-Discovery filtert per country_code →
--    ohne Index bei tausenden Models voller Seq-Scan.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_models_country_code
  ON public.models (country_code)
  WHERE country_code IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 7. Partieller B-Tree auf models.mediaslide_sync_id (Cron-Job)
--    runMediaslideCronSync() wählt alle Rows WHERE mediaslide_sync_id IS NOT NULL.
--    Der partielle Index deckt genau diese Condition ab.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_models_mediaslide_sync_id
  ON public.models (mediaslide_sync_id)
  WHERE mediaslide_sync_id IS NOT NULL;
