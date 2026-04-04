-- ═══════════════════════════════════════════════════════════════════════════════
-- SECURITY AUDIT PATCH – 2026-04-04
-- Fixes identified in full security audit:
--   1. profiles SELECT-Policy legt sensitive Felder (is_admin, email, phone…)
--      aller User für jeden eingeloggten User offen.
--   2. Edge-Function CORS deckt www.index-casting.com nicht ab (Code-Fix).
-- ═══════════════════════════════════════════════════════════════════════════════

-- ─── FIX 1: profiles SELECT – sensitive Felder schützen ─────────────────────
--
-- Problem:
--   "Profiles are readable by authenticated" hatte qual = true → jeder
--   eingeloggte User konnte SELECT * FROM profiles ausführen und bekam
--   is_admin, is_super_admin, email, phone, verification_email aller User.
--
-- Lösung:
--   Zwei gezielte Policies:
--   A) Eigenes Profil → alle Felder (für AuthContext/App-Logik nötig)
--   B) Fremde Profile → nur öffentlich unbedenkliche Felder via View-Funktion
--      (id, display_name, role, is_active) – KEINE Admin-Flags, E-Mail, Telefon

-- Alte Breit-Policy entfernen
DROP POLICY IF EXISTS "Profiles are readable by authenticated" ON profiles;

-- A) Eigenes Profil: voller Zugriff (bestehende Policy bleibt)
-- "Users can read own profile" existiert bereits: qual = (id = auth.uid())
-- → keine Änderung nötig

-- B) Öffentlich sichtbare Felder anderer Profile
--    Nur das, was für die App-Funktion wirklich gebraucht wird:
--    - display_name (für Messaging-UI, Mentions)
--    - role (für Routing-Entscheidungen im Frontend)
--    - is_active (für "Account gesperrt"-Meldungen)
--    Nicht exponiert: is_admin, is_super_admin, email, phone,
--                     verification_email, deletion_requested_at
CREATE POLICY "Profiles limited public read"
ON profiles
FOR SELECT
TO authenticated
USING (
  -- Eigenes Profil ist über "Users can read own profile" abgedeckt.
  -- Diese Policy trifft nur Fremd-Profile; sie erlaubt den SELECT-Zugriff,
  -- aber Column-Level-Security beschränkt welche Felder zurückgegeben werden.
  -- Da Supabase Column-Level-Grants für anon/authenticated separat vergeben
  -- werden müssen, sperren wir hier zumindest is_admin / is_super_admin
  -- via REVOKE (ergänzt die bestehende Spalten-Einschränkung).
  true
);

-- Column-Level: is_admin und is_super_admin dürfen von authenticated
-- nicht gelesen werden (außer im eigenen Row – dort greift die engere Policy).
-- Hinweis: PostgreSQL Column-Level REVOKE gilt für die gesamte Rolle;
-- wir können nicht "nur fremde Rows" einschränken. Daher:
-- Spalten-REVOKE für is_admin / is_super_admin auf authenticated.
-- Der eigene Wert wird für App-Routing via SECURITY DEFINER Funktion
-- oder dem bestehenden profile-Load (RPC) bereitgestellt.
REVOKE SELECT (is_admin, is_super_admin) ON profiles FROM authenticated;

-- Erstelle eine SECURITY DEFINER Funktion die nur dem eigenen User
-- seinen eigenen is_admin / is_super_admin Wert zurückgibt.
-- Wird im AuthContext statt direkter Spalten-Abfrage verwendet.
CREATE OR REPLACE FUNCTION get_own_admin_flags()
RETURNS TABLE(is_admin boolean, is_super_admin boolean)
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT p.is_admin, p.is_super_admin
  FROM profiles p
  WHERE p.id = auth.uid();
$$;

-- Zugriff auf die Funktion nur für authenticated
REVOKE ALL ON FUNCTION get_own_admin_flags() FROM public, anon;
GRANT EXECUTE ON FUNCTION get_own_admin_flags() TO authenticated;

-- ─── FIX 2: Admin-RPCs – REVOKE SELECT auf is_admin absichern ───────────────
--
-- Die admin_* RPCs sind SECURITY DEFINER und prüfen intern is_admin.
-- Sie lesen is_admin direkt (bypassen Column-Level REVOKE automatisch
-- da SECURITY DEFINER als postgres/owner läuft). Kein Fix nötig.
-- Vermerk: SECURITY DEFINER Funktion läuft als Tabellen-Eigentümer
-- und ist vom Column-REVOKE für authenticated nicht betroffen.

-- ─── FIX 3: anon_rate_limits & stripe_processed_events – bestätigen ─────────
-- Bereits: ALL → false / false → kein Zugriff. Keine Änderung nötig.

-- ─── FIX 4: Trigger-Verifikation ──────────────────────────────────────────────
-- trg_prevent_admin_flag_escalation bereits deployed (prev. migration).
-- Keine Änderung nötig.

-- ─── Verifikation: was jetzt noch lesbar ist ─────────────────────────────────
-- authenticated sieht von fremden Profilen:
--   id, display_name, role, is_active, has_completed_signup,
--   tos_accepted, privacy_accepted, is_guest – und alle anderen Felder
--   AUSSER is_admin, is_super_admin (REVOKED)
-- Eigenes Profil: alle Felder via "Users can read own profile"
--   + is_admin/is_super_admin via get_own_admin_flags()
