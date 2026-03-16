-- =============================================================================
-- Account self-deletion: 30 days archive, then permanent delete
-- Jeder Nutzer (Kunde, Agentur, Model) kann sein Konto selbst zur Löschung
-- anmelden. Daten bleiben 30 Tage archiviert, danach endgültige Löschung.
-- =============================================================================

-- 1. Spalte: Löschwunsch-Datum (gesetzt = Account zur Löschung angemeldet)
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS deletion_requested_at TIMESTAMPTZ;

COMMENT ON COLUMN public.profiles.deletion_requested_at IS 'Wenn gesetzt: Nutzer hat Account-Löschung angefordert. Nach 30 Tagen endgültig löschen (Cron/Edge Function).';

-- 2. Eigenes Konto zur Löschung anmelden (nur eigener User)
CREATE OR REPLACE FUNCTION public.request_account_deletion()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE public.profiles
  SET deletion_requested_at = now(),
      updated_at = now()
  WHERE id = auth.uid();
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  RETURN true;
END;
$$;

-- 2b. Löschwunsch wieder zurückziehen (innerhalb der 30 Tage)
CREATE OR REPLACE FUNCTION public.cancel_account_deletion()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE public.profiles
  SET deletion_requested_at = NULL,
      updated_at = now()
  WHERE id = auth.uid() AND deletion_requested_at IS NOT NULL;
  RETURN FOUND;
END;
$$;

-- 3. Liste der User-IDs, die nach 30 Tagen endgültig gelöscht werden sollen
-- (für Cron/Edge Function: auth.admin.deleteUser(id) aufrufen, dann CASCADE räumt public auf)
CREATE OR REPLACE FUNCTION public.get_accounts_to_purge()
RETURNS TABLE (user_id UUID)
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT id AS user_id
  FROM public.profiles
  WHERE deletion_requested_at IS NOT NULL
    AND deletion_requested_at < (now() - interval '30 days');
$$;

-- Hinweis: Die endgültige Löschung von auth.users erfordert die Supabase Admin API
-- (z.B. scheduled Edge Function: get_accounts_to_purge() aufrufen, dann für jede user_id
-- supabase.auth.admin.deleteUser(user_id) ausführen). CASCADE auf profiles löscht
-- dann alle verknüpften öffentlichen Daten.
