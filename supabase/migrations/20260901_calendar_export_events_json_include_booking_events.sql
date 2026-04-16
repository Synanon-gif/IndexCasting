-- ICS / calendar feed: include booking_events with priority 0 (see src/constants/calendarSourcePriority.ts).
-- Dedupe partition: opt:<option_request_id> when linked; else be:<booking_event id>.
-- Visibility mirrors GDPR export / RLS intent: creator, linked model user, client org member, agency org member.

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
            'kind', 'booking_events',
            'id', be.id,
            'title', COALESCE(NULLIF(trim(be.title), ''), be.type::text, 'Booking'),
            'description', COALESCE(be.note, ''),
            'date', be.date::text,
            'startTime', NULL,
            'endTime', NULL,
            'status', be.status,
            'optionRequestId', be.source_option_request_id,
            'sourcePriority', 0
          ) AS row_data,
          be.date AS sort_date,
          be.created_at AS sort_created,
          CASE
            WHEN be.source_option_request_id IS NOT NULL THEN 'opt:' || be.source_option_request_id::text
            ELSE 'be:' || be.id::text
          END AS dedupe_partition,
          0 AS source_priority
        FROM public.booking_events be
        WHERE (be.status IS NULL OR be.status IS DISTINCT FROM 'cancelled')
          AND (
            be.created_by = p_user_id
            OR EXISTS (
              SELECT 1 FROM public.models m
              WHERE m.id = be.model_id AND m.user_id = p_user_id
            )
            OR (
              be.client_org_id IS NOT NULL
              AND EXISTS (
                SELECT 1 FROM public.organization_members om
                WHERE om.organization_id = be.client_org_id
                  AND om.user_id = p_user_id
              )
            )
            OR (
              be.agency_org_id IS NOT NULL
              AND EXISTS (
                SELECT 1 FROM public.organization_members om
                WHERE om.organization_id = be.agency_org_id
                  AND om.user_id = p_user_id
              )
            )
          )
        UNION ALL
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
  'Internal: booking_events ∪ user_calendar_events ∪ calendar_entries for ICS/export. '
  'Dedupe by optionRequestId partition; lowest sourcePriority wins. '
  'Numeric priorities MUST match src/constants/calendarSourcePriority.ts: '
  'BOOKING_EVENT=0, CALENDAR_ENTRY_BOOKING=1, CALENDAR_ENTRY_OPTION=2, '
  'USER_CALENDAR_EVENT_MIRROR=3, USER_CALENDAR_EVENT_MANUAL=4. '
  'Not exposed via PostgREST.';
