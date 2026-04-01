import { supabase } from '../../lib/supabase';
import { pooledSubscribe } from './realtimeChannelPool';
import { createBookingEvent } from './bookingEventsSupabase';
import type { BookingEventType } from './bookingEventsSupabase';
import { createNotification, createNotifications } from './notificationsSupabase';
import { uiCopy } from '../constants/uiCopy';
import { normalizeInput, validateText, sanitizeHtml, logSecurityEvent } from '../../lib/validation';
import { checkAndIncrementStorage, decrementStorage } from './agencyStorageSupabase';

export const OPTION_REQUEST_SELECT =
  'id, client_id, model_id, agency_id, requested_date, status, project_id, client_name, model_name, proposed_price, agency_counter_price, client_price_status, final_status, request_type, currency, start_time, end_time, model_approval, model_approved_at, model_account_linked, booker_id, organization_id, created_by, agency_assignee_user_id, created_at, updated_at';

/**
 * Option Requests + Chat (Kunde ↔ Agentur).
 * Alle Anfragen, Nachrichten und Anhänge in Supabase:
 * - option_requests (client_id, agency_id, model_id) – pro Partei abrufbar
 * - option_request_messages – pro option_request_id
 * - option_documents + Storage (chat-files/options/…) – pro option_request_id, uploaded_by
 */
export type SupabaseOptionRequest = {
  id: string;
  client_id: string;
  model_id: string;
  agency_id: string;
  requested_date: string;
  status: 'in_negotiation' | 'confirmed' | 'rejected';
  project_id: string | null;
  client_name: string | null;
  model_name: string | null;
  proposed_price: number | null;
  agency_counter_price: number | null;
  client_price_status: 'pending' | 'accepted' | 'rejected' | null;
  final_status: 'option_pending' | 'option_confirmed' | 'job_confirmed' | null;
  request_type: 'option' | 'casting' | null;
  currency: string | null;
  start_time: string | null;
  end_time: string | null;
  model_approval: 'pending' | 'approved' | 'rejected';
  model_approved_at: string | null;
  /** false = no models.user_id; negotiation proceeds client↔agency only */
  model_account_linked?: boolean | null;
  booker_id: string | null;
  organization_id: string | null;
  created_by: string | null;
  agency_assignee_user_id: string | null;
  created_at: string;
  updated_at: string;
};

export type SupabaseOptionMessage = {
  id: string;
  option_request_id: string;
  from_role: 'client' | 'agency';
  text: string;
  // optional, for future system / typed messages
  message_type?: 'user' | 'system';
  booker_id: string | null;
  booker_name: string | null;
  created_at: string;
};

export type SupabaseOptionDocument = {
  id: string;
  option_request_id: string;
  uploaded_by: string;
  file_name: string;
  file_url: string;
  file_type: string | null;
  created_at: string;
};

export type OptionRequestListOptions = {
  /** Max rows per page. Defaults to 100. */
  limit?: number;
  /**
   * Cursor: ISO timestamp of the oldest loaded item.
   * Pass to load earlier items ("Load more").
   */
  afterCreatedAt?: string;
};

export async function getOptionRequests(
  opts?: OptionRequestListOptions,
): Promise<SupabaseOptionRequest[]> {
  try {
    let q = supabase
      .from('option_requests')
      .select(OPTION_REQUEST_SELECT)
      .order('created_at', { ascending: false })
      .limit(opts?.limit ?? 100);
    if (opts?.afterCreatedAt) q = q.lt('created_at', opts.afterCreatedAt);
    const { data, error } = await q;
    if (error) { console.error('getOptionRequests error:', error); return []; }
    return (data ?? []) as SupabaseOptionRequest[];
  } catch (e) {
    console.error('getOptionRequests exception:', e);
    return [];
  }
}

export async function getOptionRequestById(id: string): Promise<SupabaseOptionRequest | null> {
  const { data, error } = await supabase
    .from('option_requests')
    .select(OPTION_REQUEST_SELECT)
    .eq('id', id)
    .maybeSingle();
  if (error) { console.error('getOptionRequestById error:', error); return null; }
  return data as SupabaseOptionRequest | null;
}

export async function getOptionRequestsByProject(
  projectId: string,
  opts?: OptionRequestListOptions,
): Promise<SupabaseOptionRequest[]> {
  try {
    let q = supabase
      .from('option_requests')
      .select(OPTION_REQUEST_SELECT)
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
      .limit(opts?.limit ?? 100);
    if (opts?.afterCreatedAt) q = q.lt('created_at', opts.afterCreatedAt);
    const { data, error } = await q;
    if (error) { console.error('getOptionRequestsByProject error:', error); return []; }
    return (data ?? []) as SupabaseOptionRequest[];
  } catch (e) {
    console.error('getOptionRequestsByProject exception:', e);
    return [];
  }
}

/** Sichtbare Option-Requests für die aktuelle Session (RLS: Client-Organisation / Legacy client_id). */
export async function getOptionRequestsForCurrentClient(
  opts?: OptionRequestListOptions,
): Promise<SupabaseOptionRequest[]> {
  try {
    let q = supabase
      .from('option_requests')
      .select(OPTION_REQUEST_SELECT)
      .order('created_at', { ascending: false })
      .limit(opts?.limit ?? 100);
    if (opts?.afterCreatedAt) q = q.lt('created_at', opts.afterCreatedAt);
    const { data, error } = await q;
    if (error) { console.error('getOptionRequestsForCurrentClient error:', error); return []; }
    return (data ?? []) as SupabaseOptionRequest[];
  } catch (e) {
    console.error('getOptionRequestsForCurrentClient exception:', e);
    return [];
  }
}

/** @deprecated Parameter wird ignoriert; nutzt RLS wie getOptionRequestsForCurrentClient. */
export async function getOptionRequestsForClient(_clientId: string): Promise<SupabaseOptionRequest[]> {
  return getOptionRequestsForCurrentClient();
}

export async function getOptionRequestsForAgency(
  agencyId: string,
  opts?: OptionRequestListOptions,
): Promise<SupabaseOptionRequest[]> {
  try {
    let q = supabase
      .from('option_requests')
      .select(OPTION_REQUEST_SELECT)
      .eq('agency_id', agencyId)
      .order('created_at', { ascending: false })
      .limit(opts?.limit ?? 100);
    if (opts?.afterCreatedAt) q = q.lt('created_at', opts.afterCreatedAt);
    const { data, error } = await q;
    if (error) { console.error('getOptionRequestsForAgency error:', error); return []; }
    return (data ?? []) as SupabaseOptionRequest[];
  } catch (e) {
    console.error('getOptionRequestsForAgency exception:', e);
    return [];
  }
}

export async function insertOptionRequest(req: {
  client_id: string;
  model_id: string;
  agency_id: string;
  requested_date: string;
  request_type?: 'option' | 'casting';
  project_id?: string;
  client_name?: string;
  model_name?: string;
  proposed_price?: number;
  currency?: string;
  start_time?: string;
  end_time?: string;
  organization_id?: string | null;
  created_by?: string | null;
}): Promise<SupabaseOptionRequest | null> {
  const { data: modelRow } = await supabase
    .from('models')
    .select('user_id')
    .eq('id', req.model_id)
    .maybeSingle();
  const modelAccountLinked = !!(modelRow as { user_id?: string | null } | null)?.user_id;
  const modelApproval = modelAccountLinked ? 'pending' : 'approved';
  const modelApprovedAt = modelAccountLinked ? null : new Date().toISOString();

  const { data, error } = await supabase
    .from('option_requests')
    .insert({
      client_id: req.client_id,
      model_id: req.model_id,
      agency_id: req.agency_id,
      requested_date: req.requested_date,
      project_id: req.project_id || null,
      client_name: req.client_name || null,
      model_name: req.model_name || null,
      proposed_price: req.proposed_price || null,
      agency_counter_price: null,
      client_price_status: 'pending',
      final_status: 'option_pending',
      request_type: req.request_type || 'option',
      currency: req.currency || null,
      start_time: req.start_time || null,
      end_time: req.end_time || null,
      status: 'in_negotiation',
      model_approval: modelApproval,
      model_approved_at: modelApprovedAt,
      model_account_linked: modelAccountLinked,
      organization_id: req.organization_id ?? null,
      created_by: req.created_by ?? null,
    })
    .select(OPTION_REQUEST_SELECT)
    .single();
  if (error) { console.error('insertOptionRequest error:', error); return null; }

  const inserted = data as SupabaseOptionRequest;

  // Notify the AGENCY org about the new request.
  // IMPORTANT: inserted.organization_id is the CLIENT org (used for RLS scoping).
  // We must look up the agency org separately via agency_id.
  void (async () => {
    const agencyOrgId = await fetchAgencyOrgId(inserted.agency_id);
    await createNotification({
      ...(agencyOrgId
        ? { organization_id: agencyOrgId }
        : { user_id: inserted.agency_id }), // agency_id used only as last-resort (legacy orgs without an org row)
      type: 'new_option_request',
      title: uiCopy.notifications.newOptionRequest.title,
      message: uiCopy.notifications.newOptionRequest.message,
      metadata: { option_request_id: inserted.id },
    });
  })();

  return inserted;
}

export async function updateOptionRequestStatus(
  id: string,
  status: 'in_negotiation' | 'confirmed' | 'rejected'
): Promise<boolean> {
  const { data, error } = await supabase
    .from('option_requests')
    .update({ status })
    .eq('id', id)
    .select('id')
    .maybeSingle();
  if (error) {
    console.error('updateOptionRequestStatus error:', error);
    return false;
  }
  if (!data?.id) {
    console.warn('updateOptionRequestStatus: no row updated (check id / RLS)', id);
    return false;
  }
  return true;
}

/** Datum/Zeit der Option (Client/Agentur). Trigger sync_option_dates_to_calendars pflegt Kalender + gespiegelte Events. */
export async function updateOptionRequestSchedule(
  id: string,
  fields: { requested_date: string; start_time?: string | null; end_time?: string | null }
): Promise<boolean> {
  try {
    const dateNorm = fields.requested_date.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateNorm)) {
      console.error('updateOptionRequestSchedule: invalid date');
      return false;
    }
    const { error } = await supabase
      .from('option_requests')
      .update({
        requested_date: dateNorm,
        start_time: fields.start_time ?? null,
        end_time: fields.end_time ?? null,
      })
      .eq('id', id);
    if (error) {
      console.error('updateOptionRequestSchedule error:', error);
      return false;
    }
    return true;
  } catch (e) {
    console.error('updateOptionRequestSchedule exception:', e);
    return false;
  }
}

/** Model: nur Datum/Zeit, RPC in DB (migration_calendar_reschedule_sync.sql). */
export async function modelUpdateOptionSchedule(
  optionId: string,
  date: string,
  startTime?: string | null,
  endTime?: string | null
): Promise<boolean> {
  try {
    const d = date.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
    const { error } = await supabase.rpc('model_update_option_schedule', {
      p_option_id: optionId,
      p_date: d,
      p_start: startTime ?? '',
      p_end: endTime ?? '',
    });
    if (error) {
      console.error('modelUpdateOptionSchedule error:', error);
      return false;
    }
    return true;
  } catch (e) {
    console.error('modelUpdateOptionSchedule exception:', e);
    return false;
  }
}

export async function setAgencyCounterOffer(
  id: string,
  counterPrice: number
): Promise<boolean> {
  const { error } = await supabase
    .from('option_requests')
    .update({
      agency_counter_price: counterPrice,
      client_price_status: 'pending',
      final_status: 'option_pending',
    })
    .eq('id', id);
  if (error) { console.error('setAgencyCounterOffer error:', error); return false; }
  return true;
}

export async function agencyAcceptClientPrice(id: string): Promise<boolean> {
  const { error } = await supabase
    .from('option_requests')
    .update({
      client_price_status: 'accepted',
      final_status: 'option_confirmed',
    })
    .eq('id', id);
  if (error) { console.error('agencyAcceptClientPrice error:', error); return false; }
  return true;
}

/** Agency declines the client's proposed fee; counter-offer UI becomes the next step. */
export async function agencyRejectClientPrice(id: string): Promise<boolean> {
  const { error } = await supabase
    .from('option_requests')
    .update({ client_price_status: 'rejected' })
    .eq('id', id);
  if (error) { console.error('agencyRejectClientPrice error:', error); return false; }
  return true;
}

export async function clientAcceptCounterPrice(id: string): Promise<boolean> {
  // Guard: only accept when a counter-offer is actually pending.
  // Without this, a stale UI state (race condition or duplicate tap) could
  // confirm an already-superseded price version.
  const { data, error } = await supabase
    .from('option_requests')
    .update({
      client_price_status: 'accepted',
      final_status: 'option_confirmed',
    })
    .eq('id', id)
    .eq('client_price_status', 'pending')
    .eq('final_status', 'option_pending')
    .select('id');
  if (error) { console.error('clientAcceptCounterPrice error:', error); return false; }
  if (!data || data.length === 0) {
    console.warn('clientAcceptCounterPrice: no row updated — counter-offer no longer pending');
    return false;
  }
  return true;
}

/**
 * Client lehnt das Gegenangebot der Agency ab.
 * Setzt status=rejected + client_price_status=rejected atomar.
 */
export async function clientRejectCounterOfferOnSupabase(id: string): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('option_requests')
      .update({
        client_price_status: 'rejected',
        status: 'rejected',
      })
      .eq('id', id);
    if (error) { console.error('clientRejectCounterOfferOnSupabase error:', error); return false; }
    return true;
  } catch (e) {
    console.error('clientRejectCounterOfferOnSupabase exception:', e);
    return false;
  }
}

export async function clientConfirmJobOnSupabase(id: string): Promise<boolean> {
  try {
    const { data: updated, error } = await supabase
      .from('option_requests')
      .update({
        final_status: 'job_confirmed',
        status: 'confirmed',
      })
      .eq('id', id)
      .select(OPTION_REQUEST_SELECT)
      .maybeSingle();

    if (error) {
      console.error('clientConfirmJobOnSupabase error:', error);
      return false;
    }

    if (!updated) {
      console.warn('clientConfirmJobOnSupabase: no row updated (check id / RLS)', id);
      return false;
    }

    // Create a booking_event so calendar entries are generated for all parties.
    // Without this the Option→Job conversion had no calendar side-effect.
    await createBookingEventFromRequest(updated as SupabaseOptionRequest);

    return true;
  } catch (e) {
    console.error('clientConfirmJobOnSupabase exception:', e);
    return false;
  }
}

export type GetOptionMessagesOptions = {
  /** Max messages to load. Defaults to 50. */
  limit?: number;
  /**
   * Cursor: ID of the oldest currently loaded message.
   * Pass to retrieve older messages ("Load more").
   */
  beforeId?: string;
};

/**
 * Loads the latest `limit` messages for an option request.
 * Replaces unbounded full-history load — at scale each open option chat
 * was pulling the entire message history on every mount.
 */
export async function getOptionMessages(
  requestId: string,
  opts?: GetOptionMessagesOptions,
): Promise<SupabaseOptionMessage[]> {
  const limit = opts?.limit ?? 50;
  try {
    let q = supabase
      .from('option_request_messages')
      .select('*')
      .eq('option_request_id', requestId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (opts?.beforeId) {
      const { data: cursorRow } = await supabase
        .from('option_request_messages')
        .select('created_at')
        .eq('id', opts.beforeId)
        .maybeSingle();
      if (cursorRow) {
        q = q.lt('created_at', (cursorRow as { created_at: string }).created_at);
      }
    }

    const { data, error } = await q;
    if (error) { console.error('getOptionMessages error:', error); return []; }
    return ((data ?? []) as SupabaseOptionMessage[]).reverse();
  } catch (e) {
    console.error('getOptionMessages exception:', e);
    return [];
  }
}

export async function addOptionMessage(
  requestId: string,
  fromRole: 'client' | 'agency',
  text: string
): Promise<SupabaseOptionMessage | null> {
  try {
    const { data: { user } } = await supabase.auth.getUser();

    // Normalize, validate, and sanitize text — same pipeline as messengerSupabase.sendMessage
    const normalized = normalizeInput(text);
    const textCheck = validateText(normalized, { maxLength: 2000, allowEmpty: false });
    if (!textCheck.ok) {
      console.warn('addOptionMessage: text validation failed', textCheck.error);
      void logSecurityEvent({ type: 'large_payload', userId: user?.id ?? null, metadata: { service: 'optionRequestsSupabase', field: 'text' } });
      return null;
    }
    const safeText = sanitizeHtml(normalized);

    const { data, error } = await supabase
      .from('option_request_messages')
      .insert({ option_request_id: requestId, from_role: fromRole, text: safeText })
      .select('id, option_request_id, from_role, text, booker_id, booker_name, created_at')
      .single();
    if (error) {
      console.error('addOptionMessage error:', error);
      return null;
    }
    if (fromRole === 'agency' && user?.id) {
      const { error: claimErr } = await supabase
        .from('option_requests')
        .update({ agency_assignee_user_id: user.id })
        .eq('id', requestId)
        .is('agency_assignee_user_id', null);
      if (claimErr) console.error('addOptionMessage claim assignee error:', claimErr);
    }
    return data as SupabaseOptionMessage;
  } catch (e) {
    console.error('addOptionMessage exception:', e);
    return null;
  }
}

export async function updateModelApproval(
  id: string,
  approval: 'approved' | 'rejected'
): Promise<boolean> {
  try {
    // Auth-Guard: only the model linked to this request may approve/reject.
    // Fetch the request and verify the current user is the model's linked user.
    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) {
      console.error('updateModelApproval: no authenticated user', authErr);
      return false;
    }

    const { data: req, error: fetchErr } = await supabase
      .from('option_requests')
      .select('model_id')
      .eq('id', id)
      .maybeSingle();

    if (fetchErr || !req) {
      console.error('updateModelApproval: request fetch failed', fetchErr);
      return false;
    }

    const { data: modelRow, error: modelErr } = await supabase
      .from('models')
      .select('user_id')
      .eq('id', (req as { model_id: string }).model_id)
      .maybeSingle();

    if (modelErr || !modelRow) {
      console.error('updateModelApproval: model fetch failed', modelErr);
      return false;
    }

    const modelUserId = (modelRow as { user_id: string | null }).user_id;
    if (modelUserId !== user.id) {
      console.error('updateModelApproval: caller is not the linked model user', {
        callerId: user.id,
        modelUserId,
      });
      return false;
    }

    const { error } = await supabase
      .from('option_requests')
      .update({
        model_approval: approval,
        model_approved_at: approval === 'approved' ? new Date().toISOString() : null,
      })
      .eq('id', id);

    if (error) { console.error('updateModelApproval error:', error); return false; }
    return true;
  } catch (e) {
    console.error('updateModelApproval exception:', e);
    return false;
  }
}

export async function getOptionRequestsForModel(modelId: string): Promise<SupabaseOptionRequest[]> {
  try {
    const { data, error } = await supabase
      .from('option_requests')
      .select(OPTION_REQUEST_SELECT)
      .eq('model_id', modelId)
      .order('created_at', { ascending: false });
    if (error) { console.error('getOptionRequestsForModel error:', error); return []; }
    return (data ?? []) as SupabaseOptionRequest[];
  } catch (e) {
    console.error('getOptionRequestsForModel exception:', e);
    return [];
  }
}

export async function getOptionDocuments(requestId: string): Promise<SupabaseOptionDocument[]> {
  try {
    const { data, error } = await supabase
      .from('option_documents')
      .select('*')
      .eq('option_request_id', requestId)
      .order('created_at', { ascending: true });
    if (error) { console.error('getOptionDocuments error:', error); return []; }
    return (data ?? []) as SupabaseOptionDocument[];
  } catch (e) {
    console.error('getOptionDocuments exception:', e);
    return [];
  }
}

export async function uploadOptionDocument(
  requestId: string,
  uploadedBy: string,
  file: File | Blob,
  fileName: string
): Promise<SupabaseOptionDocument | null> {
  try {
  // Agency storage limit check — non-agency users pass through automatically.
  const storageCheck = await checkAndIncrementStorage(file.size);
  if (!storageCheck.allowed) {
    console.warn('uploadOptionDocument: storage limit reached', storageCheck);
    return null;
  }

  const path = `options/${requestId}/${Date.now()}_${fileName}`;
  const { error: uploadError } = await supabase.storage
    .from('chat-files')
    .upload(path, file);
  if (uploadError) {
    console.error('uploadOptionDocument storage error:', uploadError);
    await decrementStorage(file.size);
    return null;
  }

  // Use a time-limited signed URL (1 hour) instead of a permanent public URL.
  // This prevents unauthenticated access to option documents via raw URL.
  const { data: signedData, error: signedError } = await supabase.storage
    .from('chat-files')
    .createSignedUrl(path, 3600);
  if (signedError || !signedData?.signedUrl) {
    console.error('uploadOptionDocument signed URL error:', signedError);
    return null;
  }

  const { data, error } = await supabase
    .from('option_documents')
    .insert({
      option_request_id: requestId,
      uploaded_by: uploadedBy,
      file_name: fileName,
      file_url: signedData.signedUrl,
      file_type: fileName.split('.').pop() || null,
    })
    .select()
    .single();
  if (error) { console.error('uploadOptionDocument error:', error); return null; }
  return data as SupabaseOptionDocument;
  } catch (e) {
    console.error('uploadOptionDocument exception:', e);
    return null;
  }
}

// =============================================================================
// Booking Confirmation Flow (Agency → [Model]) → Calendar
// =============================================================================

/**
 * Resolves the agency's organization ID from an agencies.id value.
 * Shared by notification helpers and booking-event creation to avoid
 * re-implementing the same lookup in multiple places.
 *
 * NOTE: option_requests.organization_id is the CLIENT org, NOT the agency org.
 * Always use this helper when you need to notify the agency side.
 */
async function fetchAgencyOrgId(agencyId: string): Promise<string | null> {
  try {
    const { data } = await supabase
      .from('organizations')
      .select('id')
      .eq('agency_id', agencyId)
      .maybeSingle();
    return (data as { id: string } | null)?.id ?? null;
  } catch (e) {
    console.error('fetchAgencyOrgId exception:', e);
    return null;
  }
}

/**
 * Erstellt aus einem bestätigten option_request ein booking_event.
 * Wird intern von agencyAcceptRequest und modelConfirmOptionRequest aufgerufen.
 */
async function createBookingEventFromRequest(req: SupabaseOptionRequest): Promise<void> {
  try {
    const eventType: BookingEventType =
      req.request_type === 'casting' ? 'casting'
      : req.final_status === 'job_confirmed' ? 'job'
      : 'option';

    const { data: agencyOrg } = await supabase
      .from('organizations')
      .select('id')
      .eq('agency_id', req.agency_id)
      .maybeSingle();

    await createBookingEvent({
      model_id: req.model_id,
      client_org_id: req.organization_id ?? null,
      agency_org_id: (agencyOrg as { id: string } | null)?.id ?? null,
      date: req.requested_date,
      type: eventType,
      title: req.client_name ? `${req.client_name} – ${eventType}` : null,
      note: null,
      source_option_request_id: req.id,
    });
  } catch (e) {
    console.error('createBookingEventFromRequest exception:', e);
  }
}

/**
 * Agency akzeptiert die gesamte Buchungsanfrage.
 *
 * - model_account_linked = false → sofortige Bestätigung; booking_event wird erstellt.
 * - model_account_linked = true  → wartet auf Model-Bestätigung; kein booking_event noch.
 *
 * Verwendet client_price_status = 'accepted' als internes Agency-Accept-Signal
 * (kompatibel zum bestehenden Preisverhandlungsflow).
 */
export async function agencyAcceptRequest(
  id: string,
): Promise<'confirmed' | 'awaiting_model_confirmation' | null> {
  try {
    const { data: req, error: fetchErr } = await supabase
      .from('option_requests')
      .select(OPTION_REQUEST_SELECT)
      .eq('id', id)
      .maybeSingle();

    if (fetchErr || !req) {
      console.error('agencyAcceptRequest fetch error:', fetchErr);
      return null;
    }

    const r = req as SupabaseOptionRequest;
    const modelAccountLinked = r.model_account_linked ?? false;

    if (!modelAccountLinked) {
      // Kein Model-Account → Agency-Bestätigung reicht aus
      const { error } = await supabase
        .from('option_requests')
        .update({
          client_price_status: 'accepted',
          final_status: 'option_confirmed',
          model_approval: 'approved',
          model_approved_at: new Date().toISOString(),
          status: 'confirmed',
        })
        .eq('id', id);

      if (error) {
        console.error('agencyAcceptRequest (no account) update error:', error);
        return null;
      }

      const confirmed: SupabaseOptionRequest = { ...r, status: 'confirmed', final_status: 'option_confirmed' };
      await createBookingEventFromRequest(confirmed);
      return 'confirmed';
    }

    // Model hat Account → wartet auf Model-Bestätigung
    const { error } = await supabase
      .from('option_requests')
      .update({
        client_price_status: 'accepted',
        final_status: 'option_confirmed',
        // model_approval bleibt 'pending'
      })
      .eq('id', id);

    if (error) {
      console.error('agencyAcceptRequest (with account) update error:', error);
      return null;
    }

    // Notify model user that their confirmation is needed
    void notifyModelAwaitingConfirmation(r.model_id, id);

    return 'awaiting_model_confirmation';
  } catch (e) {
    console.error('agencyAcceptRequest exception:', e);
    return null;
  }
}

/**
 * Agency lehnt die Buchungsanfrage ab.
 * Setzt status=rejected + final_status=null atomar.
 *
 * Bewusste Entscheidung: final_status=null statt 'option_pending',
 * weil 'option_pending' eine AKTIVE Verhandlung signalisiert.
 * Abgelehnte Requests mit final_status='option_pending' würden in
 * Client-seitigen Queries die aktiven Optionen verunreinigen.
 */
export async function agencyRejectRequest(id: string): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('option_requests')
      .update({
        status: 'rejected',
        final_status: null,
        client_price_status: 'rejected',
      })
      .eq('id', id);

    if (error) {
      console.error('agencyRejectRequest error:', error);
      return false;
    }
    return true;
  } catch (e) {
    console.error('agencyRejectRequest exception:', e);
    return false;
  }
}

/**
 * Model bestätigt die Buchungsanfrage.
 * Darf nur aufgerufen werden wenn model_account_linked = true.
 * RLS stellt sicher, dass nur das richtige Model die Zeile updaten kann.
 */
export async function modelConfirmOptionRequest(id: string): Promise<boolean> {
  try {
    const { data: req, error: fetchErr } = await supabase
      .from('option_requests')
      .select(OPTION_REQUEST_SELECT)
      .eq('id', id)
      .maybeSingle();

    if (fetchErr || !req) {
      console.error('modelConfirmOptionRequest fetch error:', fetchErr);
      return false;
    }

    const r = req as SupabaseOptionRequest;

    if (r.model_approval !== 'pending' || !r.model_account_linked) {
      console.warn('modelConfirmOptionRequest: invalid state', { model_approval: r.model_approval, model_account_linked: r.model_account_linked });
      return false;
    }

    // Agency must have accepted first (final_status transitions to option_confirmed
    // when agency calls agencyAcceptRequest or agencyAcceptClientPrice).
    if (r.final_status !== 'option_confirmed') {
      console.warn('modelConfirmOptionRequest: agency has not accepted yet', { final_status: r.final_status });
      return false;
    }

    const { error } = await supabase
      .from('option_requests')
      .update({
        model_approval: 'approved',
        model_approved_at: new Date().toISOString(),
        status: 'confirmed',
      })
      .eq('id', id);

    if (error) {
      console.error('modelConfirmOptionRequest update error:', error);
      return false;
    }

    const confirmed: SupabaseOptionRequest = { ...r, status: 'confirmed', model_approval: 'approved' };
    await createBookingEventFromRequest(confirmed);

    // Notify agency org + client user about model confirmation
    void notifyModelConfirmedOption(r);

    return true;
  } catch (e) {
    console.error('modelConfirmOptionRequest exception:', e);
    return false;
  }
}

/**
 * Model lehnt die Buchungsanfrage ab.
 */
export async function modelRejectOptionRequest(id: string): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('option_requests')
      .update({
        model_approval: 'rejected',
        status: 'rejected',
      })
      .eq('id', id);

    if (error) {
      console.error('modelRejectOptionRequest error:', error);
      return false;
    }
    return true;
  } catch (e) {
    console.error('modelRejectOptionRequest exception:', e);
    return false;
  }
}

/**
 * Lädt alle option_requests, die auf Model-Bestätigung warten.
 * Wird in der Model-UI angezeigt (Pending confirmations).
 */
export async function getPendingModelConfirmations(
  modelId: string,
): Promise<SupabaseOptionRequest[]> {
  try {
    const { data, error } = await supabase
      .from('option_requests')
      .select(OPTION_REQUEST_SELECT)
      .eq('model_id', modelId)
      .eq('model_approval', 'pending')
      .eq('model_account_linked', true)
      .neq('status', 'rejected')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('getPendingModelConfirmations error:', error);
      return [];
    }
    return (data ?? []) as SupabaseOptionRequest[];
  } catch (e) {
    console.error('getPendingModelConfirmations exception:', e);
    return [];
  }
}

export async function sendAgencyInvitation(agencyName: string, email: string, invitedBy?: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('agency_invitations')
    .insert({
      agency_name: agencyName,
      email,
      invited_by: invitedBy || null,
    })
    .select('token')
    .single();
  if (error) { console.error('sendAgencyInvitation error:', error); return null; }
  return data?.token ?? null;
}

/**
 * Subscribe to new messages in an option request chat.
 * Uses the shared channel pool — multiple components for the same request
 * share one WebSocket channel. Returns a cleanup function.
 */
export function subscribeToOptionMessages(
  requestId: string,
  onMessage: (msg: SupabaseOptionMessage) => void,
): () => void {
  return pooledSubscribe(
    `option-${requestId}`,
    (channel, dispatch) =>
      channel
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'option_request_messages',
            filter: `option_request_id=eq.${requestId}`,
          },
          dispatch,
        )
        .subscribe(),
    (payload) => onMessage((payload as { new: SupabaseOptionMessage }).new),
  );
}

// ── Notification helpers ──────────────────────────────────────────────────────

/** Notify a model's linked user that they need to confirm an option request. */
async function notifyModelAwaitingConfirmation(modelId: string, optionRequestId: string): Promise<void> {
  try {
    const { data: modelRow } = await supabase
      .from('models')
      .select('user_id')
      .eq('id', modelId)
      .maybeSingle();
    const userId = (modelRow as { user_id?: string | null } | null)?.user_id;
    if (!userId) return;
    await createNotification({
      user_id: userId,
      type: 'awaiting_model_confirmation',
      title: uiCopy.notifications.awaitingModelConfirmation.title,
      message: uiCopy.notifications.awaitingModelConfirmation.message,
      metadata: { model_id: modelId, option_request_id: optionRequestId },
    });
  } catch (e) {
    console.error('notifyModelAwaitingConfirmation exception:', e);
  }
}

/** Notify agency org + client user when a model confirms an option request. */
async function notifyModelConfirmedOption(req: SupabaseOptionRequest): Promise<void> {
  try {
    const notifications = [];

    // IMPORTANT: req.organization_id is the CLIENT org, not the agency org.
    // Resolve the agency org via agency_id — same pattern as createBookingEventFromRequest.
    const agencyOrgId = await fetchAgencyOrgId(req.agency_id);

    notifications.push({
      ...(agencyOrgId
        ? { organization_id: agencyOrgId }
        : { user_id: req.agency_id }), // fallback: only for legacy orgs without an org row
      type: 'model_confirmed',
      title: uiCopy.notifications.modelConfirmed.title,
      message: uiCopy.notifications.modelConfirmed.message,
      metadata: { option_request_id: req.id },
    });

    // Also notify the client user
    notifications.push({
      user_id: req.client_id,
      type: 'model_confirmed',
      title: uiCopy.notifications.modelConfirmed.title,
      message: uiCopy.notifications.modelConfirmed.message,
      metadata: { option_request_id: req.id },
    });

    await createNotifications(notifications);
  } catch (e) {
    console.error('notifyModelConfirmedOption exception:', e);
  }
}
