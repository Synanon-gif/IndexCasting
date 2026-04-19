/**
 * Outbound calendar sync to Mediaslide / Netwalk for confirmed bookings.
 *
 * Strategy (Outbox + best-effort direct push):
 *   1. For each provider where the model has a sync_id AND the agency has an API key:
 *      a) Enqueue the operation in `external_sync_outbox` (transactional reliability —
 *         idempotency key prevents duplicates if confirmed twice or if the cron worker
 *         runs concurrently).
 *      b) Best-effort direct push via the connector. On success → mark outbox row as
 *         sent. On failure → leave row pending; the cron worker will retry.
 *   2. Caller invokes this function fire-and-forget (`void syncConfirmedBooking…(…)`).
 *
 * GDPR: only transmits booking date/time + status (no PII beyond what the agency
 * already shares with the external system per its existing model contract).
 *
 * Live network calls happen only when EXPO_PUBLIC_MEDIASLIDE_API_URL /
 * EXPO_PUBLIC_NETWALK_API_URL are configured. Otherwise the connectors return
 * mock success and the outbox row is still recorded for audit.
 */

import { supabase } from '../../lib/supabase';
import type { CalendarEntry } from './calendarSupabase';
import { getAgencyApiKeys } from './agencySettingsSupabase';
import { pushAvailabilityToMediaslide } from './mediaslideConnector';
import { pushAvailabilityToNetwalk } from './netwalkConnector';
import { logMediaslideError } from './mediaslideSyncService';

export type ExternalSyncResult = {
  mediaslide: 'skipped' | 'ok' | 'error';
  netwalk: 'skipped' | 'ok' | 'error';
};

type Provider = 'mediaslide' | 'netwalk';

/** Payload shape we send to the remote `availability` endpoint. */
type AvailabilityPushPayload = {
  blocked: Array<{
    date: string;
    start_time: string | null;
    end_time: string | null;
    title: string | null;
    booking_id: string | null;
    /** Stable local ID so the remote system can dedupe on its side. */
    local_calendar_entry_id: string;
    status: 'tentative' | 'booked' | 'cancelled';
  }>;
};

function buildPayload(entry: CalendarEntry): AvailabilityPushPayload {
  // Map our entry status to the remote semantics.
  // 'booked' / 'tentative' → block out; 'cancelled' → release.
  const remoteStatus: 'tentative' | 'booked' | 'cancelled' =
    entry.status === 'cancelled'
      ? 'cancelled'
      : entry.status === 'tentative'
        ? 'tentative'
        : 'booked';

  return {
    blocked: [
      {
        date: entry.date,
        start_time: entry.start_time ?? null,
        end_time: entry.end_time ?? null,
        title: entry.title ?? null,
        booking_id: entry.booking_id ?? null,
        local_calendar_entry_id: entry.id,
        status: remoteStatus,
      },
    ],
  };
}

async function enqueueOutbox(args: {
  agencyId: string;
  modelId: string;
  provider: Provider;
  payload: AvailabilityPushPayload;
  idempotencyKey: string;
}): Promise<{ ok: boolean; rowId: string | null }> {
  const { agencyId, modelId, provider, payload, idempotencyKey } = args;
  try {
    const { data, error } = await supabase.rpc('enqueue_external_sync_outbox', {
      p_agency_id: agencyId,
      p_model_id: modelId,
      p_provider: provider,
      p_operation: 'push_availability',
      p_payload: payload,
      p_idempotency_key: idempotencyKey,
    });
    if (error) {
      console.error('[externalCalendarSync] enqueueOutbox error', provider, error);
      return { ok: false, rowId: null };
    }
    return { ok: true, rowId: typeof data === 'string' ? data : null };
  } catch (e) {
    console.error('[externalCalendarSync] enqueueOutbox exception', provider, e);
    return { ok: false, rowId: null };
  }
}

async function markOutboxSent(rowId: string | null): Promise<void> {
  if (!rowId) return;
  try {
    const { error } = await supabase.rpc('mark_external_sync_outbox_sent', { p_id: rowId });
    if (error) console.error('[externalCalendarSync] markOutboxSent error', error);
  } catch (e) {
    console.error('[externalCalendarSync] markOutboxSent exception', e);
  }
}

async function markOutboxFailed(rowId: string | null, errorMessage: string): Promise<void> {
  if (!rowId) return;
  try {
    const { error } = await supabase.rpc('mark_external_sync_outbox_failed', {
      p_id: rowId,
      p_error: errorMessage.slice(0, 1000),
    });
    if (error) console.error('[externalCalendarSync] markOutboxFailed error', error);
  } catch (e) {
    console.error('[externalCalendarSync] markOutboxFailed exception', e);
  }
}

async function pushOne(args: {
  provider: Provider;
  remoteModelId: string;
  agencyId: string;
  modelId: string;
  apiKey: string | null;
  payload: AvailabilityPushPayload;
  entryId: string;
}): Promise<'ok' | 'error'> {
  const { provider, remoteModelId, agencyId, modelId, apiKey, payload, entryId } = args;

  // Idempotency: per (provider, calendar_entry, status) — same entry confirmed/cancelled twice
  // will not enqueue twice while the previous row is pending or sent.
  const idempotencyKey = `booking:${entryId}:${payload.blocked[0]?.status ?? 'unknown'}`;

  const enq = await enqueueOutbox({
    agencyId,
    modelId,
    provider,
    payload,
    idempotencyKey,
  });

  // Audit-Gap closure: when the outbox enqueue fails (no row created) but we still
  // attempt a direct push, every outcome MUST emit an explicit operational log so
  // the missing audit row is reconcilable. Without this, an enq-fail + push-success
  // would silently leave external state diverged from local audit trail.
  const auditMissingOutbox = !enq.ok || !enq.rowId;

  // Best-effort direct push regardless of enqueue outcome (idempotency key dedupes).
  try {
    const pushFn =
      provider === 'mediaslide' ? pushAvailabilityToMediaslide : pushAvailabilityToNetwalk;
    const res = await pushFn(remoteModelId, payload, apiKey ?? undefined);
    if (res?.ok) {
      if (enq.rowId) {
        await markOutboxSent(enq.rowId);
      } else {
        // Direct push succeeded but no outbox audit row exists.
        // Log so admins can reconcile (the remote system has the change, our
        // external_sync_outbox table does not record it for this attempt).
        await logMediaslideError({
          operation: `push_availability_${provider}_no_outbox_row`,
          modelId,
          mediaslideId: provider === 'mediaslide' ? remoteModelId : null,
          message:
            'Direct push succeeded but enqueue_external_sync_outbox failed — no outbox audit row.',
          details: { idempotencyKey, status: payload.blocked[0]?.status ?? null },
        });
      }
      return 'ok';
    }
    const notOkMsg = `${provider} push returned not-ok`;
    if (enq.rowId) {
      await markOutboxFailed(enq.rowId, notOkMsg);
    } else if (auditMissingOutbox) {
      await logMediaslideError({
        operation: `push_availability_${provider}_no_outbox_row`,
        modelId,
        mediaslideId: provider === 'mediaslide' ? remoteModelId : null,
        message: `${notOkMsg} (enqueue_external_sync_outbox also failed — no audit row)`,
        details: { idempotencyKey, status: payload.blocked[0]?.status ?? null },
      });
    }
    return 'error';
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : `${provider} push threw`;
    await markOutboxFailed(enq.rowId, message);
    await logMediaslideError({
      operation: auditMissingOutbox
        ? `push_availability_${provider}_no_outbox_row`
        : `push_availability_${provider}`,
      modelId,
      mediaslideId: provider === 'mediaslide' ? remoteModelId : null,
      message,
      details: { error: e instanceof Error ? (e.stack ?? e.message) : String(e), idempotencyKey },
    });
    return 'error';
  }
}

/**
 * Sync a confirmed booking (or cancellation) to all configured external calendars.
 * Fire-and-forget: callers should not await the result for UX flow control.
 *
 * @param entry   Local calendar entry (after upgrade to job/booked or after cancellation).
 * @param context Agency + remote model IDs. If a remote ID is missing, that provider is skipped.
 */
export async function syncConfirmedBookingToExternalCalendars(
  entry: CalendarEntry,
  context: { agencyId: string; modelMediaslideId?: string | null; modelNetwalkId?: string | null },
): Promise<ExternalSyncResult> {
  const result: ExternalSyncResult = { mediaslide: 'skipped', netwalk: 'skipped' };
  const { agencyId, modelMediaslideId, modelNetwalkId } = context;

  if (!agencyId) {
    console.warn('[externalCalendarSync] missing agencyId — skipped');
    return result;
  }

  const hasMediaslide = !!modelMediaslideId;
  const hasNetwalk = !!modelNetwalkId;

  if (!hasMediaslide && !hasNetwalk) {
    return result; // No external linkage on this model.
  }

  const keys = await getAgencyApiKeys(agencyId);
  // No keys row = agency hasn't configured any provider; treat as skip.
  if (!keys) return result;

  const payload = buildPayload(entry);

  if (hasMediaslide && keys.mediaslide_connected) {
    result.mediaslide = await pushOne({
      provider: 'mediaslide',
      remoteModelId: modelMediaslideId as string,
      agencyId,
      modelId: entry.model_id,
      apiKey: keys.mediaslide_api_key,
      payload,
      entryId: entry.id,
    });
  }

  if (hasNetwalk && keys.netwalk_connected) {
    result.netwalk = await pushOne({
      provider: 'netwalk',
      remoteModelId: modelNetwalkId as string,
      agencyId,
      modelId: entry.model_id,
      apiKey: keys.netwalk_api_key,
      payload,
      entryId: entry.id,
    });
  }

  return result;
}

/**
 * High-level helper for store hooks: given an option_request_id, resolves the
 * active calendar entry, the agency_id and the model's external sync IDs, then
 * delegates to {@link syncConfirmedBookingToExternalCalendars}.
 *
 * Use this from confirm flows ({@link clientConfirmJobStore},
 * {@link agencyConfirmJobAgencyOnlyStore}) AFTER the calendar entry was upgraded
 * to a job. Fire-and-forget — never block the UI on this.
 *
 * For cancellations call {@link syncOptionRequestCancellationToExternal}
 * BEFORE deleting the calendar row, so the snapshot can still be read.
 */
export async function syncOptionRequestConfirmationToExternal(
  optionRequestId: string,
): Promise<ExternalSyncResult> {
  const skipped: ExternalSyncResult = { mediaslide: 'skipped', netwalk: 'skipped' };

  try {
    // Active (non-cancelled) calendar row for this option-request — Invariant N.
    const { data: rows, error: rowsErr } = await supabase
      .from('calendar_entries')
      .select(
        'id, model_id, date, start_time, end_time, title, entry_type, status, booking_id, note, created_at, option_request_id, client_name, booking_details',
      )
      .eq('option_request_id', optionRequestId)
      .neq('status', 'cancelled')
      .order('created_at', { ascending: false })
      .limit(1);

    if (rowsErr) {
      console.error('[externalCalendarSync] calendar lookup error', optionRequestId, rowsErr);
      return skipped;
    }

    const entry = (rows ?? [])[0] as CalendarEntry | undefined;
    if (!entry) {
      // No active calendar row — nothing to mirror externally.
      return skipped;
    }

    const { data: modelRow, error: modelErr } = await supabase
      .from('models')
      .select('agency_id, mediaslide_sync_id, netwalk_model_id')
      .eq('id', entry.model_id)
      .maybeSingle();

    if (modelErr || !modelRow) {
      console.error('[externalCalendarSync] model lookup error', entry.model_id, modelErr);
      return skipped;
    }

    const m = modelRow as {
      agency_id: string | null;
      mediaslide_sync_id: string | null;
      netwalk_model_id: string | null;
    };

    if (!m.agency_id) return skipped;

    return await syncConfirmedBookingToExternalCalendars(entry, {
      agencyId: m.agency_id,
      modelMediaslideId: m.mediaslide_sync_id,
      modelNetwalkId: m.netwalk_model_id,
    });
  } catch (e) {
    console.error('[externalCalendarSync] syncOptionRequestConfirmationToExternal exception', e);
    return skipped;
  }
}

/**
 * Cancellation variant — must be called BEFORE delete_option_request_full so the
 * calendar row snapshot can still be read. Pushes a 'cancelled' status to the
 * external calendars so the remote block-out is released.
 */
export async function syncOptionRequestCancellationToExternal(
  optionRequestId: string,
): Promise<ExternalSyncResult> {
  const skipped: ExternalSyncResult = { mediaslide: 'skipped', netwalk: 'skipped' };

  try {
    // For cancellations we look at all rows (including already-cancelled ones)
    // because the trigger may have flipped the status before this helper runs.
    const { data: rows, error: rowsErr } = await supabase
      .from('calendar_entries')
      .select(
        'id, model_id, date, start_time, end_time, title, entry_type, status, booking_id, note, created_at, option_request_id, client_name, booking_details',
      )
      .eq('option_request_id', optionRequestId)
      .order('created_at', { ascending: false })
      .limit(1);

    if (rowsErr) {
      console.error(
        '[externalCalendarSync] cancel calendar lookup error',
        optionRequestId,
        rowsErr,
      );
      return skipped;
    }

    const raw = (rows ?? [])[0] as CalendarEntry | undefined;
    if (!raw) return skipped;

    // Force the payload to 'cancelled' regardless of the row's current status.
    const entry: CalendarEntry = { ...raw, status: 'cancelled' };

    const { data: modelRow, error: modelErr } = await supabase
      .from('models')
      .select('agency_id, mediaslide_sync_id, netwalk_model_id')
      .eq('id', entry.model_id)
      .maybeSingle();

    if (modelErr || !modelRow) return skipped;

    const m = modelRow as {
      agency_id: string | null;
      mediaslide_sync_id: string | null;
      netwalk_model_id: string | null;
    };

    if (!m.agency_id) return skipped;

    return await syncConfirmedBookingToExternalCalendars(entry, {
      agencyId: m.agency_id,
      modelMediaslideId: m.mediaslide_sync_id,
      modelNetwalkId: m.netwalk_model_id,
    });
  } catch (e) {
    console.error('[externalCalendarSync] syncOptionRequestCancellationToExternal exception', e);
    return skipped;
  }
}
