import { supabase } from '../../lib/supabase';
import { pooledSubscribe } from './realtimeChannelPool';
import type { BookingEventType } from './bookingEventsSupabase';
import { createNotification, createNotifications } from './notificationsSupabase';
import { uiCopy } from '../constants/uiCopy';
import {
  normalizeInput,
  MESSAGE_MAX_LENGTH,
  validateText,
  sanitizeHtml,
  extractSafeUrls,
  logSecurityEvent,
  validateFile,
  checkMagicBytes,
  sanitizeUploadBaseName,
  checkExtensionConsistency,
  CHAT_ALLOWED_MIME_TYPES,
} from '../../lib/validation';
import { convertHeicToJpegWithStatus, stripExifAndCompress } from './imageUtils';
import { checkAndIncrementStorage, decrementStorage } from './agencyStorageSupabase';
import { guardUploadSession } from './gdprComplianceSupabase';
import { logAction } from '../utils/logAction';
import { logger } from '../utils/logger';

export const OPTION_REQUEST_SELECT =
  'id, client_id, model_id, agency_id, requested_date, status, project_id, client_name, model_name, job_description, proposed_price, agency_counter_price, client_price_status, final_status, request_type, currency, start_time, end_time, model_approval, model_approved_at, model_account_linked, booker_id, organization_id, agency_organization_id, client_organization_id, client_organization_name, agency_organization_name, created_by, agency_assignee_user_id, is_agency_only, agency_event_group_id, created_at, updated_at';

/**
 * Atomic UPDATE guards: many mutations use `.eq('status', 'in_negotiation')` (or similar) so concurrent
 * transitions do not double-apply — that is intentional concurrency control, not business “status filtering”.
 * List reads prefer workflow columns (`final_status`, `client_price_status`, `model_approval`) in attention/calendar utils.
 */

/**
 * Model-linked app: no price / negotiation columns (defense-in-depth vs UI-only hiding).
 *
 * INVARIANT D (system-invariants.mdc — MODEL DATA SAFETY CONTRACT):
 * - `currency` is intentionally INCLUDED. It is non-commercial metadata that pairs with
 *   `start_time` / `end_time` for date/time formatting in the model UI; it carries no
 *   negotiated value and never leaks `proposed_price`, `agency_counter_price`, or
 *   `client_price_status`.
 * - VERBOTEN here: any column from the negotiation/price axis. If a new commercial
 *   field is added to `option_requests`, it MUST stay out of this select.
 */
export const OPTION_REQUEST_SELECT_MODEL_SAFE =
  'id, client_id, model_id, agency_id, requested_date, status, project_id, client_name, model_name, job_description, final_status, request_type, currency, start_time, end_time, model_approval, model_approved_at, model_account_linked, booker_id, organization_id, agency_organization_id, client_organization_id, client_organization_name, agency_organization_name, created_by, agency_assignee_user_id, is_agency_only, agency_event_group_id, created_at, updated_at';

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
  /** Optional role / shoot description set by the client at booking time. Shown to the model. */
  job_description: string | null;
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
  /** Denormalized client org display name (like client_name). Safe for model-facing views. */
  client_organization_name: string | null;
  /** Denormalized agency org display name. Set on agency-only requests for model visibility. */
  agency_organization_name: string | null;
  created_by: string | null;
  agency_assignee_user_id: string | null;
  /** true = agency-only manual event (no client party, no price negotiation). */
  is_agency_only?: boolean;
  /** Links to agency_event_groups.id for grouped manual events. */
  agency_event_group_id?: string | null;
  created_at: string;
  updated_at: string;
};

/** Row from {@link getOptionRequestsForModel} — price fields omitted at the API layer. */
export type SupabaseOptionRequestModelSafe = Omit<
  SupabaseOptionRequest,
  'proposed_price' | 'agency_counter_price' | 'client_price_status'
>;

export type SupabaseOptionMessage = {
  id: string;
  option_request_id: string;
  from_role: 'client' | 'agency' | 'model' | 'system';
  text: string;
  // optional, for future system / typed messages
  message_type?: 'user' | 'system';
  booker_id: string | null;
  booker_name: string | null;
  created_at: string;
};

/** Must match public.insert_option_request_system_message kinds + SQL CASE. */
export type SystemOptionMessageKind =
  | 'no_model_account'
  | 'no_model_account_client_notice'
  | 'agency_confirmed_availability'
  | 'agency_accepted_price'
  | 'agency_declined_price'
  | 'agency_counter_offer'
  | 'client_accepted_counter'
  | 'client_rejected_counter'
  | 'job_confirmed_by_client'
  | 'job_confirmed_by_agency'
  | 'model_approved_booking'
  | 'model_declined_availability';

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
  /**
   * When set (client web), restricts the query to this client org (defense-in-depth + RLS).
   * Matches rows where client_organization_id or organization_id equals this UUID.
   */
  clientOrganizationId?: string | null;
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
    console.warn(
      '[getOptionRequests] called without orgId — relying on RLS only (no defense-in-depth org filter)',
    );
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
    if (error) {
      console.error('getOptionRequests error:', error);
      return [];
    }
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
  if (error) {
    console.error('getOptionRequestById error:', error);
    return null;
  }
  return data as SupabaseOptionRequest | null;
}

export async function getOptionRequestByIdModelSafe(
  id: string,
): Promise<SupabaseOptionRequest | null> {
  const { data, error } = await supabase
    .from('option_requests')
    .select(OPTION_REQUEST_SELECT_MODEL_SAFE)
    .eq('id', id)
    .maybeSingle();
  if (error) {
    console.error('getOptionRequestByIdModelSafe error:', error);
    return null;
  }
  return data as SupabaseOptionRequest | null;
}

export async function getOptionRequestsByProject(
  projectId: string,
  opts?: OptionRequestListOptions,
  orgId?: string,
): Promise<SupabaseOptionRequest[]> {
  if (orgId !== undefined && !orgId) {
    console.error('[getOptionRequestsByProject] orgId provided but empty — call aborted');
    return [];
  }
  try {
    let q = supabase
      .from('option_requests')
      .select(OPTION_REQUEST_SELECT)
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
      .limit(opts?.limit ?? 100);
    if (orgId) q = q.eq('organization_id', orgId);
    if (opts?.afterCreatedAt) q = q.lt('created_at', opts.afterCreatedAt);
    const { data, error } = await q;
    if (error) {
      console.error('getOptionRequestsByProject error:', error);
      return [];
    }
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
    const org = opts?.clientOrganizationId != null ? String(opts.clientOrganizationId).trim() : '';
    if (org) {
      q = q.or(`client_organization_id.eq.${org},organization_id.eq.${org}`);
    }
    if (opts?.afterCreatedAt) q = q.lt('created_at', opts.afterCreatedAt);
    const { data, error } = await q;
    if (error) {
      console.error('getOptionRequestsForCurrentClient error:', error);
      return [];
    }
    return (data ?? []) as SupabaseOptionRequest[];
  } catch (e) {
    console.error('getOptionRequestsForCurrentClient exception:', e);
    return [];
  }
}

/** @deprecated Parameter wird ignoriert; nutzt RLS wie getOptionRequestsForCurrentClient. */
export async function getOptionRequestsForClient(
  _clientId: string,
): Promise<SupabaseOptionRequest[]> {
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
    if (error) {
      console.error('getOptionRequestsForAgency error:', error);
      return [];
    }
    return (data ?? []) as SupabaseOptionRequest[];
  } catch (e) {
    console.error('getOptionRequestsForAgency exception:', e);
    return [];
  }
}

export async function resolveAgencyOrganizationIdForOptionRequest(
  modelId: string,
  agencyId: string,
  countryCode: string | null | undefined,
): Promise<string | null> {
  if (!modelId?.trim() || !agencyId?.trim()) return null;
  try {
    const { data, error } = await supabase.rpc(
      'resolve_agency_organization_id_for_option_request',
      {
        p_model_id: modelId.trim(),
        p_agency_id: agencyId.trim(),
        p_country_code: countryCode?.trim() ? countryCode.trim() : null,
      },
    );
    if (error) {
      const e = error as { code?: string; message?: string; details?: string; hint?: string };
      console.error('[resolveAgencyOrganizationIdForOptionRequest]', {
        code: e.code,
        message: e.message,
        details: e.details,
        hint: e.hint,
      });
      return null;
    }
    if (data == null) return null;
    const s = String(data).trim();
    return s !== '' ? s : null;
  } catch (ex) {
    console.error('[resolveAgencyOrganizationIdForOptionRequest] exception:', ex);
    return null;
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
  /** Optional role / shoot description set by the client. Shown to the model in their inbox. */
  job_description?: string;
  proposed_price?: number;
  currency?: string;
  start_time?: string;
  end_time?: string;
  organization_id?: string | null;
  /** Org-zentrische Agentur-Org (organizations.id, type='agency'). Sollte immer gesetzt werden. */
  agency_organization_id?: string | null;
  /** Org-zentrische Client-Org (organizations.id, type='client'). Sollte immer gesetzt werden. */
  client_organization_id?: string | null;
  /** Denormalized client org display name. */
  client_organization_name?: string | null;
  created_by?: string | null;
}): Promise<SupabaseOptionRequest | null> {
  const orgId =
    req.organization_id && String(req.organization_id).trim() !== ''
      ? String(req.organization_id).trim()
      : null;
  const agencyOrgId =
    req.agency_organization_id && String(req.agency_organization_id).trim() !== ''
      ? String(req.agency_organization_id).trim()
      : null;
  const clientOrgId =
    req.client_organization_id && String(req.client_organization_id).trim() !== ''
      ? String(req.client_organization_id).trim()
      : null;

  // Derive model_account_linked from models.user_id (defense-in-depth;
  // DB BEFORE INSERT trigger also sets this, but we send it explicitly so the
  // optimistic UI value from the RETURNING row is immediately correct).
  let modelAccountLinked = false;
  try {
    const { data: modelRow } = await supabase
      .from('models')
      .select('user_id')
      .eq('id', req.model_id)
      .maybeSingle();
    modelAccountLinked = !!(modelRow as { user_id?: string | null } | null)?.user_id;
  } catch (e) {
    console.error('[insertOptionRequest] model user_id lookup failed, defaulting to false', e);
  }

  const insertRow = {
    client_id: req.client_id,
    model_id: req.model_id,
    agency_id: req.agency_id,
    requested_date: req.requested_date,
    project_id: req.project_id || null,
    client_name: req.client_name ? sanitizeHtml(normalizeInput(req.client_name)) : null,
    model_name: req.model_name ? sanitizeHtml(normalizeInput(req.model_name)) : null,
    job_description: req.job_description ? sanitizeHtml(normalizeInput(req.job_description)) : null,
    proposed_price: req.proposed_price || null,
    agency_counter_price: null,
    request_type: req.request_type || 'option',
    currency: req.currency || null,
    start_time: req.start_time || null,
    end_time: req.end_time || null,
    organization_id: orgId,
    agency_organization_id: agencyOrgId,
    client_organization_id: clientOrgId,
    client_organization_name: req.client_organization_name
      ? sanitizeHtml(normalizeInput(req.client_organization_name))
      : null,
    created_by: req.created_by ?? null,
    model_account_linked: modelAccountLinked,
  };

  console.info('[insertOptionRequest] insertRowPreview', {
    insertKeys: Object.keys(insertRow).sort(),
    sendsModelApproval: Object.prototype.hasOwnProperty.call(insertRow, 'model_approval'),
    sendsModelApprovedAt: Object.prototype.hasOwnProperty.call(insertRow, 'model_approved_at'),
    sendsModelAccountLinked: Object.prototype.hasOwnProperty.call(
      insertRow,
      'model_account_linked',
    ),
    sendsStatus: Object.prototype.hasOwnProperty.call(insertRow, 'status'),
    sendsFinalStatus: Object.prototype.hasOwnProperty.call(insertRow, 'final_status'),
    sendsClientPriceStatus: Object.prototype.hasOwnProperty.call(insertRow, 'client_price_status'),
    organizationIdPrefix: orgId ? orgId.slice(0, 8) : null,
    clientOrgIdPrefix: clientOrgId ? clientOrgId.slice(0, 8) : null,
  });

  const { data, error } = await supabase
    .from('option_requests')
    .insert(insertRow)
    .select(OPTION_REQUEST_SELECT)
    .single();
  if (error) {
    const e = error as { code?: string; message?: string; details?: string; hint?: string };
    console.error('[insertOptionRequest]', {
      code: e.code,
      message: e.message,
      details: e.details,
      hint: e.hint,
      insertRowDefaultsExpected: {
        status: 'in_negotiation',
        final_status: 'option_pending',
        client_price_status: 'pending',
        model_approval: 'pending',
        model_account_linked: false,
      },
      payloadSummary: {
        hasOrganizationId: !!orgId,
        hasClientOrgId: !!clientOrgId,
        hasAgencyOrgId: !!agencyOrgId,
        organization_id_set: !!orgId,
        client_organization_id_set: !!clientOrgId,
        agency_organization_id_set: !!agencyOrgId,
        organizationIdPrefix: orgId ? orgId.slice(0, 8) : null,
        clientOrganizationIdPrefix: clientOrgId ? clientOrgId.slice(0, 8) : null,
        agencyOrganizationIdPrefix: agencyOrgId ? agencyOrgId.slice(0, 8) : null,
        hasAgencyId: !!(req.agency_id && String(req.agency_id).trim()),
        hasProjectId: !!(req.project_id && String(req.project_id).trim()),
        requestType: req.request_type ?? 'option',
      },
    });
    logger.error('optionRequests', 'insertOptionRequest failed', {
      code: e.code,
      message: e.message,
      hasOrgId: !!orgId,
      hasAgencyOrgId: !!agencyOrgId,
      requestType: req.request_type ?? 'option',
    });
    return null;
  }

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
  // Prefer inserted.agency_organization_id (readable under client RLS) over orgs table lookup.
  void (async () => {
    const agencyOrgId = await resolveAgencyOrgIdForOptionNotification(
      inserted.agency_id,
      inserted.agency_organization_id,
    );
    if (!agencyOrgId) {
      console.error(
        '[notifications] insertOptionRequest: agency org not found for agency_id',
        inserted.agency_id,
        '— notification skipped.',
      );
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
  fromStatus?: 'pending' | 'in_negotiation' | 'confirmed' | 'rejected',
): Promise<boolean> {
  try {
    let q = supabase.from('option_requests').update({ status }).eq('id', id);
    if (fromStatus) {
      // Optimistic concurrency guard: the update only succeeds if the row is
      // still in the expected prior state, preventing invalid state skips
      // (e.g. rejected → confirmed) via concurrent or replayed requests.
      q = q.eq('status', fromStatus);
    }
    const { data, error } = await q.select('id, organization_id').maybeSingle();
    if (error) {
      console.error('updateOptionRequestStatus error:', error);
      logger.error('optionRequests', 'updateOptionRequestStatus update failed', {
        message: error.message,
        code: (error as { code?: string }).code,
        targetStatus: status,
        fromStatus,
      });
      return false;
    }
    if (!data?.id) {
      console.warn(
        'updateOptionRequestStatus: no row updated — concurrent state change or wrong fromStatus',
        { id, fromStatus, targetStatus: status },
      );
      return false;
    }
    const orgId = (data as { id: string; organization_id: string | null }).organization_id;
    const auditAction =
      status === 'confirmed'
        ? 'option_confirmed'
        : status === 'rejected'
          ? 'option_rejected'
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
  fields: { requested_date: string; start_time?: string | null; end_time?: string | null },
): Promise<boolean> {
  try {
    const dateNorm = fields.requested_date.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateNorm)) {
      console.error('updateOptionRequestSchedule: invalid date');
      return false;
    }
    const { data, error } = await supabase.rpc('agency_update_option_schedule', {
      p_option_id: id,
      p_date: dateNorm,
      p_start_time: fields.start_time ?? null,
      p_end_time: fields.end_time ?? null,
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
  endTime?: string | null,
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
    console.warn(
      '[modelUpdateOptionSchedule] org context unavailable — audit log skipped for',
      optionId,
    );
    return true;
  } catch (e) {
    console.error('modelUpdateOptionSchedule exception:', e);
    return false;
  }
}

/**
 * Agency sets a counter-offer price.
 * Uses atomic RPC agency_set_counter_offer which acquires an advisory lock AND
 * performs the update within a single DB transaction — prevents concurrent
 * bookers from racing (the old two-roundtrip pattern was unsafe).
 * Guard: only allowed while still in_negotiation.
 */
export async function setAgencyCounterOffer(id: string, counterPrice: number): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc('agency_set_counter_offer', {
      p_request_id: id,
      p_counter_price: counterPrice,
    });
    if (error) {
      console.error('setAgencyCounterOffer RPC error:', error);
      return false;
    }
    const result = data as {
      ok: boolean;
      reason?: string;
      agency_id?: string;
      agency_organization_id?: string | null;
    } | null;
    if (!result?.ok) {
      console.warn('setAgencyCounterOffer: RPC returned not ok —', result?.reason ?? 'unknown', id);
      return false;
    }
    const auditOrgId = await resolveAgencyOrgIdForOptionNotification(
      result.agency_id ?? '',
      result.agency_organization_id ?? null,
    );
    if (auditOrgId) {
      logAction(auditOrgId, 'setAgencyCounterOffer', {
        type: 'option',
        action: 'option_price_countered',
        entityId: id,
        newData: { counter_price: counterPrice },
      });
    } else {
      console.warn('[setAgencyCounterOffer] could not resolve agency org — audit log skipped', id);
    }
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
 * Canonical agreed fee after success: `agency_counter_price ?? proposed_price` (see `getCanonicalAgreedPrice`).
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
    if (error) {
      console.error('agencyAcceptClientPrice RPC error:', error);
      return false;
    }
    if (!data) {
      console.warn(
        'agencyAcceptClientPrice: RPC returned false — request not in expected state or caller not agency member',
        id,
      );
      return false;
    }
    void (async () => {
      try {
        const { data: row } = await supabase
          .from('option_requests')
          .select('agency_id, agency_organization_id')
          .eq('id', id)
          .maybeSingle();
        const ar = row as {
          agency_id: string | null;
          agency_organization_id: string | null;
        } | null;
        const auditOrg = ar
          ? await resolveAgencyOrgIdForOptionNotification(
              ar.agency_id ?? '',
              ar.agency_organization_id,
            )
          : null;
        if (auditOrg) {
          logAction(auditOrg, 'agencyAcceptClientPrice', {
            type: 'option',
            action: 'option_price_accepted',
            entityId: id,
            newData: { accepted_by: 'agency' },
            oldData: { client_price_status: 'pending' },
          });
        } else {
          console.warn('[agencyAcceptClientPrice] could not resolve agency org for audit log', id);
        }
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
      .select('id, agency_id, agency_organization_id')
      .maybeSingle();
    if (error) {
      console.error('agencyRejectClientPrice error:', error);
      return false;
    }
    if (!data?.id) {
      console.warn(
        'agencyRejectClientPrice: no row updated — offer not pending or request not in_negotiation',
        id,
      );
      return false;
    }
    const rowAR = data as {
      id: string;
      agency_id: string | null;
      agency_organization_id: string | null;
    };
    const auditOrgAR = await resolveAgencyOrgIdForOptionNotification(
      rowAR.agency_id ?? '',
      rowAR.agency_organization_id,
    );
    if (auditOrgAR) {
      logAction(auditOrgAR, 'agencyRejectClientPrice', {
        type: 'option',
        action: 'option_price_rejected',
        entityId: id,
        newData: { rejected_by: 'agency' },
        oldData: { client_price_status: 'pending' },
      });
    } else {
      console.warn(
        '[agencyRejectClientPrice] could not resolve agency org — audit log skipped',
        id,
      );
    }
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
 * Canonical agreed fee after success: `agency_counter_price ?? proposed_price` (see `getCanonicalAgreedPrice`).
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
    if (error) {
      console.error('clientAcceptCounterPrice RPC error:', error);
      return false;
    }
    if (!data) {
      console.warn(
        'clientAcceptCounterPrice: RPC returned false — counter-offer no longer pending or caller not client',
        id,
      );
      return false;
    }
    void (async () => {
      try {
        const { data: row } = await supabase
          .from('option_requests')
          .select('organization_id')
          .eq('id', id)
          .maybeSingle();
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
 * Kanonisch: SECURITY DEFINER RPC `client_reject_counter_offer` setzt nur
 * `client_price_status = 'rejected'` (kein `status = rejected` — Negotiation
 * bleibt offen für neuen Counter; vermeidet Drift/42703 bei direktem PATCH auf `status`).
 */
export async function clientRejectCounterOfferOnSupabase(id: string): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc('client_reject_counter_offer', {
      p_request_id: id,
    });
    if (error) {
      console.error('clientRejectCounterOfferOnSupabase RPC error:', error);
      return false;
    }
    if (!data) {
      console.warn(
        'clientRejectCounterOfferOnSupabase: RPC returned false — not pending counter or wrong state',
        id,
      );
      return false;
    }
    void (async () => {
      try {
        const { data: row } = await supabase
          .from('option_requests')
          .select('organization_id, client_organization_id')
          .eq('id', id)
          .maybeSingle();
        const r = row as {
          organization_id: string | null;
          client_organization_id: string | null;
        } | null;
        const orgIdRC = r?.client_organization_id ?? r?.organization_id ?? null;
        logAction(orgIdRC, 'clientRejectCounterOfferOnSupabase', {
          type: 'option',
          action: 'option_rejected',
          entityId: id,
          newData: { rejected_by: 'client', reason: 'counter_offer_rejected' },
        });
      } catch {
        console.warn('[clientRejectCounterOfferOnSupabase] could not resolve org for audit log');
      }
    })();
    return true;
  } catch (e) {
    console.error('clientRejectCounterOfferOnSupabase exception:', e);
    return false;
  }
}

export async function clientConfirmJobOnSupabase(id: string): Promise<boolean> {
  try {
    const { data: rpcOk, error: rpcErr } = await supabase.rpc('client_confirm_option_job', {
      p_request_id: id,
    });
    if (rpcErr) {
      console.error('clientConfirmJobOnSupabase RPC error:', rpcErr);
      return false;
    }
    if (!rpcOk) {
      console.warn(
        'clientConfirmJobOnSupabase: RPC returned false — guards failed (price/approvals/status) or concurrent call',
        id,
      );
      return false;
    }

    const { data: updated, error } = await supabase
      .from('option_requests')
      .select(OPTION_REQUEST_SELECT)
      .eq('id', id)
      .maybeSingle();

    if (error) {
      console.error('clientConfirmJobOnSupabase fetch after RPC error:', error);
      return false;
    }

    if (!updated) {
      console.warn('clientConfirmJobOnSupabase: row missing after RPC', id);
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
      newData: {
        phase: 'job_confirmed',
        final_status: 'job_confirmed',
        agency_id: up.agency_id,
        model_id: up.model_id,
      },
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
  /** When 'model', price-related system messages are excluded server-side. */
  viewerRole?: 'client' | 'agency' | 'model';
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

    if (opts?.viewerRole === 'model') {
      q = q.eq('visible_to_model', true);
    }

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
    if (error) {
      console.error('getOptionMessages error:', error);
      return [];
    }
    return ((data ?? []) as SupabaseOptionMessage[]).reverse();
  } catch (e) {
    console.error('getOptionMessages exception:', e);
    return [];
  }
}

export async function addOptionMessage(
  requestId: string,
  fromRole: 'client' | 'agency' | 'model',
  text: string,
): Promise<SupabaseOptionMessage | null> {
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    // Normalize, validate, and sanitize text — same pipeline as messengerSupabase.sendMessage
    const normalized = normalizeInput(text);
    const textCheck = validateText(normalized, {
      maxLength: MESSAGE_MAX_LENGTH,
      allowEmpty: false,
    });
    if (!textCheck.ok) {
      console.warn('addOptionMessage: text validation failed', textCheck.error);
      void logSecurityEvent({
        type: 'large_payload',
        userId: user?.id ?? null,
        metadata: { service: 'optionRequestsSupabase', field: 'text' },
      });
      return null;
    }
    // Reject messages containing unsafe URLs (mirrors messengerSupabase.sendMessage)
    const allUrls = normalized.match(/https?:\/\/[^\s]+/gi) ?? [];
    const safeUrls = extractSafeUrls(normalized);
    if (allUrls.length > safeUrls.length) {
      console.warn('addOptionMessage: message contains unsafe URLs');
      void logSecurityEvent({
        type: 'invalid_url',
        userId: user?.id ?? null,
        metadata: { service: 'optionRequestsSupabase' },
      });
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
    // model sends → notify agency org
    void (async () => {
      const { data: req } = await supabase
        .from('option_requests')
        .select('client_id, agency_id, organization_id, agency_organization_id')
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
      } else if ((fromRole === 'client' || fromRole === 'model') && req.agency_id) {
        // Resolve the agency organisation — req.organization_id is the CLIENT org, not the agency.
        const agencyOrgId = await resolveAgencyOrgIdForOptionNotification(
          req.agency_id as string,
          req.agency_organization_id,
        );
        if (!agencyOrgId) {
          console.error(
            '[notifications] addOptionMessage: agency org not found for agency_id',
            req.agency_id,
            '— notification skipped.',
          );
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

/**
 * Workflow-only thread lines (`from_role = system`). Server maps `kind` to canonical English text;
 * clients cannot insert `system` directly (trigger + RPC session flag).
 */
export async function addOptionSystemMessage(
  requestId: string,
  kind: SystemOptionMessageKind,
  opts?: { price?: number; currency?: string },
): Promise<SupabaseOptionMessage | null> {
  try {
    if (kind === 'agency_counter_offer' && (opts?.price === undefined || !opts?.currency?.trim())) {
      console.error('addOptionSystemMessage: agency_counter_offer requires price and currency');
      return null;
    }

    const { data: newId, error: rpcErr } = await supabase.rpc(
      'insert_option_request_system_message',
      {
        p_option_request_id: requestId,
        p_kind: kind,
        p_price: kind === 'agency_counter_offer' ? (opts?.price ?? null) : null,
        p_currency: kind === 'agency_counter_offer' ? (opts?.currency?.trim() ?? null) : null,
      },
    );

    if (rpcErr) {
      console.error('addOptionSystemMessage RPC error:', rpcErr);
      return null;
    }
    const id = typeof newId === 'string' ? newId : null;
    if (!id) {
      console.error('addOptionSystemMessage: RPC returned no id');
      return null;
    }

    const { data: row, error: fetchErr } = await supabase
      .from('option_request_messages')
      .select('id, option_request_id, from_role, text, booker_id, booker_name, created_at')
      .eq('id', id)
      .maybeSingle();

    if (fetchErr || !row) {
      console.error('addOptionSystemMessage: fetch row error:', fetchErr);
      return null;
    }

    const msg = row as SupabaseOptionMessage;

    // Mirror prior addOptionMessage notification directions: “agency” kinds → client; “client” kinds → agency org.
    void (async () => {
      const { data: req } = await supabase
        .from('option_requests')
        .select('client_id, agency_id, agency_organization_id')
        .eq('id', requestId)
        .maybeSingle();
      if (!req) return;

      const notifyClientKinds: SystemOptionMessageKind[] = [
        'agency_accepted_price',
        'agency_declined_price',
        'model_approved_booking',
      ];
      const notifyAgencyKinds: SystemOptionMessageKind[] = [
        'no_model_account_client_notice',
        'client_accepted_counter',
      ];

      if (notifyClientKinds.includes(kind) && req.client_id) {
        await createNotification({
          user_id: req.client_id as string,
          type: 'new_option_message',
          title: uiCopy.notifications.newOptionMessage.title,
          message: uiCopy.notifications.newOptionMessage.message,
          metadata: { option_request_id: requestId },
        });
      } else if (notifyAgencyKinds.includes(kind) && req.agency_id) {
        const agencyOrgId = await resolveAgencyOrgIdForOptionNotification(
          req.agency_id as string,
          req.agency_organization_id,
        );
        if (!agencyOrgId) {
          console.error(
            '[notifications] addOptionSystemMessage: agency org not found for agency_id',
            req.agency_id,
          );
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

    return msg;
  } catch (e) {
    console.error('addOptionSystemMessage exception:', e);
    return null;
  }
}

// NOTE: Removed `updateModelApproval` (2026-04-19) — dead code. Model approval/rejection
// now flows exclusively through `modelConfirmOptionRequest` / `modelRejectOptionRequest`,
// which respect the canonical guards (final_status='option_confirmed' gate, system messages,
// inflight guard, post-RPC refresh). Reviving any direct UPDATE on `model_approval` would
// bypass invariant E.0 (no-rollback) and invariant K (axis separation).

export async function getOptionRequestsForModel(
  modelId: string,
  limit = 200,
): Promise<SupabaseOptionRequestModelSafe[]> {
  try {
    const { data, error } = await supabase
      .from('option_requests')
      .select(OPTION_REQUEST_SELECT_MODEL_SAFE)
      .eq('model_id', modelId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) {
      console.error('getOptionRequestsForModel error:', error);
      return [];
    }
    return (data ?? []) as SupabaseOptionRequestModelSafe[];
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
    if (error) {
      console.error('getOptionDocuments error:', error);
      return [];
    }
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
export async function resolveOptionDocumentUrl(
  doc: SupabaseOptionDocument,
): Promise<string | null> {
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
  fileName: string,
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
      console.warn(
        'uploadOptionDocument: image rights confirmation missing — call confirmImageRights first',
        sessionKey,
      );
      return null;
    }

    const { file: prepared, conversionFailed } = await convertHeicToJpegWithStatus(file);
    if (conversionFailed) {
      console.warn('uploadOptionDocument: HEIC/HEIF conversion failed');
      void logSecurityEvent({
        type: 'file_rejected',
        metadata: {
          service: 'optionRequestsSupabase',
          fn: 'uploadOptionDocument',
          reason: 'heic_conversion_failed',
        },
      });
      return null;
    }
    file = prepared;

    const fileValidation = validateFile(file, CHAT_ALLOWED_MIME_TYPES);
    if (!fileValidation.ok) {
      console.error('uploadOptionDocument: file validation failed', fileValidation.error);
      void logSecurityEvent({
        type: 'file_rejected',
        metadata: { service: 'optionRequestsSupabase', fn: 'uploadOptionDocument', reason: 'mime' },
      });
      return null;
    }

    const magicCheck = await checkMagicBytes(file);
    if (!magicCheck.ok) {
      console.error('uploadOptionDocument: magic bytes check failed', magicCheck.error);
      void logSecurityEvent({
        type: 'magic_bytes_fail',
        metadata: { service: 'optionRequestsSupabase', fn: 'uploadOptionDocument' },
      });
      return null;
    }

    const extCheck = checkExtensionConsistency(file);
    if (!extCheck.ok) {
      console.error('uploadOptionDocument: extension consistency check failed', extCheck.error);
      void logSecurityEvent({
        type: 'extension_mismatch',
        metadata: { service: 'optionRequestsSupabase', fn: 'uploadOptionDocument' },
      });
      return null;
    }

    if ((file.type ?? '').startsWith('image/')) {
      file = await stripExifAndCompress(file);
    }
    const safeBaseName =
      file instanceof File ? sanitizeUploadBaseName(file.name) : sanitizeUploadBaseName(fileName);

    const claimedSize = file instanceof File ? file.size : (file as Blob).size;

    // Agency storage limit check — non-agency users pass through automatically.
    const storageCheck = await checkAndIncrementStorage(claimedSize);
    if (!storageCheck.allowed) {
      console.warn('uploadOptionDocument: storage limit reached', storageCheck);
      return null;
    }

    const path = `options/${requestId}/${Date.now()}_${safeBaseName}`;
    const { error: uploadError } = await supabase.storage.from('chat-files').upload(path, file, {
      contentType: file.type || 'application/octet-stream',
      upsert: false,
    });
    if (uploadError) {
      console.error('uploadOptionDocument storage error:', uploadError);
      await decrementStorage(claimedSize);
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
        file_name: safeBaseName,
        file_url: path,
        file_type: safeBaseName.split('.').pop() || null,
      })
      .select()
      .single();
    if (error) {
      console.error('uploadOptionDocument error:', error);
      return null;
    }
    const doc = data as SupabaseOptionDocument;
    const { data: reqRow, error: reqError } = await supabase
      .from('option_requests')
      .select('client_organization_id, organization_id, agency_organization_id')
      .eq('id', requestId)
      .maybeSingle();
    if (reqError) {
      console.error('uploadOptionDocument: failed to load option_request org context', reqError);
    }

    const reqOrg = reqRow as {
      client_organization_id?: string | null;
      organization_id?: string | null;
      agency_organization_id?: string | null;
    } | null;
    const auditOrgId =
      reqOrg?.client_organization_id ??
      reqOrg?.organization_id ??
      reqOrg?.agency_organization_id ??
      null;

    if (auditOrgId) {
      logAction(
        auditOrgId,
        'uploadOptionDocument',
        {
          type: 'option',
          action: 'option_document_uploaded',
          entityId: requestId,
          newData: {
            document_id: doc.id,
            file_name: safeBaseName,
            file_url: path,
            uploaded_by: uploadedBy,
          },
        },
        { source: 'api' },
      );
    } else {
      console.warn(
        '[uploadOptionDocument] org context unavailable — audit log skipped for',
        requestId,
      );
    }
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
 *
 * Also use it for `log_audit_action` (see `logAction` in src/utils/logAction.ts) when the **actor is the agency**
 * (booker/owner): `log_audit_action` enforces `organization_members` for `p_org_id`.
 *
 * For option-request flows, prefer {@link resolveAgencyOrgIdForOptionNotification}:
 * client sessions often cannot SELECT the agency row in `organizations` (RLS),
 * but `option_requests.agency_organization_id` is already set and readable.
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

/** Non-empty trimmed UUID from option_requests.agency_organization_id, or null. */
function agencyOrgIdFromOptionRequestRow(
  agencyOrganizationId: string | null | undefined,
): string | null {
  const s = agencyOrganizationId != null ? String(agencyOrganizationId).trim() : '';
  return s !== '' ? s : null;
}

/**
 * Agency-side org UUID for notifications: use column from option_requests first
 * (RLS-safe for clients), then fallback to organizations lookup.
 */
export async function resolveAgencyOrgIdForOptionNotification(
  agencyId: string,
  agencyOrganizationId: string | null | undefined,
): Promise<string | null> {
  const fromRow = agencyOrgIdFromOptionRequestRow(agencyOrganizationId);
  if (fromRow) return fromRow;
  return fetchAgencyOrgId(agencyId);
}

/**
 * Erstellt bzw. aktualisiert ein booking_event für den option_request-Lebenszyklus.
 * Idempotent: bestehende Zeile (Trigger oder früherer Insert) wird per UPDATE auf den
 * Ziel-`type` (option/job/casting) angehoben; 23505 auf model_id+date wird per
 * Lookup+UPDATE aufgelöst, nicht ignoriert.
 */
async function createBookingEventFromRequest(req: SupabaseOptionRequest): Promise<void> {
  try {
    const eventType: BookingEventType =
      req.request_type === 'casting'
        ? 'casting'
        : req.final_status === 'job_confirmed'
          ? 'job'
          : 'option';

    const agencyOrgIdResolved = await resolveAgencyOrgIdForOptionNotification(
      req.agency_id,
      req.agency_organization_id,
    );

    const title = req.client_name ? `${req.client_name} – ${eventType}` : null;
    const rowPayload = {
      model_id: req.model_id,
      client_org_id: req.organization_id ?? null,
      agency_org_id: agencyOrgIdResolved,
      date: req.requested_date,
      type: eventType,
      title,
      source_option_request_id: req.id,
    };

    const { data: bySource } = await supabase
      .from('booking_events')
      .select('id, type')
      .eq('source_option_request_id', req.id)
      .neq('status', 'cancelled')
      .maybeSingle();

    if (bySource?.id) {
      const curType = (bySource as { type?: string }).type;
      if (curType !== eventType || req.final_status === 'job_confirmed') {
        const { error: upErr } = await supabase
          .from('booking_events')
          .update({
            type: eventType,
            title,
            date: req.requested_date,
            agency_org_id: agencyOrgIdResolved,
            client_org_id: req.organization_id ?? null,
          })
          .eq('id', (bySource as { id: string }).id);
        if (upErr) {
          console.error('createBookingEventFromRequest update by source error:', upErr);
        }
      }
      return;
    }

    const { data: user } = await supabase.auth.getUser();
    const { error } = await supabase.from('booking_events').insert({
      ...rowPayload,
      status: 'pending' as const,
      note: null,
      created_by: user.user?.id ?? null,
    });

    if (!error) {
      const bookingOrgId = agencyOrgIdResolved ?? req.organization_id;
      logAction(bookingOrgId, 'createBookingEventFromRequest', {
        type: 'booking',
        action: 'booking_created',
        entityId: req.id,
        newData: { type: eventType, source_option_request_id: req.id },
      });
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const code = (error as any).code as string | undefined;
    if (code !== '23505') {
      console.error('createBookingEventFromRequest insert error:', error);
      return;
    }

    const { data: clash } = await supabase
      .from('booking_events')
      .select('id, source_option_request_id')
      .eq('model_id', req.model_id)
      .eq('date', req.requested_date)
      .neq('status', 'cancelled')
      .maybeSingle();

    const clashRow = clash as { id: string; source_option_request_id: string | null } | null;
    if (
      clashRow?.id &&
      (clashRow.source_option_request_id === req.id || clashRow.source_option_request_id == null)
    ) {
      const { error: up2 } = await supabase
        .from('booking_events')
        .update({
          type: eventType,
          title,
          agency_org_id: agencyOrgIdResolved,
          client_org_id: req.organization_id ?? null,
          source_option_request_id: req.id,
        })
        .eq('id', clashRow.id);
      if (up2) {
        console.error('createBookingEventFromRequest reconcile-after-23505 error:', up2);
      } else {
        console.info('createBookingEventFromRequest: reconciled existing row after 23505', req.id);
      }
      return;
    }

    console.info('createBookingEventFromRequest: 23505 but no reconcilable row', req.id);
  } catch (e) {
    console.error('createBookingEventFromRequest exception:', e);
  }
}

/**
 * Agency confirms AVAILABILITY for the option/casting request.
 *
 * DECOUPLED from price: this function only handles availability/confirmation.
 * Price acceptance is handled independently by agencyAcceptClientPrice / price RPCs.
 *
 * - model_account_linked = false → auto-approval (model_approval = 'approved').
 * - model_account_linked = true + already pre-approved → confirmed.
 * - model_account_linked = true + pending → waits for model confirmation.
 *
 * Status stays 'in_negotiation' until client confirms job (via client_confirm_option_job).
 *
 * Audit: `log_audit_action` requires `organization_members` for `p_org_id`. The agency actor is a
 * member of the **agency** org (`agency_organization_id`), not `organization_id` (client org).
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
    const auditOrgIdAgency = await resolveAgencyOrgIdForOptionNotification(
      r.agency_id ?? '',
      r.agency_organization_id,
    );
    const modelAccountLinked = r.model_account_linked ?? false;

    if (!modelAccountLinked) {
      const { data: updateData, error } = await supabase
        .from('option_requests')
        .update({
          final_status: 'option_confirmed',
          model_approval: 'approved',
          model_approved_at: new Date().toISOString(),
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
        console.warn(
          'agencyAcceptRequest: no row updated — already accepted or concurrent call',
          id,
        );
        return null;
      }

      if (auditOrgIdAgency) {
        logAction(auditOrgIdAgency, 'agencyAcceptRequest:no-account', {
          type: 'option',
          action: 'option_confirmed',
          entityId: id,
          newData: { result: 'confirmed', model_account_linked: false, agency_id: r.agency_id },
        });
      } else {
        console.warn('[agencyAcceptRequest] could not resolve agency org — audit log skipped', id);
      }
      return 'confirmed';
    }

    if (r.model_approval === 'approved') {
      const { data: updateData, error } = await supabase
        .from('option_requests')
        .update({
          final_status: 'option_confirmed',
          model_approved_at: r.model_approved_at ?? new Date().toISOString(),
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
        console.warn(
          'agencyAcceptRequest: no row updated — already processed or concurrent call',
          id,
        );
        return null;
      }

      if (auditOrgIdAgency) {
        logAction(auditOrgIdAgency, 'agencyAcceptRequest:pre-approved', {
          type: 'option',
          action: 'option_confirmed',
          entityId: id,
          newData: { result: 'confirmed', model_approval: 'pre-approved', agency_id: r.agency_id },
        });
      } else {
        console.warn('[agencyAcceptRequest] could not resolve agency org — audit log skipped', id);
      }
      return 'confirmed';
    }

    // Model has account but hasn't pre-approved → wait for model confirmation.
    const { data: updateData, error } = await supabase
      .from('option_requests')
      .update({
        final_status: 'option_confirmed',
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
      console.warn(
        'agencyAcceptRequest: no row updated — already processed or concurrent call',
        id,
      );
      return null;
    }

    if (auditOrgIdAgency) {
      logAction(auditOrgIdAgency, 'agencyAcceptRequest:awaiting-model', {
        type: 'option',
        action: 'option_confirmed',
        entityId: id,
        newData: {
          result: 'awaiting_model_confirmation',
          model_account_linked: true,
          agency_id: r.agency_id,
        },
      });
    } else {
      console.warn('[agencyAcceptRequest] could not resolve agency org — audit log skipped', id);
    }

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
 *
 * @deprecated Use `deleteOptionRequestFull` via `agencyRejectNegotiationStore` for
 * the canonical agency "remove request" product path. This UPDATE-only function
 * remains for existing tests and legacy callers.
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
      .select('id, client_id, organization_id, agency_id, agency_organization_id')
      .maybeSingle();

    if (error) {
      console.error('agencyRejectRequest error:', error);
      return false;
    }
    if (!data?.id) {
      console.warn(
        'agencyRejectRequest: no row updated — request not in_negotiation or already rejected',
        id,
      );
      return false;
    }

    // Notify the client about the rejection (fire-and-forget).
    const row = data as {
      id: string;
      client_id: string | null;
      organization_id: string | null;
      agency_id: string | null;
      agency_organization_id: string | null;
    };
    const auditOrgReject = await resolveAgencyOrgIdForOptionNotification(
      row.agency_id ?? '',
      row.agency_organization_id,
    );
    if (auditOrgReject) {
      logAction(auditOrgReject, 'agencyRejectRequest', {
        type: 'option',
        action: 'option_rejected',
        entityId: id,
        newData: { rejected_by: 'agency' },
      });
    } else {
      console.warn('[agencyRejectRequest] could not resolve agency org — audit log skipped', id);
    }
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
      .select(OPTION_REQUEST_SELECT_MODEL_SAFE)
      .eq('id', id)
      .maybeSingle();

    if (fetchErr || !req) {
      console.error('modelConfirmOptionRequest fetch error:', fetchErr);
      return false;
    }

    const r = req as SupabaseOptionRequestModelSafe;

    if (r.model_approval !== 'pending' || !r.model_account_linked) {
      console.warn('modelConfirmOptionRequest: invalid state', {
        model_approval: r.model_approval,
        model_account_linked: r.model_account_linked,
      });
      return false;
    }

    // Agency must have confirmed availability first (final_status transitions to
    // option_confirmed when agency calls agencyAcceptRequest — Axis 2 only).
    if (r.final_status !== 'option_confirmed') {
      console.warn('modelConfirmOptionRequest: agency has not accepted yet', {
        final_status: r.final_status,
      });
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
    // Do NOT send final_status here. The DB trigger tr_reset_final_status_on_rejection
    // (20260555) resets final_status from option_confirmed → option_pending automatically
    // when status → rejected. Sending final_status: 'option_pending' explicitly would
    // violate fn_validate_option_status_transition which blocks option_confirmed → option_pending.
    // Trigger firing order (alphabetical BEFORE UPDATE): fn_reset… < fn_validate… — safe.
    const { data: rejectData, error } = await supabase
      .from('option_requests')
      .update({
        model_approval: 'rejected',
        status: 'rejected',
      })
      .eq('id', id)
      .eq('model_approval', 'pending')
      .eq('final_status', 'option_confirmed')
      .eq('status', 'in_negotiation')
      .select('id, agency_id, client_id, organization_id, agency_organization_id')
      .maybeSingle();

    if (error) {
      console.error('modelRejectOptionRequest error:', error);
      return false;
    }
    if (!rejectData?.id) {
      console.warn('modelRejectOptionRequest: no row updated — concurrent state change', { id });
      return false;
    }

    const rejectRow = rejectData as {
      id: string;
      agency_id: string | null;
      client_id: string | null;
      organization_id: string | null;
      agency_organization_id: string | null;
    };
    logAction(rejectRow.organization_id, 'modelRejectOptionRequest', {
      type: 'option',
      action: 'option_rejected',
      entityId: id,
      newData: { rejected_by: 'model' },
    });

    // Notify agency and client about the model rejection (fire-and-forget).
    void (async () => {
      try {
        const row = rejectData as {
          id: string;
          agency_id: string | null;
          client_id: string | null;
          organization_id: string | null;
          agency_organization_id: string | null;
        };
        const notifications: Parameters<typeof createNotifications>[0] = [];

        if (row.agency_id) {
          const agencyOrgId = await resolveAgencyOrgIdForOptionNotification(
            row.agency_id,
            row.agency_organization_id,
          );
          if (!agencyOrgId) {
            console.error(
              '[notifications] modelRejectOptionRequest: agency org not found for agency_id',
              row.agency_id,
              '— agency notification skipped.',
            );
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
): Promise<SupabaseOptionRequestModelSafe[]> {
  try {
    const { data, error } = await supabase
      .from('option_requests')
      .select(OPTION_REQUEST_SELECT_MODEL_SAFE)
      .eq('model_id', modelId)
      .eq('model_approval', 'pending')
      .eq('model_account_linked', true)
      .eq('final_status', 'option_confirmed')
      .eq('status', 'in_negotiation')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('getPendingModelConfirmations error:', error);
      return [];
    }
    return (data ?? []) as SupabaseOptionRequestModelSafe[];
  } catch (e) {
    console.error('getPendingModelConfirmations exception:', e);
    return [];
  }
}

/** Who performed the delete — used to pick the correct org for audit_trail (log_audit_action membership). */
export type DeleteOptionRequestAuditActor = 'agency' | 'client';

export type DeleteOptionRequestFullOpts = {
  /**
   * Caller's organization UUID for audit_trail. Prefer when known (e.g. active team from profile).
   * option_requests.organization_id is the CLIENT org — do not use it for agency-initiated deletes.
   */
  auditOrganizationId?: string | null;
  /** Required: agency vs client determines fallback from the row when auditOrganizationId is omitted. */
  auditActor: DeleteOptionRequestAuditActor;
};

/**
 * Resolves org_id for log_audit_action after a successful delete.
 * Agency: explicit profile org or resolver from row. Client: row client org first (matches RLS participant), then explicit fallback.
 */
async function resolveAuditOrganizationIdForOptionDelete(
  row: SupabaseOptionRequest,
  opts: DeleteOptionRequestFullOpts,
): Promise<string | null> {
  const explicit = opts.auditOrganizationId != null ? String(opts.auditOrganizationId).trim() : '';

  if (opts.auditActor === 'client') {
    const fromRow = [row.client_organization_id, row.organization_id]
      .map((x) => (x != null ? String(x).trim() : ''))
      .find((s) => s !== '');
    if (fromRow) return fromRow;
    if (explicit) return explicit;
    return null;
  }

  if (explicit) return explicit;

  if (opts.auditActor === 'agency') {
    return resolveAgencyOrgIdForOptionNotification(row.agency_id, row.agency_organization_id);
  }

  const clientOrg = row.client_organization_id ?? row.organization_id;
  const c = clientOrg != null ? String(clientOrg).trim() : '';
  return c !== '' ? c : null;
}

/**
 * Atomically deletes an option_request and dependent rows (messages, calendar, booking_events, etc.).
 * Server enforces participant access and blocks when final_status = job_confirmed.
 */
export async function deleteOptionRequestFull(
  id: string,
  opts: DeleteOptionRequestFullOpts,
): Promise<boolean> {
  try {
    const row = await getOptionRequestById(id);
    if (!row) {
      console.error('[deleteOptionRequestFull] option request not found', id);
      return false;
    }
    if (row.final_status === 'job_confirmed') {
      console.warn('[deleteOptionRequestFull] blocked: job_confirmed', id);
      return false;
    }

    // Pre-collect storage paths before the RPC deletes DB rows.
    const storagePaths = await collectOptionDocStoragePaths(id);

    const { error } = await supabase.rpc('delete_option_request_full', {
      p_option_request_id: id,
    });
    if (error) {
      console.error('deleteOptionRequestFull RPC error:', error);
      return false;
    }
    const auditOrgId = await resolveAuditOrganizationIdForOptionDelete(row, opts);
    if (auditOrgId) {
      logAction(auditOrgId, 'deleteOptionRequestFull', {
        type: 'audit',
        action: 'option_request_deleted',
        entityType: 'option_request',
        entityId: id,
      });
    } else {
      console.warn('[deleteOptionRequestFull] could not resolve audit org — audit log skipped', {
        id,
        auditActor: opts.auditActor,
      });
    }

    if (storagePaths.length > 0) {
      void cleanupOptionDocStorage(storagePaths);
    }

    return true;
  } catch (e) {
    console.error('deleteOptionRequestFull exception:', e);
    return false;
  }
}

async function collectOptionDocStoragePaths(requestId: string): Promise<string[]> {
  try {
    const { data, error } = await supabase
      .from('option_documents')
      .select('file_url')
      .eq('option_request_id', requestId);
    if (error || !data) return [];
    return data
      .map((d) => (d as { file_url?: string }).file_url)
      .filter((p): p is string => !!p && !p.startsWith('http'));
  } catch {
    return [];
  }
}

async function cleanupOptionDocStorage(paths: string[]): Promise<void> {
  const BATCH = 100;
  for (let i = 0; i < paths.length; i += BATCH) {
    try {
      const batch = paths.slice(i, i + BATCH);
      const { error } = await supabase.storage.from('chat-files').remove(batch);
      if (error) {
        console.error('[deleteOptionRequestFull] storage cleanup error:', error);
      }
    } catch (e) {
      console.error('[deleteOptionRequestFull] storage cleanup exception:', e);
    }
  }
}

export async function sendAgencyInvitation(
  agencyName: string,
  email: string,
  invitedBy?: string,
): Promise<string | null> {
  // Legacy flow (agency_invitations): kept for backward compatibility.
  // Canonical invite invariant for team/member onboarding is implemented via:
  // invitations + send-invite edge + finalizePendingInviteOrClaim.
  // Any changes here must be cross-checked against Booker/Employee/Model-claim flows.
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
    if (error) {
      console.error('sendAgencyInvitation error:', error);
      return null;
    }
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

/**
 * Subscribe to row-level updates on a single option_request.
 * Fires on UPDATE events (status, final_status, client_price_status, etc.).
 * Uses the shared channel pool. Returns a cleanup function.
 */
export function subscribeToOptionRequestChanges(
  requestId: string,
  onUpdate: (updated: SupabaseOptionRequest) => void,
): () => void {
  return pooledSubscribe(
    `option-row-${requestId}`,
    (channel, dispatch) =>
      channel
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'option_requests',
            filter: `id=eq.${requestId}`,
          },
          dispatch,
        )
        .subscribe(),
    (payload) => onUpdate((payload as { new: SupabaseOptionRequest }).new),
  );
}

// ── Notification helpers ──────────────────────────────────────────────────────

/** Notify a model's linked user that they need to confirm an option request. */
async function notifyModelAwaitingConfirmation(
  modelId: string,
  optionRequestId: string,
): Promise<void> {
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
async function notifyModelConfirmedOption(
  req: SupabaseOptionRequest | SupabaseOptionRequestModelSafe,
): Promise<void> {
  try {
    const notifications = [];

    // IMPORTANT: req.organization_id is the CLIENT org, not the agency org.
    // Prefer req.agency_organization_id (RLS-safe for clients) over organizations lookup.
    const agencyOrgId = await resolveAgencyOrgIdForOptionNotification(
      req.agency_id,
      req.agency_organization_id,
    );

    if (!agencyOrgId) {
      console.error(
        '[notifications] notifyModelConfirmedOption: agency org not found for agency_id',
        req.agency_id,
        '— agency notification skipped.',
      );
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

// ---------------------------------------------------------------------------
// Agency-Only Manual Event Flows
// ---------------------------------------------------------------------------

/**
 * Create an agency-only option/casting request via the RPC.
 * Returns the new option_request id or null on failure.
 */
export async function insertAgencyOptionRequest(params: {
  modelId: string;
  agencyId: string;
  requestedDate: string;
  requestType?: 'option' | 'casting';
  title?: string;
  jobDescription?: string;
  startTime?: string;
  endTime?: string;
  agencyEventGroupId?: string;
  agencyOrganizationId?: string;
}): Promise<string | null> {
  try {
    const { data, error } = await supabase.rpc('agency_create_option_request', {
      p_model_id: params.modelId,
      p_agency_id: params.agencyId,
      p_requested_date: params.requestedDate,
      p_request_type: params.requestType ?? 'option',
      p_title: params.title ?? null,
      p_job_description: params.jobDescription ?? null,
      p_start_time: params.startTime ?? null,
      p_end_time: params.endTime ?? null,
      p_agency_event_group_id: params.agencyEventGroupId ?? null,
      p_agency_organization_id: params.agencyOrganizationId ?? null,
    });
    if (error) {
      console.error('[insertAgencyOptionRequest] RPC error:', error);
      return null;
    }
    return data as string;
  } catch (e) {
    console.error('[insertAgencyOptionRequest] exception:', e);
    return null;
  }
}

/**
 * Agency confirms job for an agency-only request (canonical invariant:
 * only allowed when is_agency_only=true AND model_approval='approved').
 */
export async function agencyConfirmJobAgencyOnly(requestId: string): Promise<boolean> {
  try {
    const { error } = await supabase.rpc('agency_confirm_job_agency_only', {
      p_request_id: requestId,
    });
    if (error) {
      console.error('[agencyConfirmJobAgencyOnly] RPC error:', error);
      return false;
    }
    return true;
  } catch (e) {
    console.error('[agencyConfirmJobAgencyOnly] exception:', e);
    return false;
  }
}
