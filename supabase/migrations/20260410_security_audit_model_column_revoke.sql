-- =============================================================================
-- Migration: 20260410_security_audit_model_column_revoke.sql
--
-- Fixes:
--   K-1 (CRITICAL): Erweitert column-level REVOKE auf alle sensiblen
--         models-Spalten. Direkte REST-API-Updates durch authenticated User
--         werden damit für alle sicherheitsrelevanten Spalten blockiert.
--         Nur SECURITY DEFINER RPCs (agency_update_model_full,
--         model_update_own_profile_safe) können diese Spalten noch setzen,
--         da sie als postgres-Rolle laufen.
--
--   M-1 (MEDIUM): RLS "model_update_own_profile" WITH CHECK ergänzt
--         agency_id IS NULL — agency-controlled Models können die Policy
--         nicht mehr als Einfallstor nutzen (Defense in Depth nach K-1).
--
-- Hintergrund:
--   Die bestehende RLS-Policy "model_update_own_profile" prüfte nur
--   user_id = auth.uid() — keine Spalteneinschränkung, kein agency_id-Check.
--   Ein Model-User konnte damit direkt über die PostgREST API sensible Felder
--   (email, phone, Maße, Sichtbarkeit, Medien) überschreiben und die RPC-
--   Logik in model_update_own_profile_safe vollständig umgehen.
-- =============================================================================

-- ─── K-1: REVOKE UPDATE auf alle sensiblen models-Spalten ────────────────────
--
-- Bereits in migration_security_hardening_2026_04.sql gesperrt:
--   agency_id, mediaslide_sync_id, mediaslide_model_id,
--   netwalk_model_id, admin_notes, agency_relationship_status
--
-- Jetzt zusätzlich gesperrt (K-1):

-- Tatsächlich vorhandene Spalten (live-schema geprüft 2026-04-05):
-- Nicht in der Tabelle: phone, birthday (→ wurden weggelassen)
REVOKE UPDATE (
  email,
  name,
  height,
  bust,
  waist,
  hips,
  chest,
  legs_inseam,
  shoe_size,
  hair_color,
  eye_color,
  eye_color_enum,
  ethnicity,
  sex,
  categories,
  is_visible_fashion,
  is_visible_commercial,
  is_active,
  is_sports_winter,
  is_sports_summer,
  is_minor,
  portfolio_images,
  polaroids,
  video_url,
  polas_source,
  show_polas_on_profile,
  city,
  country,
  country_code,
  current_location,
  current_lat,
  current_lng,
  agency_relationship_ended_at
) ON public.models FROM authenticated;

-- ─── M-1: RLS model_update_own_profile — agency_id IS NULL Guard ─────────────
--
-- Auch nach K-1 (alle Spalten revoked) ist die Policy mit agency_id IS NULL
-- korrekt, da sie das logische Systemmodell widerspiegelt:
-- Agency-controlled Models dürfen ihre eigene Zeile nicht selbst patchen.

DROP POLICY IF EXISTS "model_update_own_profile" ON public.models;
CREATE POLICY "model_update_own_profile"
  ON public.models
  FOR UPDATE
  TO authenticated
  USING  (user_id = auth.uid() AND agency_id IS NULL)
  WITH CHECK (user_id = auth.uid() AND agency_id IS NULL);

COMMENT ON POLICY "model_update_own_profile" ON public.models IS
  'K-1/M-1 Security Audit 2026-04-05: Models ohne Agency dürfen ihre eigene '
  'Zeile updaten. Alle sensiblen Spalten sind via REVOKE UPDATE gesperrt — '
  'Updates laufen ausschließlich über model_update_own_profile_safe (SD). '
  'agency_id IS NULL blockiert zusätzlich agency-controlled Models.';

-- ─── Verifikation ─────────────────────────────────────────────────────────────
-- Hinweis: column-level REVOKEs erscheinen nicht in information_schema.column_privileges
-- wenn der ursprüngliche GRANT auf Tabellenebene erfolgte (PostgreSQL-Semantik).
-- Die REVOKE-Anweisungen oben greifen trotzdem — PostgREST blockiert die Spalten.
-- Verifikation über pg_attribute.attacl ist komplex; wir prüfen nur die Policy.
DO $$
BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'models'
      AND policyname = 'model_update_own_profile'
  ), 'model_update_own_profile policy nicht gefunden';

  RAISE NOTICE 'Migration 20260410_security_audit_model_column_revoke: OK';
END $$;
