/**
 * Option Requests + Chat (Client ↔ Agency).
 * Alle Anfragen und Chats in Supabase gespeichert (option_requests + option_request_messages).
 * Pro Partei laden: loadOptionRequestsForClient(clientOrgId?), loadOptionRequestsForAgency(agencyId),
 * loadOptionsForModel(modelId). Cache wird mit den jeweiligen Daten gefüllt.
 */

import {
  getOptionRequestById,
  insertOptionRequest,
  resolveAgencyOrganizationIdForOptionRequest,
  updateModelApproval,
  getOptionMessages as fetchMessages,
  addOptionMessage,
  addOptionSystemMessage,
  getOptionRequestsForModel,
  getOptionRequestsForCurrentClient as fetchRequestsForCurrentClient,
  getOptionRequestsForAgency as fetchRequestsForAgency,
  setAgencyCounterOffer,
  agencyAcceptClientPrice,
  agencyRejectClientPrice as agencyRejectClientPriceDb,
  agencyAcceptRequest,
  clientAcceptCounterPrice,
  clientRejectCounterOfferOnSupabase,
  clientConfirmJobOnSupabase,
  deleteOptionRequestFull,
  resolveAgencyOrgIdForOptionNotification,
  type SupabaseOptionRequest,
  type SupabaseOptionRequestModelSafe,
  type SupabaseOptionMessage,
} from '../services/optionRequestsSupabase';
import { createNotification, createNotifications } from '../services/notificationsSupabase';
import { supabase } from '../../lib/supabase';
import { getModelByIdFromSupabase } from '../services/modelsSupabase';
import { getAgencyById } from '../services/agenciesSupabase';
import { resolveAgencyForModelAndCountry } from '../services/territoriesSupabase';
import { createBookingMessageInClientAgencyChat } from '../services/bookingChatIntegrationSupabase';
import { updateCalendarEntryToJob, checkCalendarConflict } from '../services/calendarSupabase';
import { notifyClientAgencyCounterOffer } from '../services/pushNotifications';
import { showAppAlert } from '../utils/crossPlatformAlert';
import { uiCopy } from '../constants/uiCopy';
import { optionRequestNeedsMessagesTabAttention } from '../utils/optionRequestAttention';

export type OptionRequestFlowSource =
  | 'discover'
  | 'portfolio_package'
  | 'polaroid_package'
  | 'project'
  | 'swipe'
  | 'other';

export type ChatStatus = 'in_negotiation' | 'confirmed' | 'rejected';

export type OptionRequest = {
  id: string;
  clientName: string;
  clientOrganizationId?: string;
  modelName: string;
  modelId: string;
  date: string;
  createdAt: number;
  threadId: string;
  status: ChatStatus;
  projectId?: string;
  proposedPrice?: number;
  agencyCounterPrice?: number;
  clientPriceStatus?: 'pending' | 'accepted' | 'rejected';
  finalStatus?: 'option_pending' | 'option_confirmed' | 'job_confirmed';
  requestType?: 'option' | 'casting';
  currency?: string;
  startTime?: string;
  endTime?: string;
  modelApproval: 'pending' | 'approved' | 'rejected';
  modelApprovedAt?: string;
  /** false when model has no app user — client & agency do not wait for in-app model approval */
  modelAccountLinked?: boolean;
  agencyId?: string;
  agencyOrganizationId?: string;
};

export type ChatMessage = {
  id: string;
  threadId: string;
  from: 'client' | 'agency' | 'model' | 'system';
  text: string;
  createdAt: number;
};

function toLocalRequest(r: SupabaseOptionRequest | SupabaseOptionRequestModelSafe): OptionRequest {
  return {
    id: r.id,
    clientName: r.client_name ?? 'Client',
    clientOrganizationId: r.client_organization_id ?? r.organization_id ?? undefined,
    modelName: r.model_name ?? 'Model',
    modelId: r.model_id,
    date: r.requested_date,
    createdAt: new Date(r.created_at).getTime(),
    threadId: r.id,
    status: r.status,
    projectId: r.project_id ?? undefined,
    proposedPrice: 'proposed_price' in r ? (r.proposed_price ?? undefined) : undefined,
    agencyCounterPrice: 'agency_counter_price' in r ? (r.agency_counter_price ?? undefined) : undefined,
    clientPriceStatus: 'client_price_status' in r ? (r.client_price_status ?? undefined) : undefined,
    finalStatus: r.final_status ?? undefined,
    requestType: r.request_type ?? 'option',
    currency: r.currency ?? undefined,
    startTime: r.start_time ?? undefined,
    endTime: r.end_time ?? undefined,
    modelApproval: r.model_approval ?? 'pending',
    modelApprovedAt: r.model_approved_at ?? undefined,
    modelAccountLinked: r.model_account_linked ?? undefined,
    agencyId: r.agency_id,
    agencyOrganizationId: r.agency_organization_id ?? undefined,
  };
}

function toLocalMessage(m: SupabaseOptionMessage): ChatMessage {
  const role = m.from_role;
  const from: ChatMessage['from'] =
    role === 'system'
      ? 'system'
      : role === 'model'
        ? 'model'
        : role === 'agency'
          ? 'agency'
          : 'client';
  return {
    id: m.id,
    threadId: m.option_request_id,
    from,
    text: m.text,
    createdAt: new Date(m.created_at).getTime(),
  };
}

let requestsCache: OptionRequest[] = [];
let messagesCache: ChatMessage[] = [];
let hydrated = false;
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((fn) => fn());
}

async function ensureHydrated() {
  if (hydrated) return;
  hydrated = true;
  /* Kein globales fetchRequests() – jede Partei lädt ihre Daten selbst:
   * loadOptionRequestsForClient / loadOptionRequestsForAgency(agencyId, agencyOrgId?) / loadOptionsForModel
   * (alle in Supabase pro client_id / agency_id / model_id gespeichert). */
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  ensureHydrated();
  return () => listeners.delete(fn);
}

export function getOptionRequests(): OptionRequest[] {
  return [...requestsCache];
}

export function addOptionRequest(
  clientName: string,
  modelName: string,
  modelId: string,
  date: string,
  projectId?: string,
  extra?: {
    proposedPrice?: number;
    startTime?: string;
    endTime?: string;
    requestType?: 'option' | 'casting';
    currency?: string;
    countryCode?: string;
    /** Set when the request is triggered from a shared package. */
    source?: 'package';
    /** ID of the guest_links row if source is 'package'. */
    packageId?: string;
    /** Called after the option_request row exists (real UUID thread id for Messages UI). */
    onThreadReady?: (dbThreadId: string) => void;
    /** Telemetry / debugging: which client surface initiated the request. */
    flowSource?: OptionRequestFlowSource;
  }
): string {
  const threadId = `thread-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const requestType = extra?.requestType ?? 'option';
  const timeStr = extra?.startTime && extra?.endTime ? ` (${extra.startTime}–${extra.endTime})` : '';
  const _label = requestType === 'casting' ? 'Casting' : 'Option';
  const req: OptionRequest = {
    id: `req-${Date.now()}`,
    clientName,
    modelName,
    modelId,
    date,
    createdAt: Date.now(),
    threadId,
    status: 'in_negotiation',
    projectId,
    proposedPrice: extra?.proposedPrice,
    requestType,
    currency: extra?.currency,
    startTime: extra?.startTime,
    endTime: extra?.endTime,
    modelApproval: 'pending',
    modelAccountLinked: false,
    finalStatus: 'option_pending',
    clientPriceStatus: 'pending',
  };
  requestsCache.unshift(req);
  const autoText = requestType === 'casting'
    ? `Casting request for ${date}${timeStr}.`
    : `Option request for ${date}${timeStr}.`;
  const autoMessage: ChatMessage = {
    id: `msg-${Date.now()}`,
    threadId,
    from: 'client',
    text: autoText,
    createdAt: Date.now(),
  };
  messagesCache.push(autoMessage);
  notify();

  (async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user?.id) {
      requestsCache = requestsCache.filter((x) => x.id !== req.id);
      messagesCache = messagesCache.filter((m) => m.id !== autoMessage.id);
      notify();
      showAppAlert(uiCopy.common.error, uiCopy.alerts.optionRequestRequiresSignIn);
      return;
    }
    const clientId = user.id;

    let organizationId: string | null = null;
    if (user?.id) {
      try {
        // Employees must resolve their employer's org; owners fall back to
        // creating their own org. getMyClientMemberRole covers both cases.
        const { getMyClientMemberRole, ensureClientOrganization } = await import('../services/organizationsInvitationsSupabase');
        const roleData = await getMyClientMemberRole();
        if (roleData?.organization_id) {
          organizationId = roleData.organization_id;
        } else {
          organizationId = await ensureClientOrganization();
        }
      } catch {
        /* ignore */
      }
    }

    let agencyId: string | null = null;
    let countryCodeUsedForBooking: string | null = null;
    try {
      const model = await getModelByIdFromSupabase(modelId);
      const fallbackAgency = model?.agency_id ?? null;

      const countryCodeUsed = extra?.countryCode?.trim()
        ? extra?.countryCode
        : model?.country_code ?? model?.country ?? null;

      if (countryCodeUsed) {
        countryCodeUsedForBooking = countryCodeUsed;
        const resolved = await resolveAgencyForModelAndCountry(modelId, countryCodeUsed);
        agencyId = resolved ?? fallbackAgency;

        if (!agencyId) {
          // Territory missing and no default agency defined.
          showAppAlert(uiCopy.common.error, uiCopy.alerts.noTerritoryForCountry);
          // Rollback optimistic local cache entries.
          requestsCache = requestsCache.filter((x) => x.id !== req.id);
          messagesCache = messagesCache.filter((m) => m.id !== autoMessage.id);
          notify();
          return;
        }
      } else {
        // Missing country input: rely on fallback agency only.
        agencyId = fallbackAgency;
        if (!agencyId) {
          showAppAlert(uiCopy.common.error, uiCopy.alerts.missingCountryCode);
          requestsCache = requestsCache.filter((x) => x.id !== req.id);
          messagesCache = messagesCache.filter((m) => m.id !== autoMessage.id);
          notify();
          return;
        }
      }
    } catch {}

    let agencyOrganizationId: string | null = null;
    try {
      if (agencyId) {
        agencyOrganizationId = await resolveAgencyOrganizationIdForOptionRequest(
          modelId,
          agencyId,
          countryCodeUsedForBooking,
        );
      }
    } catch {
      agencyOrganizationId = null;
    }

    const flowSource = extra?.flowSource ?? 'other';
    const normStart = extra?.startTime?.trim() ? extra.startTime : null;
    const normEnd = extra?.endTime?.trim() ? extra.endTime : null;

    console.info('[addOptionRequest] resolution', {
      flowSource,
      actingUserId: clientId,
      clientOrganizationId: organizationId,
      modelId,
      requestType,
      countryCode: countryCodeUsedForBooking,
      resolvedAgencyId: agencyId,
      resolvedAgencyOrganizationId: agencyOrganizationId,
    });

    // Calendar conflict check — informational only (fail-open).
    // Warns the user when the model already has a confirmed booking on the
    // requested date so they can decide whether to proceed.
    const conflictResult = await checkCalendarConflict(
      modelId,
      date,
      normStart,
      normEnd,
    );
    if (conflictResult.has_conflict) {
      const conflictTitles = conflictResult.conflicting_entries
        .map((e) => e.title ?? e.entry_type)
        .join(', ');
      showAppAlert(
        uiCopy.calendarValidation.conflictWarningTitle ?? 'Schedule Conflict',
        (uiCopy.calendarValidation.conflictWarningMessage ?? 'This model already has a booking on this date: {{entries}}. You can still submit the request.').replace('{{entries}}', conflictTitles),
      );
    }

    const result = await insertOptionRequest({
      client_id: clientId,
      model_id: modelId,
      agency_id: agencyId!,
      requested_date: date,
      project_id: projectId,
      client_name: clientName,
      model_name: modelName,
      proposed_price: extra?.proposedPrice,
      currency: extra?.currency,
      start_time: normStart ?? undefined,
      end_time: normEnd ?? undefined,
      request_type: requestType,
      organization_id: organizationId,
      client_organization_id: organizationId ?? null,
      agency_organization_id: agencyOrganizationId,
      created_by: user?.id ?? null,
    });
    if (!result) {
      // DB insert failed: roll back the optimistic stub so the UI stays consistent.
      requestsCache = requestsCache.filter((x) => x.id !== req.id);
      messagesCache = messagesCache.filter((m) => m.id !== autoMessage.id);
      notify();
      console.error('[addOptionRequest] insertOptionRequest returned null – optimistic entry rolled back', {
        flowSource,
        actingUserId: clientId,
        clientOrganizationId: organizationId,
        modelId,
        requestType,
        countryCode: countryCodeUsedForBooking,
        resolvedAgencyId: agencyId,
        resolvedAgencyOrganizationId: agencyOrganizationId,
      });
      return;
    }
    if (result) {
      const local = toLocalRequest(result);
      const r = requestsCache.find((x) => x.id === req.id);
      if (r) {
        r.id = local.id;
        r.threadId = local.threadId;
        r.modelApproval = local.modelApproval;
        r.modelApprovedAt = local.modelApprovedAt;
        r.modelAccountLinked = local.modelAccountLinked;
        r.agencyId = local.agencyId;
      }
      const m = messagesCache.find((x) => x.id === autoMessage.id);
      if (m) m.threadId = result.id;
      void addOptionMessage(result.id, 'client', autoText);

      // Booking must be visible in B2B chat as a typed message.
      const bookingCountryCode = (countryCodeUsedForBooking ?? '').trim().toUpperCase();
      if (user?.id && organizationId && bookingCountryCode) {
        void createBookingMessageInClientAgencyChat({
          agencyId: result.agency_id,
          actingUserId: user.id,
          clientOrganizationId: organizationId,
          modelId,
          countryCode: bookingCountryCode,
          date,
          optionRequestId: result.id,
          source: extra?.source,
          packageId: extra?.packageId,
        });
      }

      // Workflow hint: from_role=system via RPC only (no agency/client spoofing).
      if (local.modelAccountLinked === false) {
        const sys = await addOptionSystemMessage(result.id, 'no_model_account_client_notice');
        if (sys) {
          messagesCache.push({
            id: sys.id,
            threadId: result.id,
            from: 'system',
            text: sys.text,
            createdAt: new Date(sys.created_at).getTime(),
          });
        }
      }
      notify();
      extra?.onThreadReady?.(result.id);
    }
  })();

  return threadId;
}

export async function approveOptionAsModel(threadId: string): Promise<boolean> {
  const req = requestsCache.find((r) => r.threadId === threadId);
  if (!req) return false;
  const prevApproval = req.modelApproval;
  const prevApprovedAt = req.modelApprovedAt;
  req.modelApproval = 'approved';
  req.modelApprovedAt = new Date().toISOString();
  notify();
  const ok = await updateModelApproval(req.id, 'approved');
  if (!ok) {
    // Roll back optimistic change on failure.
    req.modelApproval = prevApproval;
    req.modelApprovedAt = prevApprovedAt;
    notify();
    console.error('[approveOptionAsModel] updateModelApproval failed – rolled back', req.id);
    return false;
  }
  const inserted = await addOptionSystemMessage(req.id, 'model_approved_booking');
  if (inserted) {
    messagesCache.push({
      id: inserted.id,
      threadId,
      from: 'system',
      text: inserted.text,
      createdAt: new Date(inserted.created_at).getTime(),
    });
  }
  notify();
  return true;
}

export async function rejectOptionAsModel(threadId: string): Promise<boolean> {
  const req = requestsCache.find((r) => r.threadId === threadId);
  if (!req) return false;
  const prevApproval = req.modelApproval;
  req.modelApproval = 'rejected';
  notify();
  const ok = await updateModelApproval(req.id, 'rejected');
  if (!ok) {
    req.modelApproval = prevApproval;
    notify();
    console.error('[rejectOptionAsModel] updateModelApproval failed – rolled back', req.id);
  }
  return ok;
}

export function getOutstandingOptionsForModel(modelId: string): OptionRequest[] {
  return requestsCache.filter(
    (r) => r.modelId === modelId && r.modelApproval === 'pending' && r.status === 'in_negotiation'
  );
}

export async function loadOptionsForModel(modelId: string): Promise<void> {
  try {
    const remote = await getOptionRequestsForModel(modelId);
    if (remote.length > 0) {
      for (const r of remote) {
        if (!requestsCache.find((x) => x.id === r.id)) {
          requestsCache.push(toLocalRequest(r));
        }
      }
      notify();
    }
  } catch { /* keep cache */ }
}

export async function loadOptionRequestsForClient(clientOrganizationId?: string | null): Promise<void> {
  try {
    const remote = await fetchRequestsForCurrentClient(
      clientOrganizationId != null && String(clientOrganizationId).trim() !== ''
        ? { clientOrganizationId }
        : undefined,
    );
    requestsCache = remote.map(toLocalRequest);
    notify();
  } catch (e) {
    console.error('[loadOptionRequestsForClient] failed — keeping previous cache', e);
  }
}

export async function loadOptionRequestsForAgency(
  agencyId: string,
  agencyOrganizationId?: string | null,
): Promise<void> {
  try {
    const remote = await fetchRequestsForAgency(agencyId, undefined, agencyOrganizationId);
    requestsCache = remote.map(toLocalRequest);
    notify();
  } catch (e) {
    console.error('[loadOptionRequestsForAgency] failed — keeping previous cache', e);
  }
}

export function getRequestStatus(threadId: string): ChatStatus | undefined {
  return requestsCache.find((r) => r.threadId === threadId)?.status;
}

/**
 * Client web: Messages tab attention dot (option/casting threads only).
 * True when any cached request is non-terminal per `toDisplayStatus` (statusHelpers)
 * (In negotiation / Draft). Not unread-based; B2B chats are separate.
 */
export function hasOpenOptionRequestAttention(): boolean {
  return requestsCache.some(optionRequestNeedsMessagesTabAttention);
}

export function getMessages(threadId: string): ChatMessage[] {
  return messagesCache.filter((m) => m.threadId === threadId);
}

export function addMessage(threadId: string, from: 'client' | 'agency' | 'model', text: string): void {
  const msg: ChatMessage = {
    id: `msg-${Date.now()}`,
    threadId,
    from,
    text,
    createdAt: Date.now(),
  };
  messagesCache.push(msg);
  notify();

  const req = requestsCache.find((r) => r.threadId === threadId);
  if (req) {
    const supabaseRole: 'client' | 'agency' | 'model' =
      from === 'client' ? 'client' : from === 'model' ? 'model' : 'agency';
    addOptionMessage(req.id, supabaseRole, text);
  }
}

export function getRequestByThreadId(threadId: string): OptionRequest | undefined {
  return requestsCache.find((r) => r.threadId === threadId);
}

export function getOptionRequestsByProjectId(projectId: string): OptionRequest[] {
  return requestsCache.filter((r) => r.projectId === projectId);
}

export async function loadMessagesForThread(threadId: string): Promise<ChatMessage[]> {
  const req = requestsCache.find((r) => r.threadId === threadId);
  if (!req) return [];
  const remote = await fetchMessages(req.id);
  const mapped = remote.map(toLocalMessage);
  messagesCache = messagesCache.filter((m) => m.threadId !== threadId);
  messagesCache.push(...mapped);
  notify();
  return mapped;
}

export async function refreshOptionRequestInCache(threadId: string): Promise<void> {
  const req = requestsCache.find((r) => r.threadId === threadId);
  if (!req) return;
  const updated = await getOptionRequestById(req.id);
  if (updated) {
    const idx = requestsCache.findIndex((r) => r.threadId === threadId);
    if (idx >= 0) requestsCache[idx] = toLocalRequest(updated);
    notify();
  }
}

/**
 * Agency accepts request — unified path.
 * Routes through agencyAcceptRequest which handles:
 *   - model_account_linked check
 *   - booking_event creation (if no model account)
 *   - model notification (if model has account)
 * Falls back to price-only agencyAcceptClientPrice if agencyAcceptRequest returns null
 * (e.g. RLS prevents the fetch for older requests).
 */
export async function agencyAcceptClientPriceStore(threadId: string): Promise<boolean> {
  const req = requestsCache.find((r) => r.threadId === threadId);
  if (!req) return false;

  const result = await agencyAcceptRequest(req.id);

  if (result === null) {
    // Fallback to price-only path for edge cases.
    const ok = await agencyAcceptClientPrice(req.id);
    if (!ok) return false;
  }

  const updated = await getOptionRequestById(req.id);
  if (updated) {
    Object.assign(req, toLocalRequest(updated));
    if (updated.final_status === 'option_confirmed') {
      // Calendar entry is created by the DB trigger fn_ensure_calendar_on_option_confirmed
      // (migration_calendar_booking_audit_fixes_2026_04.sql) — no client-side call needed.
      const inserted = await addOptionSystemMessage(req.id, 'agency_accepted_price');
      if (inserted) {
        messagesCache.push({
          id: inserted.id,
          threadId,
          from: 'system',
          text: inserted.text,
          createdAt: new Date(inserted.created_at).getTime(),
        });
      }
    }
    notify();
  }
  return true;
}

/** Agency sends counter offer; system message + web push + persistent DB notification. */
export async function agencyCounterOfferStore(threadId: string, counterPrice: number, currency: string): Promise<boolean> {
  const req = requestsCache.find((r) => r.threadId === threadId);
  if (!req) return false;
  const ok = await setAgencyCounterOffer(req.id, counterPrice);
  if (!ok) return false;
  req.agencyCounterPrice = counterPrice;
  req.clientPriceStatus = 'pending';
  req.finalStatus = 'option_pending';
  const inserted = await addOptionSystemMessage(req.id, 'agency_counter_offer', {
    price: counterPrice,
    currency,
  });
  if (inserted) {
    messagesCache.push({
      id: inserted.id,
      threadId,
      from: 'system',
      text: inserted.text,
      createdAt: new Date(inserted.created_at).getTime(),
    });
  }

  // Web push (browser Notification API)
  const agency = req.agencyId ? await getAgencyById(req.agencyId) : null;
  notifyClientAgencyCounterOffer(agency?.name ?? 'Agency');

  // Persistent DB notification so the client sees it in the notification bell.
  const full = await getOptionRequestById(req.id);
  if (full?.client_id) {
    void createNotification({
      user_id: full.client_id,
      type: 'agency_counter_offer',
      title: uiCopy.notifications.agencyCounterOffer.title,
      message: uiCopy.notifications.agencyCounterOffer.message,
      metadata: { option_request_id: req.id, counter_price: counterPrice, currency },
    });
  }

  notify();
  return true;
}

/** Agency rejects the client's proposed fee (counter-offer step follows). */
export async function agencyRejectClientPriceStore(threadId: string): Promise<boolean> {
  const req = requestsCache.find((r) => r.threadId === threadId);
  if (!req) return false;
  const ok = await agencyRejectClientPriceDb(req.id);
  if (!ok) return false;
  req.clientPriceStatus = 'rejected';
  const inserted = await addOptionSystemMessage(req.id, 'agency_declined_price');
  if (inserted) {
    messagesCache.push({
      id: inserted.id,
      threadId,
      from: 'system',
      text: inserted.text,
      createdAt: new Date(inserted.created_at).getTime(),
    });
  }
  notify();
  return true;
}

/** Client accepts agency counter → option_confirmed; system message (calendar entry via DB trigger). */
export async function clientAcceptCounterStore(threadId: string): Promise<boolean> {
  const req = requestsCache.find((r) => r.threadId === threadId);
  if (!req) return false;
  const ok = await clientAcceptCounterPrice(req.id);
  if (!ok) return false;
  const updated = await getOptionRequestById(req.id);
  if (updated) {
    Object.assign(req, toLocalRequest(updated));
    if (updated.final_status === 'option_confirmed') {
      // Calendar entry is created by the DB trigger fn_ensure_calendar_on_option_confirmed
      // (migration_calendar_booking_audit_fixes_2026_04.sql) — no client-side call needed.
      const inserted = await addOptionSystemMessage(req.id, 'client_accepted_counter');
      if (inserted) {
        messagesCache.push({
          id: inserted.id,
          threadId,
          from: 'system',
          text: inserted.text,
          createdAt: new Date(inserted.created_at).getTime(),
        });
      }
    }
    notify();
  }
  return true;
}

/** Clear all cached data and reset hydration state (call on sign-out). */
export function resetOptionRequestsStore(): void {
  requestsCache = [];
  messagesCache = [];
  hydrated = false;
  notify();
}

/** After server-side delete of an option_request: drop thread + messages from local cache. */
export function purgeOptionThreadFromStore(threadId: string): void {
  requestsCache = requestsCache.filter((r) => r.threadId !== threadId);
  messagesCache = messagesCache.filter((m) => m.threadId !== threadId);
  notify();
}

/** Client confirms job → job_confirmed; update calendar to Job, system message + notifications. */
export async function clientConfirmJobStore(threadId: string): Promise<boolean> {
  const req = requestsCache.find((r) => r.threadId === threadId);
  if (!req) return false;
  const ok = await clientConfirmJobOnSupabase(req.id);
  if (!ok) return false;
  const refreshed = await getOptionRequestById(req.id);
  if (refreshed) {
    Object.assign(req, toLocalRequest(refreshed));
  } else {
    req.finalStatus = 'job_confirmed';
    req.status = 'confirmed';
  }
  await updateCalendarEntryToJob(req.id);
  const inserted = await addOptionSystemMessage(req.id, 'job_confirmed_by_client');
  if (inserted) {
    messagesCache.push({
      id: inserted.id,
      threadId,
      from: 'system',
      text: inserted.text,
      createdAt: new Date(inserted.created_at).getTime(),
    });
  }

  // Notify agency org + model about job confirmation.
  // full.organization_id is the CLIENT org — do NOT notify it here (client triggered this action).
  // Resolve the agency org the same way createBookingEventFromRequest does.
  const full = await getOptionRequestById(req.id);
  if (full) {
    const notifications: Parameters<typeof createNotifications>[0] = [];

    const agencyOrgId = await resolveAgencyOrgIdForOptionNotification(
      full.agency_id,
      full.agency_organization_id,
    );

    if (!agencyOrgId) {
      console.error('[notifications] clientConfirmJobStore: agency org not found for agency_id', full.agency_id, '— agency notification skipped.');
    } else {
      notifications.push({
        organization_id: agencyOrgId,
        type: 'job_confirmed',
        title: uiCopy.notifications.jobConfirmed.title,
        message: uiCopy.notifications.jobConfirmed.message,
        metadata: { option_request_id: full.id },
      });
    }

    if (full.model_account_linked) {
      const { data: modelRow } = await supabase
        .from('models')
        .select('user_id')
        .eq('id', full.model_id)
        .maybeSingle();
      const modelUserId = (modelRow as { user_id?: string | null } | null)?.user_id;
      if (modelUserId) {
        notifications.push({
          user_id: modelUserId,
          type: 'job_confirmed',
          title: uiCopy.notifications.jobConfirmed.title,
          message: uiCopy.notifications.jobConfirmed.message,
          metadata: { option_request_id: full.id },
        });
      }
    }
    if (notifications.length > 0) void createNotifications(notifications);
  }

  notify();
  return true;
}

/** Client rejects agency counter offer → request is closed. */
export async function clientRejectCounterStore(threadId: string): Promise<boolean> {
  const req = requestsCache.find((r) => r.threadId === threadId);
  if (!req) return false;
  const ok = await clientRejectCounterOfferOnSupabase(req.id);
  if (!ok) return false;
  req.clientPriceStatus = 'rejected';
  /** Keep negotiation open in UI — do not set ChatStatus to rejected (hides agency actions). */
  req.status = 'in_negotiation';
  const inserted = await addOptionSystemMessage(req.id, 'client_rejected_counter');
  if (inserted) {
    messagesCache.push({
      id: inserted.id,
      threadId,
      from: 'system',
      text: inserted.text,
      createdAt: new Date(inserted.created_at).getTime(),
    });
  }

  // Notify agency org about the rejection.
  // full.organization_id is the CLIENT org — resolve agency org explicitly.
  const full = await getOptionRequestById(req.id);
  if (full) {
    const agencyOrgId = await resolveAgencyOrgIdForOptionNotification(
      full.agency_id,
      full.agency_organization_id,
    );
    if (!agencyOrgId) {
      console.error('[notifications] clientRejectCounterStore: agency org not found for agency_id', full.agency_id, '— notification skipped.');
    } else {
      void createNotification({
        organization_id: agencyOrgId,
        type: 'client_rejected_counter',
        title: uiCopy.notifications.clientRejectedCounter.title,
        message: uiCopy.notifications.clientRejectedCounter.message,
        metadata: { option_request_id: req.id },
      });
    }
  }

  notify();
  return true;
}

/**
 * Agency rejects the whole negotiation — same atomic delete as trash (`delete_option_request_full`).
 * Removes thread, messages, calendar hooks, notifications for this request (blocked when job_confirmed).
 */
export async function agencyRejectNegotiationStore(threadId: string): Promise<boolean> {
  const req = requestsCache.find((r) => r.threadId === threadId);
  if (!req) return false;
  const ok = await deleteOptionRequestFull(req.id, {
    auditActor: 'agency',
    auditOrganizationId: req.agencyOrganizationId,
  });
  if (!ok) return false;
  purgeOptionThreadFromStore(threadId);
  return true;
}
