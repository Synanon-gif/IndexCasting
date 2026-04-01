-- ============================================================
-- Replication Slot Health Monitoring
-- Führe diese Queries im Supabase SQL-Editor oder Dashboard aus,
-- um WAL-Akkumulation bei 100k Usern zu überwachen.
-- ============================================================

-- View: Zeigt alle Replication Slots + gehaltene WAL-Menge.
-- ALERT empfohlen wenn retained_wal > 1 GB (Supabase-Standard-Warnschwelle).
CREATE OR REPLACE VIEW public.replication_slot_health AS
SELECT
  slot_name,
  plugin,
  slot_type,
  active,
  active_pid,
  pg_size_pretty(
    pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn)
  ) AS retained_wal,
  pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn) AS retained_bytes
FROM pg_replication_slots;

-- Lies-nur Zugriff für den Anon-Key (Monitoring-Dashboard kann abfragen).
-- Nur intern — niemals öffentlich exponieren.
GRANT SELECT ON public.replication_slot_health TO authenticated;

-- ============================================================
-- Supabase Dashboard Checkliste (manuell im Dashboard prüfen):
-- ============================================================
--
-- 1. Database → Replication → Slots:
--    Prüfe ob "supabase_realtime_messages_slot" aktiv ist.
--    Bei retained_bytes > 500 MB → Kontakt Supabase Support.
--
-- 2. Database → Reports → Connections:
--    Bei > 80% des Connection-Limits → PgBouncer-Pooling aktivieren
--    (Supabase Settings → Database → Connection Pooling → Transaction Mode).
--
-- 3. Realtime → Inspect:
--    Prüfe Channel-Count; bei > 1000 gleichzeitigen Channels pro Region
--    (Paris/NYC/Milan) → Supabase Pro/Team Plan notwendig.
--
-- 4. Empfohlenes Monitoring-Intervall: alle 5 Minuten via cron oder
--    externem Alerting (Grafana, Datadog, Supabase Webhooks).
-- ============================================================
