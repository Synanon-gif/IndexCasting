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
      .eq('agency_id', agencyId)
      .in('id', unique)
      .or(
        'agency_relationship_status.is.null,agency_relationship_status.eq.active,agency_relationship_status.eq.pending_link',
      );

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

export async function filterBookingEventsForAgencyActiveRepresentation(
  events: BookingEvent[],
  agencyId: string | null | undefined,
): Promise<BookingEvent[]> {
  if (!agencyId?.trim() || events.length === 0) {
    return events;
  }
  const modelIds = events.map((e) => e.model_id).filter(Boolean) as string[];
  const active = await getActivelyRepresentedModelIdsForAgency(agencyId, modelIds);
  return events.filter((e) => !e.model_id || active.has(e.model_id));
}
