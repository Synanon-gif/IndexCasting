-- =============================================================================
-- Application Model Confirmation – STEP 1: ENUM ONLY
--
-- PostgreSQL-Einschränkung: ALTER TYPE ... ADD VALUE kann nicht in derselben
-- Transaktion verwendet werden, in der der neue Wert bereits referenziert wird.
--
-- ► Diesen Query ALLEINE ausführen (eigene Transaktion / eigener Query-Run).
-- ► Danach migration_application_model_confirmation_rls.sql ausführen.
-- =============================================================================

-- Idempotent: safe to re-run, fügt 'pending_model_confirmation' nur einmal hinzu.
ALTER TYPE public.application_status ADD VALUE IF NOT EXISTS 'pending_model_confirmation';
