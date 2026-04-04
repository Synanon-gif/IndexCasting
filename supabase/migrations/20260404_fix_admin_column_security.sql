-- SICHERHEITS-PATCH: Verhindert, dass User sich selbst is_admin / is_super_admin setzen können.
-- Ausgeführt: 2026-04-04

-- 1. Spalten-Level-Rechte: authenticated darf is_admin & is_super_admin NICHT updaten
REVOKE UPDATE (is_admin, is_super_admin) ON profiles FROM authenticated;

-- 2. Trigger als zweite Verteidigungslinie (Defense-in-Depth)
--    Wirft einen Fehler, falls jemand trotzdem versucht, diese Felder via UPDATE zu ändern.
CREATE OR REPLACE FUNCTION prevent_admin_flag_escalation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Änderungen an is_admin / is_super_admin sind nur via service_role erlaubt.
  -- current_setting('role') ist bei normalem anon/authenticated JWT immer 'authenticated'.
  IF (NEW.is_admin IS DISTINCT FROM OLD.is_admin OR NEW.is_super_admin IS DISTINCT FROM OLD.is_super_admin) THEN
    IF current_setting('role') != 'service_role' THEN
      RAISE EXCEPTION 'Forbidden: is_admin and is_super_admin can only be modified by service_role.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- Bestehenden Trigger entfernen falls vorhanden
DROP TRIGGER IF EXISTS trg_prevent_admin_flag_escalation ON profiles;

-- Trigger auf profiles anlegen
CREATE TRIGGER trg_prevent_admin_flag_escalation
  BEFORE UPDATE ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION prevent_admin_flag_escalation();

-- 3. Sicherstellen dass RLS auf profiles aktiv ist
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- 4. Bestehende UPDATE-Policy auf erlaubte Felder einschränken
--    (entfernen + neu anlegen, enger gefasst)
DROP POLICY IF EXISTS "Users can update own profile" ON profiles;

CREATE POLICY "Users can update own profile"
ON profiles
FOR UPDATE
TO authenticated
USING (id = auth.uid())
WITH CHECK (
  id = auth.uid()
  -- is_admin und is_super_admin können via diese Policy nie gesetzt werden
  -- (Column-Level REVOKE + Trigger sind die primären Schutzmechanismen)
);
