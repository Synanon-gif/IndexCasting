-- =============================================================================
-- 20261209c: user_calendar_events — colors must match the calendar legend per
--            request_type, for BOTH parties.
--
-- WHY: 20260716_sync_user_calendars_on_option_confirmed.sql hard-coded
--   client row → '#1565C0'  (casting blue)
--   agency row → '#2E7D32'  (job/booking green)
-- regardless of whether the underlying option_request is a CASTING or OPTION.
--
-- Symptom reported by user: "Wenn die Agency manuell Option/Casting erstellt,
-- sollten die Farben systemweit zur Farblegende passen."
-- The legend (src/components/CalendarColorLegend.tsx) is:
--   Casting → blue  (#1565C0)
--   Option  → orange(#E65100)
--   Job     → green (#1B5E20)
--   Personal→ grey
-- After job_confirmed, the 20261208 trigger overwrites both rows to green —
-- that part is correct. Pre-job, the colour MUST come from request_type, not
-- from the owner role.
--
-- FIX:
--   1. Re-create sync_user_calendars_on_option_confirmed so BOTH rows use the
--      same colour, derived from NEW.request_type:
--        casting → #1565C0
--        option  → #E65100
--   2. Backfill: every existing user_calendar_events row that points at an
--      option_request whose final_status is NOT 'job_confirmed' AND whose
--      status is not cancelled gets its colour realigned with this rule.
--      (job_confirmed rows are owned by 20261208's trigger and stay green.)
--
-- NOTE: Per CALENDAR_COLORS invariant in src/utils/calendarColors.ts, .booking
-- and .job MUST share the same hex (#1B5E20) — keeping that invariant intact.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.sync_user_calendars_on_option_confirmed()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_color text;
  v_label_prefix text;
BEGIN
  IF NEW.final_status IS DISTINCT FROM 'option_confirmed' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.final_status = 'option_confirmed' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND OLD.final_status IS DISTINCT FROM NEW.final_status) THEN
    -- Colour + label prefix reflect request_type for BOTH parties — must match
    -- the legend in src/components/CalendarColorLegend.tsx.
    IF NEW.request_type = 'casting' THEN
      v_color := '#1565C0';        -- blue
      v_label_prefix := 'Casting – ';
    ELSE
      v_color := '#E65100';        -- orange
      v_label_prefix := 'Option – ';
    END IF;

    INSERT INTO public.user_calendar_events (
      owner_id, owner_type, date, start_time, end_time, title, color, note, source_option_request_id
    ) VALUES (
      NEW.client_id,
      'client',
      NEW.requested_date,
      NEW.start_time,
      NEW.end_time,
      v_label_prefix || COALESCE(NULLIF(NEW.model_name, ''), 'Model'),
      v_color,
      'Synced booking. Shared notes are stored in the app (calendar entry / booking details).',
      NEW.id
    )
    ON CONFLICT DO NOTHING;

    INSERT INTO public.user_calendar_events (
      owner_id, owner_type, date, start_time, end_time, title, color, note, source_option_request_id
    ) VALUES (
      NEW.agency_id,
      'agency',
      NEW.requested_date,
      NEW.start_time,
      NEW.end_time,
      v_label_prefix || COALESCE(
        NULLIF(NEW.client_organization_name, ''),
        NULLIF(NEW.client_name, ''),
        'Client'
      ),
      v_color,
      'Synced booking. Shared notes are stored in the app (calendar entry / booking details).',
      NEW.id
    )
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

-- ─── Backfill existing rows (only the option_confirmed / pre-job stage) ──────
UPDATE public.user_calendar_events uce
SET color = CASE WHEN orq.request_type = 'casting' THEN '#1565C0' ELSE '#E65100' END,
    title = CASE
      WHEN orq.request_type = 'casting' THEN 'Casting – '
      ELSE 'Option – '
    END
    || CASE
      WHEN uce.owner_type = 'client'
        THEN COALESCE(NULLIF(orq.model_name, ''), 'Model')
      ELSE COALESCE(
        NULLIF(orq.client_organization_name, ''),
        NULLIF(orq.client_name, ''),
        'Client'
      )
    END
FROM public.option_requests orq
WHERE uce.source_option_request_id = orq.id
  AND COALESCE(uce.status, 'active') <> 'cancelled'
  AND orq.final_status IS DISTINCT FROM 'job_confirmed'
  AND uce.owner_type IN ('client', 'agency');

-- ─── Verify ──────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'sync_user_calendars_on_option_confirmed';

  ASSERT v_def IS NOT NULL,
    'FAIL: sync_user_calendars_on_option_confirmed missing after 20261209c';
  ASSERT v_def ILIKE '%E65100%',
    'FAIL: sync_user_calendars_on_option_confirmed must set option-orange (#E65100) for option request_type';
  ASSERT v_def ILIKE '%1565C0%',
    'FAIL: sync_user_calendars_on_option_confirmed must keep casting-blue (#1565C0) for casting request_type';
  -- guard: must NOT keep the old hard-coded agency-green for the pre-job row
  -- (#2E7D32 at top-level, NOT inside the job-stage trigger). We loosen this:
  -- ensure the only literal colours referenced are the casting+option ones.
  ASSERT v_def NOT ILIKE '%''#2E7D32''%',
    'FAIL: sync_user_calendars_on_option_confirmed still hard-codes agency green (#2E7D32) — must derive colour from request_type';
END;
$$;
