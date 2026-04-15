/**
 * Option Requests + Chat (Client ↔ Agency).
 * Alle Anfragen und Chats in Supabase gespeichert (option_requests + option_request_messages).
 * Pro Partei laden: loadOptionRequestsForClient(clientOrgId?), loadOptionRequestsForAgency(agencyId),
 * loadOptionsForModel(modelId). Cache wird mit den jeweiligen Daten gefüllt.
 */

import { formatParenTimeRange } from '../utils/formatTimeForUi';
import {
  getOptionRequestById,
  getOptionRequestByIdModelSafe,
  insertOptionRequest,
  resolveAgencyOrganizationIdForOptionRequest,
  modelConfirmOptionRequest,
  modelRejectOptionRequest,
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
  insertAgencyOptionRequest,
  agencyConfirmJobAgencyOnly,
  type SupabaseOptionRequest,
  type SupabaseOptionRequestModelSafe,
  type SupabaseOptionMessage,
  subscribeToOptionRequestChanges,
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

/** Per-thread guard against double-submit; DB updates remain idempotent. */
const criticalOptionActionInflight = new Set<string>();

function beginCriticalOptionAction(threadId: string): boolean {
  if (criticalOptionActionInflight.has(threadId)) return false;
  criticalOptionActionInflight.add(threadId);
  return true;
}

function endCriticalOptionAction(threadId: string): void {
  criticalOptionActionInflight.delete(threadId);
}

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
  /** Denormalized client org display name. */
  clientOrganizationName?: string;
  /** Optional role / shoot description set by the client. Shown to the model in their inbox. */
  jobDescription?: string;
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
  /** Denormalized agency org display name. Set on agency-only requests for model visibility. */
  agencyOrganizationName?: string;
  /** true = agency-only manual event (no client party, no price negotiation). */
  isAgencyOnly?: boolean;
  /** Links to agency_event_groups for grouped manual events. */
  agencyEventGroupId?: string;
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
    /** Prefer denormalized org name so models/agencies never see a person placeholder when org is known. */
    clientName: r.client_organization_name || r.client_name || 'Unknown client',
    clientOrganizationId: r.client_organization_id ?? r.organization_id ?? undefined,
    clientOrganizationName: r.client_organization_name ?? undefined,
    jobDescription: r.job_description ?? undefined,
    modelName: r.model_name || 'Unknown model',
    modelId: r.model_id,
    date: r.requested_date,
    createdAt: new Date(r.created_at).getTime(),
    threadId: r.id,
    status: r.status,
    projectId: r.project_id ?? undefined,
    proposedPrice: 'proposed_price' in r ? (r.proposed_price ?? undefined) : undefined,
    agencyCounterPrice:
      'agency_counter_price' in r ? (r.agency_counter_price ?? undefined) : undefined,
    clientPriceStatus:
      'client_price_status' in r ? (r.client_price_status ?? undefined) : undefined,
    finalStatus: r.final_status ?? undefined,
    requestType: r.request_type ?? 'option',
    currency: r.currency ?? undefined,
    startTime: r.start_time ?? undefined,
    endTime: r.end_time ?? undefined,
    modelApproval: r.model_approval ?? 'pending',
    modelApprovedAt: r.model_approved_at ?? undefined,
    modelAccountLinked: r.model_account_linked ?? false,
    agencyId: r.agency_id,
    agencyOrganizationId: r.agency_organization_id ?? undefined,
    agencyOrganizationName: r.agency_organization_name ?? undefined,
    isAgencyOnly: r.is_agency_only ?? false,
    agencyEventGroupId: r.agency_event_group_id ?? undefined,
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

const MAX_CACHED_MESSAGE_THREADS = 50;
const recentThreadAccess: string[] = [];

function trackThreadAccess(threadId: string): void {
  const idx = recentThreadAccess.indexOf(threadId);
  if (idx >= 0) recentThreadAccess.splice(idx, 1);
  recentThreadAccess.push(threadId);
}

function trimMessagesCache(): void {
  if (recentThreadAccess.length <= MAX_CACHED_MESSAGE_THREADS) return;
  const evict = recentThreadAccess.splice(
    0,
    recentThreadAccess.length - MAX_CACHED_MESSAGE_THREADS,
  );
  const evictSet = new Set(evict);
  messagesCache = messagesCache.filter((m) => !evictSet.has(m.threadId));
}

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
    /** Optional role / shoot description entered by the client. Shown to the model. */
    jobDescription?: string;
    /** Set when the request is triggered from a shared package. */
    source?: 'package';
    /** ID of the guest_links row if source is 'package'. */
    packageId?: string;
    /** Called after the option_request row exists (real UUID thread id for Messages UI). */
    onThreadReady?: (dbThreadId: string) => void;
    /** Telemetry / debugging: which client surface initiated the request. */
    flowSource?: OptionRequestFlowSource;
    /** Denormalized client org display name — propagated to option_requests for model visibility. */
    clientOrganizationName?: string;
  },
): string {
  const threadId = `thread-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const requestType = extra?.requestType ?? 'option';
  const timeStr = formatParenTimeRange(extra?.startTime, extra?.endTime);
  const _label = requestType === 'casting' ? 'Casting' : 'Option';
  const req: OptionRequest = {
    id: `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    clientName,
    clientOrganizationName: extra?.clientOrganizationName,
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
    jobDescription: extra?.jobDescription,
    modelApproval: 'pending',
    modelAccountLinked: false,
    finalStatus: 'option_pending',
    clientPriceStatus: 'pending',
  };
  requestsCache.unshift(req);
  const autoText =
    requestType === 'casting'
      ? `Casting request for ${date}${timeStr}.`
      : `Option request for ${date}${timeStr}.`;
  const autoMessage: ChatMessage = {
    id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    threadId,
    from: 'client',
    text: autoText,
    createdAt: Date.now(),
  };
  messagesCache.push(autoMessage);
  notify();

  (async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
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
        const { getMyClientMemberRole, ensureClientOrganization } =
          await import('../services/organizationsInvitationsSupabase');
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

      // Derive model account status from canonical truth (models.user_id)
      const modelHasAccount = !!(model as { user_id?: string | null } | null)?.user_id;
      req.modelAccountLinked = modelHasAccount;

      const countryCodeUsed = extra?.countryCode?.trim()
        ? extra?.countryCode
        : (model?.country_code ?? model?.country ?? null);

      if (countryCodeUsed) {
        const resolved = await resolveAgencyForModelAndCountry(modelId, countryCodeUsed);
        if (resolved) {
          agencyId = resolved;
          countryCodeUsedForBooking = countryCodeUsed;
        } else {
          // No MAT entry for this country (e.g. model physically in FR but
          // represented only in UK). Fall back to home agency and skip strict
          // MAT+country validation — the RPC will verify models.agency_id instead.
          console.warn('[addOptionRequest] no MAT entry for territory, using fallback agency', {
            modelId,
            country: countryCodeUsed,
            fallbackAgency,
          });
          agencyId = fallbackAgency;
          countryCodeUsedForBooking = null;
        }

        if (!agencyId) {
          showAppAlert(uiCopy.common.error, uiCopy.alerts.noTerritoryForCountry);
          requestsCache = requestsCache.filter((x) => x.id !== req.id);
          messagesCache = messagesCache.filter((m) => m.id !== autoMessage.id);
          notify();
          return;
        }
      } else {
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

    if (countryCodeUsedForBooking && agencyId && !agencyOrganizationId) {
      console.error(
        '[addOptionRequest] territory validation failed: MAT does not confirm agency for territory',
        {
          modelId,
          agencyId,
          countryCode: countryCodeUsedForBooking,
        },
      );
      showAppAlert(uiCopy.common.error, uiCopy.alerts.noTerritoryForCountry);
      requestsCache = requestsCache.filter((x) => x.id !== req.id);
      messagesCache = messagesCache.filter((m) => m.id !== autoMessage.id);
      notify();
      return;
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
    const conflictResult = await checkCalendarConflict(modelId, date, normStart, normEnd);
    if (conflictResult.has_conflict) {
      const conflictTitles = conflictResult.conflicting_entries
        .map((e) => e.title ?? e.entry_type)
        .join(', ');
      showAppAlert(
        uiCopy.calendarValidation.conflictWarningTitle ?? 'Schedule Conflict',
        (
          uiCopy.calendarValidation.conflictWarningMessage ??
          'This model already has a booking on this date: {{entries}}. You can still submit the request.'
        ).replace('{{entries}}', conflictTitles),
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
      job_description: extra?.jobDescription,
      proposed_price: extra?.proposedPrice,
      currency: extra?.currency,
      start_time: normStart ?? undefined,
      end_time: normEnd ?? undefined,
      request_type: requestType,
      organization_id: organizationId,
      client_organization_id: organizationId ?? null,
      client_organization_name: extra?.clientOrganizationName ?? null,
      agency_organization_id: agencyOrganizationId,
      created_by: user?.id ?? null,
    });
    if (!result) {
      // DB insert failed: roll back the optimistic stub so the UI stays consistent.
      requestsCache = requestsCache.filter((x) => x.id !== req.id);
      messagesCache = messagesCache.filter((m) => m.id !== autoMessage.id);
      notify();
      console.error(
        '[addOptionRequest] insertOptionRequest returned null – optimistic entry rolled back',
        {
          flowSource,
          actingUserId: clientId,
          clientOrganizationId: organizationId,
          modelId,
          requestType,
          countryCode: countryCodeUsedForBooking,
          resolvedAgencyId: agencyId,
          resolvedAgencyOrganizationId: agencyOrganizationId,
        },
      );
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
        const sysClient = await addOptionSystemMessage(result.id, 'no_model_account_client_notice');
        if (sysClient) {
          messagesCache.push({
            id: sysClient.id,
            threadId: result.id,
            from: 'system',
            text: sysClient.text,
            createdAt: new Date(sysClient.created_at).getTime(),
          });
        }
        const sysAgency = await addOptionSystemMessage(result.id, 'no_model_account');
        if (sysAgency) {
          messagesCache.push({
            id: sysAgency.id,
            threadId: result.id,
            from: 'system',
            text: sysAgency.text,
            createdAt: new Date(sysAgency.created_at).getTime(),
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
  if (!beginCriticalOptionAction(threadId)) return false;
  try {
    const prevApproval = req.modelApproval;
    const prevApprovedAt = req.modelApprovedAt;
    const prevStatus = req.status;
    req.modelApproval = 'approved';
    req.modelApprovedAt = new Date().toISOString();
    req.status = 'confirmed';
    notify();
    const ok = await modelConfirmOptionRequest(req.id);
    if (!ok) {
      req.modelApproval = prevApproval;
      req.modelApprovedAt = prevApprovedAt;
      req.status = prevStatus;
      notify();
      console.error(
        '[approveOptionAsModel] modelConfirmOptionRequest failed – rolled back',
        req.id,
      );
      return false;
    }
    const refreshed = await getOptionRequestByIdModelSafe(req.id);
    if (refreshed) {
      Object.assign(req, toLocalRequest(refreshed));
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
  } finally {
    endCriticalOptionAction(threadId);
  }
}

export async function rejectOptionAsModel(threadId: string): Promise<boolean> {
  const req = requestsCache.find((r) => r.threadId === threadId);
  if (!req) return false;
  if (!beginCriticalOptionAction(threadId)) return false;
  try {
    const prevApproval = req.modelApproval;
    const prevStatus = req.status;
    const prevFinalStatus = req.finalStatus;
    req.modelApproval = 'rejected';
    req.status = 'rejected';
    req.finalStatus = 'option_pending';
    notify();
    const ok = await modelRejectOptionRequest(req.id);
    if (!ok) {
      req.modelApproval = prevApproval;
      req.status = prevStatus;
      req.finalStatus = prevFinalStatus;
      notify();
      console.error('[rejectOptionAsModel] modelRejectOptionRequest failed – rolled back', req.id);
      return false;
    }
    const refreshed = await getOptionRequestByIdModelSafe(req.id);
    if (refreshed) {
      Object.assign(req, toLocalRequest(refreshed));
    }
    const inserted = await addOptionSystemMessage(req.id, 'model_declined_availability');
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
  } finally {
    endCriticalOptionAction(threadId);
  }
}

export function getOutstandingOptionsForModel(modelId: string): OptionRequest[] {
  return requestsCache.filter(
    (r) => r.modelId === modelId && r.modelApproval === 'pending' && r.status === 'in_negotiation',
  );
}

export async function loadOptionsForModel(modelId: string): Promise<void> {
  try {
    const remote = await getOptionRequestsForModel(modelId);
    if (remote.length > 0) {
      for (const r of remote) {
        const existing = requestsCache.find((x) => x.id === r.id);
        if (existing) {
          Object.assign(existing, toLocalRequest(r));
        } else {
          requestsCache.push(toLocalRequest(r));
        }
      }
      notify();
    }
  } catch {
    /* keep cache */
  }
}

export async function loadOptionRequestsForClient(
  clientOrganizationId?: string | null,
): Promise<void> {
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
  trackThreadAccess(threadId);
  return messagesCache.filter((m) => m.threadId === threadId);
}

export function addMessage(
  threadId: string,
  from: 'client' | 'agency' | 'model',
  text: string,
): void {
  const tempId = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const msg: ChatMessage = {
    id: tempId,
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
    void addOptionMessage(req.id, supabaseRole, text).then((result) => {
      if (!result) {
        messagesCache = messagesCache.filter((m) => m.id !== tempId);
        notify();
      } else {
        const idx = messagesCache.findIndex((m) => m.id === tempId);
        if (idx >= 0) {
          messagesCache[idx] = toLocalMessage(result);
          notify();
        }
      }
    });
  }
}

export function getRequestByThreadId(threadId: string): OptionRequest | undefined {
  return requestsCache.find((r) => r.threadId === threadId);
}

export function getOptionRequestsByProjectId(projectId: string): OptionRequest[] {
  return requestsCache.filter((r) => r.projectId === projectId);
}

export async function loadMessagesForThread(
  threadId: string,
  opts?: { viewerRole?: 'client' | 'agency' | 'model' },
): Promise<ChatMessage[]> {
  const req = requestsCache.find((r) => r.threadId === threadId);
  if (!req) return [];
  const remote = await fetchMessages(
    req.id,
    opts?.viewerRole ? { viewerRole: opts.viewerRole } : undefined,
  );
  const mapped = remote.map(toLocalMessage);
  messagesCache = messagesCache.filter((m) => m.threadId !== threadId);
  messagesCache.push(...mapped);
  trackThreadAccess(threadId);
  trimMessagesCache();
  notify();
  return mapped;
}

/**
 * Loads older messages for an option thread using cursor-based pagination.
 * Prepends them to the existing messages cache without removing newer ones.
 * Returns the number of messages loaded (0 means no more older messages).
 */
export async function loadOlderMessagesForThread(
  threadId: string,
  opts?: { viewerRole?: 'client' | 'agency' | 'model' },
): Promise<number> {
  const req = requestsCache.find((r) => r.threadId === threadId);
  if (!req) return 0;

  const existing = messagesCache.filter((m) => m.threadId === threadId);
  const oldest =
    existing.length > 0
      ? existing.reduce((a, b) => (a.createdAt < b.createdAt ? a : b))
      : undefined;

  if (!oldest) return 0;

  const remote = await fetchMessages(req.id, {
    beforeId: oldest.id,
    limit: 50,
    ...(opts?.viewerRole ? { viewerRole: opts.viewerRole } : {}),
  });

  if (remote.length === 0) return 0;

  const mapped = remote.map(toLocalMessage);
  const existingIds = new Set(messagesCache.map((m) => m.id));
  const newMessages = mapped.filter((m) => !existingIds.has(m.id));
  messagesCache.push(...newMessages);
  notify();
  return newMessages.length;
}

export async function refreshOptionRequestInCache(
  threadId: string,
  opts?: { modelSafe?: boolean },
): Promise<void> {
  const req = requestsCache.find((r) => r.threadId === threadId);
  if (!req) return;
  const fetcher = opts?.modelSafe ? getOptionRequestByIdModelSafe : getOptionRequestById;
  const updated = await fetcher(req.id);
  if (updated) {
    const idx = requestsCache.findIndex((r) => r.threadId === threadId);
    if (idx >= 0) requestsCache[idx] = toLocalRequest(updated);
    notify();
  }
}

/**
 * Subscribe to realtime row-level updates on a specific option_request.
 * When the DB row changes (status, final_status, price fields, etc.)
 * the local cache is refreshed from the server. Returns cleanup function.
 */
export function subscribeToOptionRequestRowChanges(
  requestId: string,
  opts?: { modelSafe?: boolean },
): () => void {
  const threadId = requestsCache.find((r) => r.id === requestId)?.threadId;
  return subscribeToOptionRequestChanges(requestId, async () => {
    if (!threadId) return;
    await refreshOptionRequestInCache(threadId, opts);
  });
}

/**
 * Agency confirms AVAILABILITY only (Axis 2: final_status → option_confirmed).
 * Does NOT touch price. Price and availability are independent axes.
 */
export async function agencyConfirmAvailabilityStore(threadId: string): Promise<boolean> {
  const req = requestsCache.find((r) => r.threadId === threadId);
  if (!req) return false;
  if (!beginCriticalOptionAction(threadId)) return false;
  try {
    const result = await agencyAcceptRequest(req.id);
    if (result === null) return false;

    const updated = await getOptionRequestById(req.id);
    if (updated) {
      Object.assign(req, toLocalRequest(updated));
      const inserted = await addOptionSystemMessage(req.id, 'agency_confirmed_availability');
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
    } else {
      console.warn(
        '[agencyConfirmAvailabilityStore] RPC succeeded but post-refresh failed — local state may be stale',
        req.id,
      );
    }
    return true;
  } finally {
    endCriticalOptionAction(threadId);
  }
}

/**
 * Agency accepts the client's proposed PRICE only (Axis 1: client_price_status → accepted).
 * Does NOT touch availability / final_status.
 */
export async function agencyAcceptClientPriceStore(threadId: string): Promise<boolean> {
  const req = requestsCache.find((r) => r.threadId === threadId);
  if (!req) return false;
  if (!beginCriticalOptionAction(threadId)) return false;
  try {
    const priceOk = await agencyAcceptClientPrice(req.id);
    if (!priceOk) return false;

    const updated = await getOptionRequestById(req.id);
    if (updated) {
      Object.assign(req, toLocalRequest(updated));
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
      notify();
    } else {
      console.warn(
        '[agencyAcceptClientPriceStore] RPC succeeded but post-refresh failed — local state may be stale',
        req.id,
      );
    }
    return true;
  } finally {
    endCriticalOptionAction(threadId);
  }
}

/** Agency sends counter offer; system message + web push + persistent DB notification. */
export async function agencyCounterOfferStore(
  threadId: string,
  counterPrice: number,
  currency: string,
): Promise<boolean> {
  const req = requestsCache.find((r) => r.threadId === threadId);
  if (!req) return false;
  if (!beginCriticalOptionAction(threadId)) return false;
  try {
    const ok = await setAgencyCounterOffer(req.id, counterPrice);
    if (!ok) return false;
    const refreshedAfterRpc = await getOptionRequestById(req.id);
    if (refreshedAfterRpc) {
      Object.assign(req, toLocalRequest(refreshedAfterRpc));
    } else {
      // Fallback: only Axis 1 (price) fields — never touch finalStatus (Axis 2).
      req.agencyCounterPrice = counterPrice;
      req.clientPriceStatus = 'pending';
    }
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

    // Persistent DB notification — send to client org so all org members see it.
    const full = refreshedAfterRpc ?? (await getOptionRequestById(req.id));
    if (full?.client_id) {
      void createNotification({
        user_id: full.client_id,
        organization_id: full.organization_id ?? full.client_organization_id ?? undefined,
        type: 'agency_counter_offer',
        title: uiCopy.notifications.agencyCounterOffer.title,
        message: uiCopy.notifications.agencyCounterOffer.message,
        metadata: { option_request_id: req.id, counter_price: counterPrice, currency },
      });
    }

    notify();
    return true;
  } finally {
    endCriticalOptionAction(threadId);
  }
}

/** Agency rejects the client's proposed fee (counter-offer step follows). */
export async function agencyRejectClientPriceStore(threadId: string): Promise<boolean> {
  const req = requestsCache.find((r) => r.threadId === threadId);
  if (!req) return false;
  if (!beginCriticalOptionAction(threadId)) return false;
  try {
    const ok = await agencyRejectClientPriceDb(req.id);
    if (!ok) return false;
    const refreshed = await getOptionRequestById(req.id);
    if (refreshed) {
      Object.assign(req, toLocalRequest(refreshed));
    } else {
      req.clientPriceStatus = 'rejected';
    }
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
  } finally {
    endCriticalOptionAction(threadId);
  }
}

/** Client accepts agency counter → price accepted (Axis 1 only); system message. */
export async function clientAcceptCounterStore(threadId: string): Promise<boolean> {
  const req = requestsCache.find((r) => r.threadId === threadId);
  if (!req) return false;
  if (!beginCriticalOptionAction(threadId)) return false;
  try {
    const ok = await clientAcceptCounterPrice(req.id);
    if (!ok) return false;
    const updated = await getOptionRequestById(req.id);
    if (updated) {
      Object.assign(req, toLocalRequest(updated));
    }
    // System message for client-accepted-counter is always emitted regardless of
    // final_status. Price acceptance (Axis 1) is independent of availability (Axis 2).
    // The old guard `if (final_status === 'option_confirmed')` suppressed the message
    // when availability was not yet confirmed — breaking cross-role visibility.
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
    notify();
    return true;
  } finally {
    endCriticalOptionAction(threadId);
  }
}

/** Clear all cached data and reset hydration state (call on sign-out). */
export function resetOptionRequestsStore(): void {
  requestsCache = [];
  messagesCache = [];
  hydrated = false;
  criticalOptionActionInflight.clear();
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
  if (req.isAgencyOnly) {
    console.error(
      'clientConfirmJobStore: blocked — agency-only requests must use agency_confirm_job_agency_only',
    );
    return false;
  }
  if (req.requestType === 'casting') {
    console.error('clientConfirmJobStore: blocked — castings cannot become jobs');
    return false;
  }
  if (!beginCriticalOptionAction(threadId)) return false;
  try {
    const ok = await clientConfirmJobOnSupabase(req.id);
    if (!ok) return false;
    const refreshed = await getOptionRequestById(req.id);
    if (refreshed) {
      Object.assign(req, toLocalRequest(refreshed));
    } else {
      req.finalStatus = 'job_confirmed';
      req.status = 'confirmed';
    }
    // Calendar upgrade with retry — DB truth (job_confirmed) is already set;
    // calendar entry must follow. Retry once after brief delay on failure.
    const calOk = await updateCalendarEntryToJob(req.id);
    if (!calOk) {
      console.warn('[clientConfirmJobStore] calendar upgrade failed — retrying once');
      await new Promise((r) => setTimeout(r, 200));
      const retryOk = await updateCalendarEntryToJob(req.id);
      if (!retryOk) {
        console.error('[clientConfirmJobStore] calendar upgrade retry failed — entry may be stale');
      }
    }
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
    if (!full) {
      console.error(
        'clientConfirmJobStore: post-confirm fetch returned null — agency/model notifications skipped',
        req.id,
      );
    }
    if (full) {
      const notifications: Parameters<typeof createNotifications>[0] = [];

      const agencyOrgId = await resolveAgencyOrgIdForOptionNotification(
        full.agency_id,
        full.agency_organization_id,
      );

      if (!agencyOrgId) {
        console.error(
          '[notifications] clientConfirmJobStore: agency org not found for agency_id',
          full.agency_id,
          '— agency notification skipped.',
        );
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
  } finally {
    endCriticalOptionAction(threadId);
  }
}

/** Client rejects agency counter offer → request is closed. */
export async function clientRejectCounterStore(threadId: string): Promise<boolean> {
  const req = requestsCache.find((r) => r.threadId === threadId);
  if (!req) return false;
  if (!beginCriticalOptionAction(threadId)) return false;
  try {
    const ok = await clientRejectCounterOfferOnSupabase(req.id);
    if (!ok) return false;
    const refreshed = await getOptionRequestById(req.id);
    if (refreshed) {
      Object.assign(req, toLocalRequest(refreshed));
    } else {
      req.clientPriceStatus = 'rejected';
      /** Keep negotiation open in UI — do not set ChatStatus to rejected (hides agency actions). */
      req.status = 'in_negotiation';
    }
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
        console.error(
          '[notifications] clientRejectCounterStore: agency org not found for agency_id',
          full.agency_id,
          '— notification skipped.',
        );
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
  } finally {
    endCriticalOptionAction(threadId);
  }
}

/**
 * Agency rejects the whole negotiation — same atomic delete as trash (`delete_option_request_full`).
 * Removes thread, messages, calendar hooks, notifications for this request (blocked when job_confirmed).
 */
export async function agencyRejectNegotiationStore(threadId: string): Promise<boolean> {
  const req = requestsCache.find((r) => r.threadId === threadId);
  if (!req) return false;
  if (!beginCriticalOptionAction(threadId)) return false;
  try {
    const ok = await deleteOptionRequestFull(req.id, {
      auditActor: 'agency',
      auditOrganizationId: req.agencyOrganizationId,
    });
    if (!ok) return false;
    purgeOptionThreadFromStore(threadId);
    return true;
  } finally {
    endCriticalOptionAction(threadId);
  }
}

// ---------------------------------------------------------------------------
// Agency-Only Manual Event — Job Confirmed
// ---------------------------------------------------------------------------

/**
 * Canonical invariant: only allowed when is_agency_only=true.
 * Confirms job for an individual model after they approved availability.
 */
export async function agencyConfirmJobAgencyOnlyStore(threadId: string): Promise<boolean> {
  const req = requestsCache.find((r) => r.threadId === threadId);
  if (!req) return false;
  if (!req.isAgencyOnly) return false;
  if (req.requestType === 'casting') {
    console.error('agencyConfirmJobAgencyOnlyStore: blocked — castings cannot become jobs');
    return false;
  }
  if (!beginCriticalOptionAction(threadId)) return false;
  try {
    const ok = await agencyConfirmJobAgencyOnly(req.id);
    if (!ok) return false;
    const refreshed = await getOptionRequestById(req.id);
    if (refreshed) {
      Object.assign(req, toLocalRequest(refreshed));
    } else {
      req.finalStatus = 'job_confirmed';
      req.status = 'confirmed';
    }
    // Calendar upgrade with retry — DB truth (job_confirmed) is already set;
    // calendar entry must follow. Retry once after brief delay on failure.
    const calOk = await updateCalendarEntryToJob(req.id);
    if (!calOk) {
      console.warn('[agencyConfirmJobAgencyOnlyStore] calendar upgrade failed — retrying once');
      await new Promise((r) => setTimeout(r, 200));
      const retryOk = await updateCalendarEntryToJob(req.id);
      if (!retryOk) {
        console.error(
          '[agencyConfirmJobAgencyOnlyStore] calendar upgrade retry failed — entry may be stale',
        );
      }
    }

    // System message emitted from the store (parity with clientConfirmJobStore).
    // The RPC handles only the UPDATE; message creation is the store's responsibility.
    const sysMsg = await addOptionSystemMessage(req.id, 'job_confirmed_by_agency');
    if (sysMsg) {
      messagesCache.push({
        id: sysMsg.id,
        threadId,
        from: 'system',
        text: sysMsg.text,
        createdAt: new Date(sysMsg.created_at).getTime(),
      });
    }

    // Notify model about job confirmation (agency triggered — no agency notification needed).
    const full = await getOptionRequestById(req.id);
    if (full && full.model_account_linked) {
      const { data: modelRow } = await supabase
        .from('models')
        .select('user_id')
        .eq('id', full.model_id)
        .maybeSingle();
      const modelUserId = (modelRow as { user_id?: string | null } | null)?.user_id;
      if (modelUserId) {
        void createNotifications([
          {
            user_id: modelUserId,
            type: 'job_confirmed',
            title: uiCopy.notifications.jobConfirmed.title,
            message: uiCopy.notifications.jobConfirmed.message,
            metadata: { option_request_id: full.id },
          },
        ]);
      }
    }

    notify();
    return true;
  } finally {
    endCriticalOptionAction(threadId);
  }
}

/**
 * Create an agency-only manual option/casting request.
 * Returns the new request id or null on failure.
 */
export async function createAgencyOnlyOptionRequest(params: {
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
  const requestId = await insertAgencyOptionRequest(params);
  if (!requestId) return null;

  const full = await getOptionRequestById(requestId);
  if (full) {
    const local = toLocalRequest(full);
    const existing = requestsCache.find((r) => r.id === requestId);
    if (existing) {
      Object.assign(existing, local);
    } else {
      requestsCache.push(local);
    }

    if (local.modelAccountLinked === false) {
      const sysMsg = await addOptionSystemMessage(requestId, 'no_model_account');
      if (sysMsg) {
        messagesCache.push({
          id: sysMsg.id,
          threadId: requestId,
          from: 'system',
          text: sysMsg.text,
          createdAt: new Date(sysMsg.created_at).getTime(),
        });
      }
    }

    notify();
  }
  return requestId;
}
