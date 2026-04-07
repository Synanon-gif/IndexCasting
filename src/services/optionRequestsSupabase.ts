import { supabase } from '../../lib/supabase';
import { pooledSubscribe } from './realtimeChannelPool';
import type { BookingEventType } from './bookingEventsSupabase';
import { createNotification, createNotifications } from './notificationsSupabase';
import { uiCopy } from '../constants/uiCopy';
import { normalizeInput, validateText, sanitizeHtml, extractSafeUrls, logSecurityEvent } from '../../lib/validation';
import { checkAndIncrementStorage, decrementStorage } from './agencyStorageSupabase';
import { guardUploadSession } from './gdprComplianceSupabase';
import { logAction } from '../utils/logAction';

export const OPTION_REQUEST_SELECT =
  'id, client_id, model_id, agency_id, requested_date, status, project_id, client_name, model_name, proposed_price, agency_counter_price, client_price_status, final_status, request_type, currency, start_time, end_time, model_approval, model_approved_at, model_account_linked, booker_id, organization_id, agency_organization_id, client_organization_id, created_by, agency_assignee_user_id, created_at, updated_at';

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
  /** Org-zentrische Agentur-ID (organizations.id, type='agency'). Bevorzugt gegenüber agency_id. */
  agency_organization_id: string | null;
  /** Org-zentrische Client-ID (organizations.id, type='client'). Bevorzugt gegenüber organization_id. */
  client_organization_id: string | null;
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
  /**
   * Storage object path (e.g. "options/{requestId}/{timestamp}_{name}").
   * Use resolveOptionDocumentUrl() to obtain a short-lived signed URL for display.
   * Legacy rows created before the VULN-M3 fix may contain a full https:// URL here;
   * resolveOptionDocumentUrl() handles both formats transparently.
   */
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
  orgId?: string,
  opts?: OptionRequestListOptions,
): Promise<SupabaseOptionRequest[]> {
  if (orgId !== undefined && !orgId) {
    console.error('[getOptionRequests] orgId provided but empty — call aborted');
    return [];
  }
  if (orgId === undefined) {
    console.warn('[getOptionRequests] called without orgId — relying on RLS only (no defense-in-depth org filter)');
  }
  try {
    let q = supabase
      .from('option_requests')
      .select(OPTION_REQUEST_SELECT)
      .order('created_at', { ascending: false })
      .limit(opts?.limit ?? 100);
    if (orgId) q = q.eq('organization_id', orgId);
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
  agencyOrganizationId?: string | null,
): Promise<SupabaseOptionRequest[]> {
  try {
    let q = supabase
      .from('option_requests')
      .select(OPTION_REQUEST_SELECT)
      .order('created_at', { ascending: false })
      .limit(opts?.limit ?? 100);

    if (agencyOrganizationId) {
      // Neue Rows: agency_organization_id; alte Rows: agency_id — OR-Filter für Übergangszeit
      q = q.or(`agency_organization_id.eq.${agencyOrganizationId},agency_id.eq.${agencyId}`);
    } else {
      q = q.eq('agency_id', agencyId);
    }

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
  /** Org-zentrische Agentur-Org (organizations.id, type='agency'). Sollte immer gesetzt werden. */
  agency_organization_id?: string | null;
  /** Org-zentrische Client-Org (organizations.id, type='client'). Sollte immer gesetzt werden. */
  client_organization_id?: string | null;
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
      client_name: req.client_name ? sanitizeHtml(normalizeInput(req.client_name)) : null,
      model_name: req.model_name ? sanitizeHtml(normalizeInput(req.model_name)) : null,
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
      agency_organization_id: req.agency_organization_id ?? null,
      client_organization_id: req.client_organization_id ?? null,
      created_by: req.created_by ?? null,
    })
    .select(OPTION_REQUEST_SELECT)
    .single();
  if (error) { console.error('insertOptionRequest error:', error); return null; }

  const inserted = data as SupabaseOptionRequest;

  logAction(inserted.organization_id, 'insertOptionRequest', {
    type: 'option',
    action: 'option_sent',
    entityId: inserted.id,
    newData: {
      client_id: inserted.client_id,
      agency_id: inserted.agency_id,
      model_id: inserted.model_id,
      proposed_price: inserted.proposed_price,
      request_type: inserted.request_type,
    },
  });

  // Notify the AGENCY org about the new request.
  // IMPORTANT: inserted.organization_id is the CLIENT org (used for RLS scoping).
  // We must look up the agency org separately via agency_id.
  void (async () => {
    const agencyOrgId = await fetchAgencyOrgId(inserted.agency_id);
    if (!agencyOrgId) {
      console.error('[notifications] insertOptionRequest: agency org not found for agency_id', inserted.agency_id, '— notification skipped.');
      return;
    }
    await createNotification({
      organization_id: agencyOrgId,
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
  status: 'in_negotiation' | 'confirmed' | 'rejected',
  fromStatus?: 'pending' | 'in_negotiation' | 'confirmed' | 'rejected'
): Promise<boolean> {
  try {
    let q = supabase
      .from('option_requests')
      .update({ status })
      .eq('id', id);
    if (fromStatus) {
      // Optimistic concurrency guard: the update only succeeds if the row is
      // still in the expected prior state, preventing invalid state skips
      // (e.g. rejected → confirmed) via concurrent or replayed requests.
      q = q.eq('status', fromStatus);
    }
    const { data, error } = await q.select('id, organization_id').maybeSingle();
    if (error) {
      console.error('updateOptionRequestStatus error:', error);
      return false;
    }
    if (!data?.id) {
      console.warn('updateOptionRequestStatus: no row updated — concurrent state change or wrong fromStatus', { id, fromStatus, targetStatus: status });
      return false;
    }
    const orgId = (data as { id: string; organization_id: string | null }).organization_id;
    const auditAction = status === 'confirmed' ? 'option_confirmed'
      : status === 'rejected' ? 'option_rejected'
      : 'option_price_proposed';
    logAction(orgId, 'updateOptionRequestStatus', {
      type: 'option',
      action: auditAction,
      entityId: id,
      newData: { status },
      oldData: { status: fromStatus },
    });
    return true;
  } catch (e) {
    console.error('updateOptionRequestStatus exception:', e);
    return false;
  }
}

/**
 * Agency-only: update the date/time of an option request.
 *
 * EXPLOIT-M1 fix: routes through the SECURITY DEFINER RPC
 * agency_update_option_schedule() which validates server-side that the caller
 * is a member of the agency org for this request. The previous direct UPDATE
 * had no role guard — a client user could change dates of confirmed options.
 *
 * Trigger sync_option_dates_to_calendars still fires on the UPDATE inside the RPC.
 */
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
    const { data, error } = await supabase.rpc('agency_update_option_schedule', {
      p_option_id:  id,
      p_date:       dateNorm,
      p_start_time: fields.start_time ?? null,
      p_end_time:   fields.end_time ?? null,
    });
    if (error) {
      console.error('updateOptionRequestSchedule RPC error:', error);
      return false;
    }
    if (data === true) {
      console.warn('[updateOptionRequestSchedule] org context unavailable — audit log skipped');
    }
    return data === true;
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
    console.warn('[modelUpdateOptionSchedule] org context unavailable — audit log skipped for', optionId);
    return true;
  } catch (e) {
    console.error('modelUpdateOptionSchedule exception:', e);
    return false;
  }
}

/**
 * Agency sets a counter-offer price.
 * Guard: only allowed while still in_negotiation — prevents counter-offers on
 * already-confirmed or rejected requests (e.g. from a stale UI screen).
 */
export async function setAgencyCounterOffer(
  id: string,
  counterPrice: number
): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from('option_requests')
      .update({
        agency_counter_price: counterPrice,
        client_price_status: 'pending',
        final_status: 'option_pending',
      })
      .eq('id', id)
      .eq('status', 'in_negotiation')
      .select('id, organization_id')
      .maybeSingle();
    if (error) { console.error('setAgencyCounterOffer error:', error); return false; }
    if (!data?.id) {
      console.warn('setAgencyCounterOffer: no row updated — request not in_negotiation', id);
      return false;
    }
    const orgId = (data as { id: string; organization_id: string | null }).organization_id;
    logAction(orgId, 'setAgencyCounterOffer', {
      type: 'option',
      action: 'option_price_countered',
      entityId: id,
      newData: { counter_price: counterPrice },
    });
    return true;
  } catch (e) {
    console.error('setAgencyCounterOffer exception:', e);
    return false;
  }
}

/**
 * Agency accepts the client's proposed price.
 * Routes through the SECURITY DEFINER RPC agency_confirm_client_price()
 * which validates server-side that the caller is an actual agency org member.
 *
 * EXPLOIT-C1 fix: The previous direct UPDATE allowed any participant
 * (incl. the client) to flip client_price_status to 'accepted'.
 * The RPC enforces role at DB level, independent of client-side RLS.
 */
export async function agencyAcceptClientPrice(id: string): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc('agency_confirm_client_price', {
      p_request_id: id,
    });
    if (error) { console.error('agencyAcceptClientPrice RPC error:', error); return false; }
    if (!data) {
      console.warn('agencyAcceptClientPrice: RPC returned false — request not in expected state or caller not agency member', id);
      return false;
    }
    void (async () => {
      try {
        const { data: row } = await supabase.from('option_requests').select('organization_id').eq('id', id).maybeSingle();
        const orgId = (row as { organization_id: string | null } | null)?.organization_id;
        logAction(orgId, 'agencyAcceptClientPrice', {
          type: 'option',
          action: 'option_price_accepted',
          entityId: id,
          newData: { accepted_by: 'agency' },
          oldData: { client_price_status: 'pending' },
        });
      } catch {
        console.warn('[agencyAcceptClientPrice] could not resolve org for audit log');
      }
    })();
    return true;
  } catch (e) {
    console.error('agencyAcceptClientPrice exception:', e);
    return false;
  }
}

/**
 * Agency declines the client's proposed fee; counter-offer UI becomes the next step.
 * Guard: only actionable while the request is still in active negotiation.
 */
export async function agencyRejectClientPrice(id: string): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from('option_requests')
      .update({ client_price_status: 'rejected' })
      .eq('id', id)
      .eq('status', 'in_negotiation')
      .eq('client_price_status', 'pending')
      .select('id, organization_id')
      .maybeSingle();
    if (error) { console.error('agencyRejectClientPrice error:', error); return false; }
    if (!data?.id) {
      console.warn('agencyRejectClientPrice: no row updated — offer not pending or request not in_negotiation', id);
      return false;
    }
    const orgIdAR = (data as { id: string; organization_id: string | null }).organization_id;
    logAction(orgIdAR, 'agencyRejectClientPrice', {
      type: 'option',
      action: 'option_price_rejected',
      entityId: id,
      newData: { rejected_by: 'agency' },
      oldData: { client_price_status: 'pending' },
    });
    return true;
  } catch (e) {
    console.error('agencyRejectClientPrice exception:', e);
    return false;
  }
}

/**
 * Client accepts the agency's counter-offer price.
 * Routes through the SECURITY DEFINER RPC client_accept_counter_offer()
 * which validates server-side that the caller is the actual client.
 *
 * EXPLOIT-C1 fix: The previous direct UPDATE allowed any participant
 * (incl. the agency) to self-approve their own counter-offer.
 * The RPC enforces role at DB level, independent of client-side RLS.
 */
export async function clientAcceptCounterPrice(id: string): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc('client_accept_counter_offer', {
      p_request_id: id,
    });
    if (error) { console.error('clientAcceptCounterPrice RPC error:', error); return false; }
    if (!data) {
      console.warn('clientAcceptCounterPrice: RPC returned false — counter-offer no longer pending or caller not client', id);
      return false;
    }
    void (async () => {
      try {
        const { data: row } = await supabase.from('option_requests').select('organization_id').eq('id', id).maybeSingle();
        const orgId = (row as { organization_id: string | null } | null)?.organization_id;
        logAction(orgId, 'clientAcceptCounterPrice', {
          type: 'option',
          action: 'option_price_accepted',
          entityId: id,
          newData: { accepted_by: 'client' },
          oldData: { client_price_status: 'pending' },
        });
      } catch {
        console.warn('[clientAcceptCounterPrice] could not resolve org for audit log');
      }
    })();
    return true;
  } catch (e) {
    console.error('clientAcceptCounterPrice exception:', e);
    return false;
  }
}

/**
 * Client lehnt das Gegenangebot der Agency ab.
 * Setzt status=rejected + client_price_status=rejected atomar.
 *
 * Guard: verhindert Reject eines bereits bestätigten oder bereits abgelehnten
 * Requests (VULN-H2). Double-layer mit DB-Trigger trg_validate_option_status.
 */
export async function clientRejectCounterOfferOnSupabase(id: string): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from('option_requests')
      .update({
        client_price_status: 'rejected',
        status: 'rejected',
      })
      .eq('id', id)
      .neq('status', 'confirmed')    // VULN-H2: kein Reject nach Bestätigung
      .neq('status', 'rejected')     // Idempotenz-Schutz
      .select('id, organization_id')
      .maybeSingle();
    if (error) { console.error('clientRejectCounterOfferOnSupabase error:', error); return false; }
    if (!data?.id) {
      console.warn('clientRejectCounterOfferOnSupabase: no row updated — request already confirmed or rejected', id);
      return false;
    }
    const orgIdRC = (data as { id: string; organization_id: string | null }).organization_id;
    logAction(orgIdRC, 'clientRejectCounterOfferOnSupabase', {
      type: 'option',
      action: 'option_rejected',
      entityId: id,
      newData: { rejected_by: 'client', reason: 'counter_offer_rejected' },
    });
    return true;
  } catch (e) {
    console.error('clientRejectCounterOfferOnSupabase exception:', e);
    return false;
  }
}

export async function clientConfirmJobOnSupabase(id: string): Promise<boolean> {
  try {
    // Guard: only allow job confirmation from option_confirmed state.
    // This prevents double-confirms from stale UI screens.
    const { data: updated, error } = await supabase
      .from('option_requests')
      .update({
        final_status: 'job_confirmed',
        status: 'confirmed',
      })
      .eq('id', id)
      .eq('final_status', 'option_confirmed')
      .select(OPTION_REQUEST_SELECT)
      .maybeSingle();

    if (error) {
      console.error('clientConfirmJobOnSupabase error:', error);
      return false;
    }

    if (!updated) {
      console.warn('clientConfirmJobOnSupabase: no row updated — not in option_confirmed state or concurrent call', id);
      return false;
    }

    // The DB trigger tr_auto_booking_event_on_confirm handles new booking_events
    // when status transitions in_negotiation → confirmed. For the option→job
    // promotion path (status was already 'confirmed'), the trigger does not fire
    // again, so we call createBookingEventFromRequest explicitly here.
    // uidx_booking_events_per_option_request ensures idempotency if both paths
    // somehow race.
    await createBookingEventFromRequest(updated as SupabaseOptionRequest);

    const up = updated as SupabaseOptionRequest;
    logAction(up.organization_id, 'clientConfirmJobOnSupabase', {
      type: 'option',
      action: 'option_confirmed',
      entityId: id,
      newData: { phase: 'job_confirmed', final_status: 'job_confirmed', agency_id: up.agency_id, model_id: up.model_id },
      oldData: { final_status: 'option_confirmed' },
    });

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
    // Reject messages containing unsafe URLs (mirrors messengerSupabase.sendMessage)
    const allUrls = normalized.match(/https?:\/\/[^\s]+/gi) ?? [];
    const safeUrls = extractSafeUrls(normalized);
    if (allUrls.length > safeUrls.length) {
      console.warn('addOptionMessage: message contains unsafe URLs');
      void logSecurityEvent({ type: 'invalid_url', userId: user?.id ?? null, metadata: { service: 'optionRequestsSupabase' } });
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

    // Fire-and-forget: notify the opposing party about the new message.
    // agency sends → notify client user (client_id)
    // client sends → notify agency org (resolved from agency_id, NOT organization_id which is the CLIENT org)
    void (async () => {
      const { data: req } = await supabase
        .from('option_requests')
        .select('client_id, agency_id, organization_id')
        .eq('id', requestId)
        .maybeSingle();
      if (!req) return;

      if (fromRole === 'agency' && req.client_id) {
        await createNotification({
          user_id: req.client_id as string,
          type: 'new_option_message',
          title: uiCopy.notifications.newOptionMessage.title,
          message: uiCopy.notifications.newOptionMessage.message,
          metadata: { option_request_id: requestId },
        });
      } else if (fromRole === 'client' && req.agency_id) {
        // Resolve the agency organisation — req.organization_id is the CLIENT org, not the agency.
        const agencyOrgId = await fetchAgencyOrgId(req.agency_id as string);
        if (!agencyOrgId) {
          console.error('[notifications] addOptionMessage: agency org not found for agency_id', req.agency_id, '— notification skipped.');
        } else {
          await createNotification({
            organization_id: agencyOrgId,
            type: 'new_option_message',
            title: uiCopy.notifications.newOptionMessage.title,
            message: uiCopy.notifications.newOptionMessage.message,
            metadata: { option_request_id: requestId },
          });
        }
      }
    })();

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

    const { data: updatedRows, error } = await supabase
      .from('option_requests')
      .update({
        model_approval: approval,
        model_approved_at: approval === 'approved' ? new Date().toISOString() : null,
      })
      .eq('id', id)
      // Race-condition guard: only update if still in pending state.
      // Prevents double-approve / concurrent approve+reject conflicts.
      .eq('model_approval', 'pending')
      .select('id, organization_id');

    if (error) { console.error('updateModelApproval error:', error); return false; }
    if (!updatedRows || updatedRows.length === 0) {
      console.warn('updateModelApproval: no row updated — already approved/rejected or concurrent request', { id, approval });
      return false;
    }
    const row = updatedRows[0] as { id: string; organization_id: string | null };
    logAction(row.organization_id, 'updateModelApproval', {
      type: 'option',
      action: approval === 'approved' ? 'option_confirmed' : 'option_rejected',
      entityId: id,
      newData: { model_approval: approval },
      oldData: { model_approval: 'pending' },
    });
    return true;
  } catch (e) {
    console.error('updateModelApproval exception:', e);
    return false;
  }
}

export async function getOptionRequestsForModel(
  modelId: string,
  limit = 200,
): Promise<SupabaseOptionRequest[]> {
  try {
    const { data, error } = await supabase
      .from('option_requests')
      .select(OPTION_REQUEST_SELECT)
      .eq('model_id', modelId)
      .order('created_at', { ascending: false })
      .limit(limit);
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
      .order('created_at', { ascending: true })
      .limit(100);
    if (error) { console.error('getOptionDocuments error:', error); return []; }
    return (data ?? []) as SupabaseOptionDocument[];
  } catch (e) {
    console.error('getOptionDocuments exception:', e);
    return [];
  }
}

/**
 * Returns a short-lived signed URL (1 hour) for displaying an option document.
 *
 * VULN-M3 fix: documents now store the raw storage path in file_url rather than
 * a pre-generated signed URL. This function must be used wherever the URL is
 * needed for display or download — never persist the returned URL.
 *
 * Backward-compatible: if file_url is already a full https:// URL (legacy rows
 * created before the fix), it is returned as-is.
 */
export async function resolveOptionDocumentUrl(doc: SupabaseOptionDocument): Promise<string | null> {
  try {
    if (doc.file_url.startsWith('http://') || doc.file_url.startsWith('https://')) {
      return doc.file_url;
    }
    const { data, error } = await supabase.storage
      .from('chat-files')
      .createSignedUrl(doc.file_url, 3600);
    if (error || !data?.signedUrl) {
      console.error('resolveOptionDocumentUrl error:', error);
      return null;
    }
    return data.signedUrl;
  } catch (e) {
    console.error('resolveOptionDocumentUrl exception:', e);
    return null;
  }
}

/** Prefix for `confirmImageRights({ sessionKey })` — future option-doc UI: `` `${OPTION_DOCUMENT_SESSION_KEY_PREFIX}${requestId}` ``. */
export const OPTION_DOCUMENT_SESSION_KEY_PREFIX = 'option-doc:';

/**
 * @deprecated No production caller (2026-04). Do **not** wire UI to this until all steps exist.
 *
 * Required order for a future UI (no shortcuts):
 * 1. English checkbox: user confirms rights to the file (same legal pattern as other uploads).
 * 2. `confirmImageRights` with `sessionKey` = `OPTION_DOCUMENT_SESSION_KEY_PREFIX + requestId` (see constant below) — must succeed.
 * 3. Call this function (internally uses `guardUploadSession` before `storage.upload`).
 *
 * Storage INSERT on `chat-files` is still allowed by policy without the consent row — first-party services must enforce steps 1–2.
 */
export async function uploadOptionDocument(
  requestId: string,
  uploadedBy: string,
  file: File | Blob,
  fileName: string
): Promise<SupabaseOptionDocument | null> {
  try {
  const { data: authUser } = await supabase.auth.getUser();
  if (!authUser.user) {
    console.error('uploadOptionDocument: not authenticated');
    return null;
  }
  const sessionKey = `${OPTION_DOCUMENT_SESSION_KEY_PREFIX}${requestId}`;
  const rights = await guardUploadSession(authUser.user.id, sessionKey);
  if (!rights.ok) {
    console.warn('uploadOptionDocument: image rights confirmation missing — call confirmImageRights first', sessionKey);
    return null;
  }

  // MIME type and size validation before any storage interaction.
  const { validateFile } = await import('../../lib/validation');
  const fileValidation = validateFile(file);
  if (!fileValidation.ok) {
    console.error('uploadOptionDocument: file validation failed', fileValidation.error);
    return null;
  }

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

  // VULN-M3 fix: store the storage PATH (not a pre-generated signed URL) in
  // file_url. Signed URLs expire after 1 hour, making persisted URLs useless.
  // Use resolveOptionDocumentUrl() at display time to get a fresh signed URL.
  const { data, error } = await supabase
    .from('option_documents')
    .insert({
      option_request_id: requestId,
      uploaded_by: uploadedBy,
      file_name: fileName,
      file_url: path,
      file_type: fileName.split('.').pop() || null,
    })
    .select()
    .single();
  if (error) { console.error('uploadOptionDocument error:', error); return null; }
  const doc = data as SupabaseOptionDocument;
  console.warn('[uploadOptionDocument] org context unavailable — audit log skipped for', requestId);
  return doc;
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
 * Idempotent: ein Unique-Constraint-Fehler (23505) auf uidx_booking_events_per_option_request
 * wird stillschweigend ignoriert — die DB-Trigger-Logik hat das Event bereits angelegt.
 * Wird intern von clientConfirmJobOnSupabase aufgerufen (status war bereits confirmed;
 * der Trigger tr_auto_booking_event_on_confirm feuert nicht erneut).
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

    const { data: user } = await supabase.auth.getUser();
    const { error } = await supabase
      .from('booking_events')
      .insert({
        model_id: req.model_id,
        client_org_id: req.organization_id ?? null,
        agency_org_id: (agencyOrg as { id: string } | null)?.id ?? null,
        date: req.requested_date,
        type: eventType,
        status: 'pending' as const,
        title: req.client_name ? `${req.client_name} – ${eventType}` : null,
        note: null,
        source_option_request_id: req.id,
        created_by: user.user?.id ?? null,
      });

    if (error) {
      // 23505 = unique_violation: the DB trigger already created this booking_event.
      // Silently ignore — idempotency is guaranteed by uidx_booking_events_per_option_request.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if ((error as any).code === '23505') {
        console.info('createBookingEventFromRequest: booking_event already exists (idempotent, skipped)', req.id);
        return;
      }
      console.error('createBookingEventFromRequest insert error:', error);
      return;
    }
    const bookingOrgId = (agencyOrg as { id: string } | null)?.id ?? req.organization_id;
    logAction(bookingOrgId, 'createBookingEventFromRequest', {
      type: 'booking',
      action: 'booking_created',
      entityId: req.id,
      newData: { type: eventType, source_option_request_id: req.id },
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
      // Kein Model-Account → Agency-Bestätigung reicht aus.
      // Guard: .eq('status', 'in_negotiation') makes the UPDATE atomic — a
      // double-tap or concurrent call returns no row and is safely ignored.
      // The booking_event is now created by the DB trigger
      // tr_auto_booking_event_on_confirm (migration_chaos_hardening_2026_04.sql).
      const { data: updateData, error } = await supabase
        .from('option_requests')
        .update({
          client_price_status: 'accepted',
          final_status: 'option_confirmed',
          model_approval: 'approved',
          model_approved_at: new Date().toISOString(),
          status: 'confirmed',
        })
        .eq('id', id)
        .eq('status', 'in_negotiation')
        .select('id')
        .maybeSingle();

      if (error) {
        console.error('agencyAcceptRequest (no account) update error:', error);
        return null;
      }
      if (!updateData?.id) {
        console.warn('agencyAcceptRequest: no row updated — already accepted or concurrent call', id);
        return null;
      }

      logAction(r.organization_id, 'agencyAcceptRequest:no-account', {
        type: 'option',
        action: 'option_confirmed',
        entityId: id,
        newData: { result: 'confirmed', model_account_linked: false, agency_id: r.agency_id },
      });
      return 'confirmed';
    }

    // If the model has already pre-approved (via updateModelApproval), the agency
    // accepting immediately finalises the booking — no second model step needed.
    // This avoids the model_approval deadlock: modelConfirmOptionRequest requires
    // model_approval = 'pending', but it would already be 'approved' after pre-approval.
    if (r.model_approval === 'approved') {
      const { data: updateData, error } = await supabase
        .from('option_requests')
        .update({
          client_price_status: 'accepted',
          final_status: 'option_confirmed',
          model_approved_at: r.model_approved_at ?? new Date().toISOString(),
          status: 'confirmed',
        })
        .eq('id', id)
        .eq('status', 'in_negotiation')
        .select('id')
        .maybeSingle();

      if (error) {
        console.error('agencyAcceptRequest (pre-approved model) update error:', error);
        return null;
      }
      if (!updateData?.id) {
        console.warn('agencyAcceptRequest: no row updated — already processed or concurrent call', id);
        return null;
      }

      logAction(r.organization_id, 'agencyAcceptRequest:pre-approved', {
        type: 'option',
        action: 'option_confirmed',
        entityId: id,
        newData: { result: 'confirmed', model_approval: 'pre-approved', agency_id: r.agency_id },
      });
      return 'confirmed';
    }

    // Model hat Account aber noch nicht vorab genehmigt → wartet auf Model-Bestätigung.
    // Same atomic guard: only transition if still in_negotiation.
    const { data: updateData, error } = await supabase
      .from('option_requests')
      .update({
        client_price_status: 'accepted',
        final_status: 'option_confirmed',
        // model_approval bleibt 'pending' → modelConfirmOptionRequest wird ausgeführt
      })
      .eq('id', id)
      .eq('status', 'in_negotiation')
      .select('id')
      .maybeSingle();

    if (error) {
      console.error('agencyAcceptRequest (with account) update error:', error);
      return null;
    }
    if (!updateData?.id) {
      console.warn('agencyAcceptRequest: no row updated — already processed or concurrent call', id);
      return null;
    }

    logAction(r.organization_id, 'agencyAcceptRequest:awaiting-model', {
      type: 'option',
      action: 'option_confirmed',
      entityId: id,
      newData: { result: 'awaiting_model_confirmation', model_account_linked: true, agency_id: r.agency_id },
    });

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
 * Guard: .eq('status', 'in_negotiation') verhindert Ablehnung eines bereits
 * bestätigten Requests (VULN-H2). Der DB-Trigger trg_validate_option_status
 * erzwingt dies zusätzlich auf DB-Ebene — die doppelte Schicht sorgt dafür,
 * dass der Caller eine klare Warnung erhält, bevor die DB ein Exception wirft.
 *
 * Bewusste Entscheidung: final_status=null statt 'option_pending',
 * weil 'option_pending' eine AKTIVE Verhandlung signalisiert.
 */
export async function agencyRejectRequest(id: string): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from('option_requests')
      .update({
        status: 'rejected',
        final_status: null,
        client_price_status: 'rejected',
      })
      .eq('id', id)
      .eq('status', 'in_negotiation') // VULN-H2: verhindert Reject nach Confirm
      .select('id, client_id, organization_id')
      .maybeSingle();

    if (error) {
      console.error('agencyRejectRequest error:', error);
      return false;
    }
    if (!data?.id) {
      console.warn('agencyRejectRequest: no row updated — request not in_negotiation or already rejected', id);
      return false;
    }

    // Notify the client about the rejection (fire-and-forget).
    const row = data as { id: string; client_id: string | null; organization_id: string | null };
    logAction(row.organization_id, 'agencyRejectRequest', {
      type: 'option',
      action: 'option_rejected',
      entityId: id,
      newData: { rejected_by: 'agency' },
    });
    if (row.client_id) {
      void createNotification({
        user_id: row.client_id,
        type: 'request_rejected_by_agency',
        title: uiCopy.notifications.requestRejectedByAgency.title,
        message: uiCopy.notifications.requestRejectedByAgency.message,
        metadata: { option_request_id: id },
      });
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

    const { data: confirmData, error } = await supabase
      .from('option_requests')
      .update({
        model_approval: 'approved',
        model_approved_at: new Date().toISOString(),
        status: 'confirmed',
      })
      .eq('id', id)
      // Race condition guard: only confirm if still in the expected state.
      // Prevents double-confirm when two requests arrive in parallel.
      .eq('model_approval', 'pending')
      .eq('final_status', 'option_confirmed')
      .select('id')
      .maybeSingle();

    if (error) {
      console.error('modelConfirmOptionRequest update error:', error);
      return false;
    }
    if (!confirmData?.id) {
      console.warn('modelConfirmOptionRequest: no row updated — concurrent state change', { id });
      return false;
    }

    // booking_event is created by the DB trigger tr_auto_booking_event_on_confirm
    // (migration_chaos_hardening_2026_04.sql) — no client-side call needed here.

    logAction(r.organization_id, 'modelConfirmOptionRequest', {
      type: 'option',
      action: 'option_confirmed',
      entityId: id,
      newData: {
        confirmed_by: 'model',
        agency_id: r.agency_id,
        model_id: r.model_id,
      },
    });

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
 * Sendet Notifications an Agency-Org und Client nach erfolgreicher Ablehnung.
 */
export async function modelRejectOptionRequest(id: string): Promise<boolean> {
  try {
    const { data: rejectData, error } = await supabase
      .from('option_requests')
      .update({
        model_approval: 'rejected',
        status: 'rejected',
      })
      .eq('id', id)
      // Guard: only reject when the model approval is still pending.
      // Prevents transitioning an already-approved or already-rejected row.
      .eq('model_approval', 'pending')
      .select('id, agency_id, client_id, organization_id')
      .maybeSingle();

    if (error) {
      console.error('modelRejectOptionRequest error:', error);
      return false;
    }
    if (!rejectData?.id) {
      console.warn('modelRejectOptionRequest: no row updated — concurrent state change', { id });
      return false;
    }

    const rejectRow = rejectData as { id: string; agency_id: string | null; client_id: string | null; organization_id: string | null };
    logAction(rejectRow.organization_id, 'modelRejectOptionRequest', {
      type: 'option',
      action: 'option_rejected',
      entityId: id,
      newData: { rejected_by: 'model' },
    });

    // Notify agency and client about the model rejection (fire-and-forget).
    void (async () => {
      try {
        const row = rejectData as { id: string; agency_id: string | null; client_id: string | null; organization_id: string | null };
        const notifications: Parameters<typeof createNotifications>[0] = [];

        if (row.agency_id) {
          const agencyOrgId = await fetchAgencyOrgId(row.agency_id);
          if (!agencyOrgId) {
            console.error('[notifications] modelRejectOptionRequest: agency org not found for agency_id', row.agency_id, '— agency notification skipped.');
          } else {
            notifications.push({
              organization_id: agencyOrgId,
              type: 'request_rejected_by_model',
              title: uiCopy.notifications.requestRejectedByModel.title,
              message: uiCopy.notifications.requestRejectedByModel.message,
              metadata: { option_request_id: id },
            });
          }
        }
        if (row.client_id) {
          notifications.push({
            user_id: row.client_id,
            type: 'request_rejected_by_model',
            title: uiCopy.notifications.requestRejectedByModel.title,
            message: uiCopy.notifications.requestRejectedByModel.message,
            metadata: { option_request_id: id },
          });
        }
        if (notifications.length > 0) await createNotifications(notifications);
      } catch (e) {
        console.error('modelRejectOptionRequest notification exception:', e);
      }
    })();

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
  try {
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
  } catch (e) {
    console.error('sendAgencyInvitation exception:', e);
    return null;
  }
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

    if (!agencyOrgId) {
      console.error('[notifications] notifyModelConfirmedOption: agency org not found for agency_id', req.agency_id, '— agency notification skipped.');
    } else {
      notifications.push({
        organization_id: agencyOrgId,
        type: 'model_confirmed',
        title: uiCopy.notifications.modelConfirmed.title,
        message: uiCopy.notifications.modelConfirmed.message,
        metadata: { option_request_id: req.id },
      });
    }

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
