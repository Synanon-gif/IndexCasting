-- Dedupe calendar_export_events_json for ICS + private feed: one visible row per option_request_id
-- Priority: calendar_entries job (entry_type = booking) < calendar_entries option/casting < mirrored user_calendar_events < manual user events.
-- Adds optionRequestId + sourcePriority to JSON for client-side parity; ROW_NUMBER dedupes before jsonb_agg.

CREATE OR REPLACE FUNCTION public.calendar_export_events_json(p_user_id UUID)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
  SELECT COALESCE(
    jsonb_agg(
      deduped.row_data
      ORDER BY deduped.sort_date NULLS LAST, deduped.sort_created NULLS LAST
    ),
    '[]'::jsonb
  )
  FROM (
    SELECT ranked.row_data, ranked.sort_date, ranked.sort_created
    FROM (
      SELECT
        sub.row_data,
        sub.sort_date,
        sub.sort_created,
        ROW_NUMBER() OVER (
          PARTITION BY sub.dedupe_partition
          ORDER BY sub.source_priority ASC, sub.sort_date NULLS LAST, sub.sort_created NULLS LAST
        ) AS rn
      FROM (
        SELECT
          jsonb_build_object(
            'kind', 'user_calendar_events',
            'id', e.id,
            'title', e.title,
            'description', COALESCE(e.note, ''),
            'date', e.date::text,
            'startTime', e.start_time,
            'endTime', e.end_time,
            'status', COALESCE(e.status, ''),
            'optionRequestId', e.source_option_request_id,
            'sourcePriority', CASE
              WHEN e.source_option_request_id IS NOT NULL THEN 3
              ELSE 4
            END
          ) AS row_data,
          e.date AS sort_date,
          e.created_at AS sort_created,
          CASE
            WHEN e.source_option_request_id IS NOT NULL THEN 'opt:' || e.source_option_request_id::text
            ELSE 'uce:' || e.id::text
          END AS dedupe_partition,
          CASE
            WHEN e.source_option_request_id IS NOT NULL THEN 3
            ELSE 4
          END AS source_priority
        FROM public.user_calendar_events e
        WHERE (e.status IS NULL OR e.status IS DISTINCT FROM 'cancelled')
          AND (
            e.owner_id = p_user_id
            OR e.created_by = p_user_id
            OR (
              e.organization_id IS NOT NULL
              AND EXISTS (
                SELECT 1
                FROM public.organization_members om
                WHERE om.user_id = p_user_id
                  AND om.organization_id = e.organization_id
              )
            )
          )
        UNION ALL
        SELECT
          jsonb_build_object(
            'kind', 'calendar_entries',
            'id', ce.id,
            'title', COALESCE(ce.title, ce.entry_type, 'Booking'),
            'description', COALESCE(ce.client_name, ''),
            'date', ce.date::text,
            'startTime', CASE WHEN ce.start_time IS NULL THEN NULL ELSE ce.start_time::text END,
            'endTime', CASE WHEN ce.end_time IS NULL THEN NULL ELSE ce.end_time::text END,
            'status', ce.status,
            'optionRequestId', ce.option_request_id,
            'sourcePriority', CASE
              WHEN ce.entry_type::text = 'booking' THEN 1
              ELSE 2
            END
          ) AS row_data,
          ce.date AS sort_date,
          ce.created_at AS sort_created,
          CASE
            WHEN ce.option_request_id IS NOT NULL THEN 'opt:' || ce.option_request_id::text
            ELSE 'ce:' || ce.id::text
          END AS dedupe_partition,
          CASE
            WHEN ce.entry_type::text = 'booking' THEN 1
            ELSE 2
          END AS source_priority
        FROM public.calendar_entries ce
        WHERE (ce.status IS NULL OR ce.status IS DISTINCT FROM 'cancelled')
          AND (
            EXISTS (
              SELECT 1 FROM public.models m
              WHERE m.id = ce.model_id AND m.user_id = p_user_id
            )
            OR EXISTS (
              SELECT 1 FROM public.option_requests orq
              WHERE orq.id = ce.option_request_id
                AND (
                  orq.client_id = p_user_id
                  OR orq.created_by = p_user_id
                  OR orq.booker_id = p_user_id
                  OR orq.agency_assignee_user_id = p_user_id
                  OR EXISTS (
                    SELECT 1 FROM public.models mo
                    WHERE mo.id = orq.model_id AND mo.user_id = p_user_id
                  )
                )
            )
          )
      ) sub
    ) ranked
    WHERE ranked.rn = 1
  ) deduped;
$$;

REVOKE ALL ON FUNCTION public.calendar_export_events_json(UUID) FROM PUBLIC;

COMMENT ON FUNCTION public.calendar_export_events_json(UUID) IS
  'Internal: merged user_calendar_events + calendar_entries for ICS/export. Dedupes by optionRequestId with job>option>mirror>manual priority. Not exposed via PostgREST.';
