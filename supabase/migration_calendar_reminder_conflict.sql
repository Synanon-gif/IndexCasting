-- =============================================================================
-- Calendar: reminder_at column + conflict detection RPC
--
-- 1. Adds reminder_at to user_calendar_events (nullable, opt-in).
-- 2. Adds check_calendar_conflict RPC for calendar_entries (model schedule).
-- =============================================================================

-- ─── 1. reminder_at on user_calendar_events ───────────────────────────────────

ALTER TABLE public.user_calendar_events
  ADD COLUMN IF NOT EXISTS reminder_at TIMESTAMPTZ DEFAULT NULL;

COMMENT ON COLUMN public.user_calendar_events.reminder_at IS
  'Optional in-app reminder timestamp. NULL = no reminder.';

-- ─── 2. RPC: check_calendar_conflict ─────────────────────────────────────────
-- Checks whether a model already has a confirmed/option calendar entry that
-- overlaps the proposed [p_start, p_end] window.
-- Returns a jsonb with { has_conflict: bool, conflicting_entries: [...] }.
-- Used client-side to warn before inserting (never blocks server-side).

CREATE OR REPLACE FUNCTION public.check_calendar_conflict(
  p_model_id uuid,
  p_date     date,
  p_start    time,
  p_end      time
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entries jsonb;
  v_count   integer;
BEGIN
  -- Any authenticated user who can see the model's calendar may check conflicts.
  -- Actual access control on writes remains in RLS on calendar_entries.

  SELECT
    COUNT(*),
    jsonb_agg(jsonb_build_object(
      'id',         ce.id,
      'entry_type', ce.entry_type,
      'start_time', ce.start_time,
      'end_time',   ce.end_time,
      'title',      ce.title
    ))
  INTO v_count, v_entries
  FROM public.calendar_entries ce
  WHERE ce.model_id = p_model_id
    AND ce.date     = p_date
    AND ce.entry_type IN ('option', 'casting', 'job')  -- personal entries don't block
    AND (
      -- Overlap condition: [start, end] intervals intersect
      ce.start_time IS NULL OR ce.end_time IS NULL
      -- If times are set, check overlap: A.start < B.end AND A.end > B.start
      OR (
        ce.start_time < COALESCE(p_end, '23:59:59'::time)
        AND ce.end_time > COALESCE(p_start, '00:00:00'::time)
      )
    );

  RETURN jsonb_build_object(
    'has_conflict',        v_count > 0,
    'conflicting_entries', COALESCE(v_entries, '[]'::jsonb)
  );
END;
$$;

ALTER FUNCTION public.check_calendar_conflict(uuid, date, time, time) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.check_calendar_conflict(uuid, date, time, time) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_calendar_conflict(uuid, date, time, time) TO authenticated;
