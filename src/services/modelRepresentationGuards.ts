/**
 * Defense-in-depth: agency calendar and related surfaces MUST NOT show rows for models
 * whose representation with this agency has ended (no MAT + relationship not active).
 *
 * ALL agency-scoped calendar merges that tie events to models should filter through
 * getActivelyRepresentedModelIdsForAgency / isModelActivelyRepresented — do not rely
 * on a single call site.
 */
import { supabase } from '../../lib/supabase';
import type { BookingEvent } from './bookingEventsSupabase';
import type { UserCalendarEvent } from './userCalendarEventsSupabase';

const AGENCY_ROSTER_RELATIONSHIP_OR =
  'agency_relationship_status.is.null,agency_relationship_status.eq.active,agency_relationship_status.eq.pending_link';

export async function getActivelyRepresentedModelIdsForAgency(
  agencyId: string,
  modelIds: string[],
): Promise<Set<string>> {
  const unique = [...new Set(modelIds.filter((id) => Boolean(id?.trim())))];
  if (!agencyId?.trim() || unique.length === 0) {
    return new Set();
  }
  try {
    const { data: models, error: mErr } = await supabase
      .from('models')
      .select('id')
      .in('id', unique)
      .or(AGENCY_ROSTER_RELATIONSHIP_OR);

    if (mErr) {
      console.error('[modelRepresentationGuards] models query error:', mErr);
      return new Set();
    }
    const statusOk = new Set((models ?? []).map((m) => m.id as string));

    const { data: mats, error: matErr } = await supabase
      .from('model_agency_territories')
      .select('model_id')
      .eq('agency_id', agencyId)
      .in('model_id', [...statusOk]);

    if (matErr) {
      console.error('[modelRepresentationGuards] MAT query error:', matErr);
      return new Set();
    }
    return new Set(
      (mats ?? []).map((m) => m.model_id as string).filter((id) => id && statusOk.has(id)),
    );
  } catch (e) {
    console.error(
      '[modelRepresentationGuards] getActivelyRepresentedModelIdsForAgency exception:',
      e,
    );
    return new Set();
  }
}

export async function isModelActivelyRepresented(
  modelId: string,
  agencyId: string,
): Promise<boolean> {
  const s = await getActivelyRepresentedModelIdsForAgency(agencyId, [modelId]);
  return s.has(modelId);
}

/**
 * Calendar/booking merge: MAT + relationship (roster parity), plus home-agency models
 * (`models.agency_id`) that can receive `agency_create_option_request` without a MAT row.
 */
export async function getActivelyRepresentedModelIdsForAgencyCalendar(
  agencyId: string,
  modelIds: string[],
): Promise<Set<string>> {
  const base = await getActivelyRepresentedModelIdsForAgency(agencyId, modelIds);
  const missing = modelIds.filter((id) => id?.trim() && !base.has(id));
  if (!agencyId?.trim() || missing.length === 0) {
    return base;
  }
  try {
    const { data, error } = await supabase
      .from('models')
      .select('id')
      .eq('agency_id', agencyId)
      .in('id', missing)
      .or(AGENCY_ROSTER_RELATIONSHIP_OR);
    if (error) {
      console.error(
        '[modelRepresentationGuards] getActivelyRepresentedModelIdsForAgencyCalendar home-agency fallback error:',
        error,
      );
      return base;
    }
    for (const row of data ?? []) {
      const id = row.id as string;
      if (id) base.add(id);
    }
  } catch (e) {
    console.error(
      '[modelRepresentationGuards] getActivelyRepresentedModelIdsForAgencyCalendar exception:',
      e,
    );
  }
  return base;
}

export async function filterBookingEventsForAgencyActiveRepresentation(
  events: BookingEvent[],
  agencyId: string | null | undefined,
): Promise<BookingEvent[]> {
  if (!agencyId?.trim() || events.length === 0) {
    return events;
  }
  const modelIds = events.map((e) => e.model_id).filter(Boolean) as string[];
  const active = await getActivelyRepresentedModelIdsForAgencyCalendar(agencyId, modelIds);
  return events.filter((e) => !e.model_id || active.has(e.model_id));
}

/**
 * Drops mirrored `user_calendar_events` (source_option_request_id set) when the linked
 * model is no longer actively represented for this agency — same rule as
 * getCalendarEntriesForAgency. Pure manual rows (no source_option_request_id) are kept.
 */
export async function filterManualCalendarEventsForAgencyActiveRepresentation(
  events: UserCalendarEvent[],
  agencyEntityId: string | null | undefined,
): Promise<UserCalendarEvent[]> {
  if (!agencyEntityId?.trim() || events.length === 0) {
    return events;
  }
  const mirrors = events.filter((e) => Boolean(e.source_option_request_id?.trim()));
  const pureManual = events.filter((e) => !e.source_option_request_id?.trim());
  if (mirrors.length === 0) {
    return events;
  }
  const optionIds = [...new Set(mirrors.map((e) => e.source_option_request_id as string))];
  try {
    const { data: opts, error } = await supabase
      .from('option_requests')
      .select('id, model_id')
      .eq('agency_id', agencyEntityId)
      .in('id', optionIds);
    if (error) {
      console.error(
        '[modelRepresentationGuards] filterManualCalendarEvents option_requests error:',
        error,
      );
      return events;
    }
    const optionIdToModelId = new Map<string, string>();
    for (const row of opts ?? []) {
      const id = row.id as string;
      const mid = row.model_id as string | null;
      if (id && mid) optionIdToModelId.set(id, mid);
    }
    const modelIds = [...new Set([...optionIdToModelId.values()])];
    const active = await getActivelyRepresentedModelIdsForAgencyCalendar(agencyEntityId, modelIds);
    const keptMirrors = mirrors.filter((e) => {
      const oid = e.source_option_request_id as string;
      const mid = optionIdToModelId.get(oid);
      if (!mid) return false;
      return active.has(mid);
    });
    return [...pureManual, ...keptMirrors].sort(
      (a, b) =>
        a.date.localeCompare(b.date) || (a.start_time ?? '').localeCompare(b.start_time ?? ''),
    );
  } catch (e) {
    console.error(
      '[modelRepresentationGuards] filterManualCalendarEventsForAgencyActiveRepresentation exception:',
      e,
    );
    return events;
  }
}
