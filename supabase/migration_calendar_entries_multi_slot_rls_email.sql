-- =============================================================================
-- Kalender: mehrere Einträge pro Model/Tag + user_calendar_events RLS robuster
-- Im Supabase SQL Editor ausführen.
-- =============================================================================

-- 1) UNIQUE(model_id, date) verhinderte mehrere persönliche Slots / Zeilen pro Tag
ALTER TABLE public.calendar_entries DROP CONSTRAINT IF EXISTS calendar_entries_model_id_date_key;

-- (Optional) Ein Eintrag pro Option: bei Bedarf manuell prüfen, ob Duplikate existieren, dann:
-- CREATE UNIQUE INDEX uq_calendar_entries_option_request ON public.calendar_entries (option_request_id)
--   WHERE option_request_id IS NOT NULL;

-- 2) Agentur-Zugriff: E-Mail case-insensitive + trim (Login-E-Mail ≠ Agentur-Eintrag)
DROP POLICY IF EXISTS "Users can manage own calendar events" ON public.user_calendar_events;

CREATE POLICY "Users can manage own calendar events"
  ON public.user_calendar_events FOR ALL
  TO authenticated
  USING (
    (owner_type = 'client' AND owner_id = auth.uid())
    OR
    (
      owner_type = 'agency'
      AND EXISTS (
        SELECT 1
        FROM public.agencies a
        JOIN public.profiles p ON p.id = auth.uid()
        WHERE p.role = 'agent'
          AND a.id = owner_id
          AND NULLIF(trim(lower(COALESCE(a.email, ''))), '') IS NOT NULL
          AND NULLIF(trim(lower(COALESCE(p.email, ''))), '') IS NOT NULL
          AND trim(lower(a.email)) = trim(lower(p.email))
      )
    )
  )
  WITH CHECK (
    (owner_type = 'client' AND owner_id = auth.uid())
    OR
    (
      owner_type = 'agency'
      AND EXISTS (
        SELECT 1
        FROM public.agencies a
        JOIN public.profiles p ON p.id = auth.uid()
        WHERE p.role = 'agent'
          AND a.id = owner_id
          AND NULLIF(trim(lower(COALESCE(a.email, ''))), '') IS NOT NULL
          AND NULLIF(trim(lower(COALESCE(p.email, ''))), '') IS NOT NULL
          AND trim(lower(a.email)) = trim(lower(p.email))
      )
    )
  );
