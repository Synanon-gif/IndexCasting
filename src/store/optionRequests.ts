/**
 * Option Requests + Chat (Client ↔ Agency).
 * Alle Anfragen und Chats in Supabase gespeichert (option_requests + option_request_messages).
 * Pro Partei laden: loadOptionRequestsForClient(), loadOptionRequestsForAgency(agencyId),
 * loadOptionsForModel(modelId). Cache wird mit den jeweiligen Daten gefüllt.
 */

import {
  getOptionRequests as fetchRequests,
  getOptionRequestById,
  insertOptionRequest,
  updateOptionRequestStatus,
  updateModelApproval,
  getOptionMessages as fetchMessages,
  addOptionMessage,
  getOptionRequestsForModel,
  getOptionRequestsForCurrentClient as fetchRequestsForCurrentClient,
  getOptionRequestsForAgency as fetchRequestsForAgency,
  setAgencyCounterOffer,
  agencyAcceptClientPrice,
  agencyRejectClientPrice as agencyRejectClientPriceDb,
  clientAcceptCounterPrice,
  clientConfirmJobOnSupabase,
  type SupabaseOptionRequest,
  type SupabaseOptionMessage,
} from '../services/optionRequestsSupabase';
import { supabase } from '../../lib/supabase';
import { getModelByIdFromSupabase } from '../services/modelsSupabase';
import { getAgencyById } from '../services/agenciesSupabase';
import { resolveAgencyForModelAndCountry } from '../services/territoriesSupabase';
import { createBookingMessageInClientAgencyChat } from '../services/bookingChatIntegrationSupabase';
import { upsertCalendarEntry, updateCalendarEntryToJob } from '../services/calendarSupabase';
import { notifyClientAgencyCounterOffer } from '../services/pushNotifications';
import { showAppAlert } from '../utils/crossPlatformAlert';
import { uiCopy } from '../constants/uiCopy';

export type ChatStatus = 'in_negotiation' | 'confirmed' | 'rejected';

export type OptionRequest = {
  id: string;
  clientName: string;
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
};

export type ChatMessage = {
  id: string;
  threadId: string;
  from: 'client' | 'agency';
  text: string;
  createdAt: number;
};

function toLocalRequest(r: SupabaseOptionRequest): OptionRequest {
  return {
    id: r.id,
    clientName: r.client_name ?? 'Client',
    modelName: r.model_name ?? 'Model',
    modelId: r.model_id,
    date: r.requested_date,
    createdAt: new Date(r.created_at).getTime(),
    threadId: r.id,
    status: r.status,
    projectId: r.project_id ?? undefined,
    proposedPrice: r.proposed_price ?? undefined,
    agencyCounterPrice: r.agency_counter_price ?? undefined,
    clientPriceStatus: r.client_price_status ?? undefined,
    finalStatus: r.final_status ?? undefined,
    requestType: r.request_type ?? 'option',
    currency: r.currency ?? undefined,
    startTime: r.start_time ?? undefined,
    endTime: r.end_time ?? undefined,
    modelApproval: r.model_approval ?? 'pending',
    modelApprovedAt: r.model_approved_at ?? undefined,
    agencyId: r.agency_id,
  };
}

function toLocalMessage(m: SupabaseOptionMessage): ChatMessage {
  return {
    id: m.id,
    threadId: m.option_request_id,
    from: m.from_role as 'client' | 'agency',
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
   * loadOptionRequestsForClient / loadOptionRequestsForAgency / loadOptionsForModel
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
  }
): string {
  const threadId = `thread-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const requestType = extra?.requestType ?? 'option';
  const timeStr = extra?.startTime && extra?.endTime ? ` (${extra.startTime}–${extra.endTime})` : '';
  const label = requestType === 'casting' ? 'Casting' : 'Option';
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
    modelAccountLinked: true,
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
    const clientId = user?.id ?? 'user-client';

    let organizationId: string | null = null;
    if (user?.id) {
      try {
        const { ensureClientOrganization } = await import('../services/organizationsInvitationsSupabase');
        organizationId = await ensureClientOrganization();
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
        : model?.country ?? null;

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
      start_time: extra?.startTime,
      end_time: extra?.endTime,
      request_type: requestType,
      organization_id: organizationId,
      created_by: user?.id ?? null,
    });
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
      addOptionMessage(result.id, 'client', autoText);

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
          source: extra?.source,
          packageId: extra?.packageId,
        });
      }

      if (local.modelAccountLinked === false) {
        addOptionMessage(
          result.id,
          'agency',
          'No model app account on file — you can negotiate and confirm with the client without waiting for model approval. The booking will appear in client and agency calendars when confirmed.',
        );
      }
      notify();
    }
  })();

  return threadId;
}

export async function approveOptionAsModel(threadId: string): Promise<boolean> {
  const req = requestsCache.find((r) => r.threadId === threadId);
  if (!req) return false;
  req.modelApproval = 'approved';
  req.modelApprovedAt = new Date().toISOString();
  notify();
  const ok = await updateModelApproval(req.id, 'approved');
  if (ok) {
    const msg: ChatMessage = {
      id: `msg-${Date.now()}`,
      threadId,
      from: 'agency',
      text: '✓ Approved by Model',
      createdAt: Date.now(),
    };
    messagesCache.push(msg);
    addOptionMessage(req.id, 'agency', '✓ Approved by Model');
    notify();
  }
  return ok;
}

export async function rejectOptionAsModel(threadId: string): Promise<boolean> {
  const req = requestsCache.find((r) => r.threadId === threadId);
  if (!req) return false;
  req.modelApproval = 'rejected';
  notify();
  return updateModelApproval(req.id, 'rejected');
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

export async function loadOptionRequestsForClient(): Promise<void> {
  try {
    const remote = await fetchRequestsForCurrentClient();
    requestsCache = remote.map(toLocalRequest);
    notify();
  } catch {
    /* keep cache */
  }
}

export async function loadOptionRequestsForAgency(agencyId: string): Promise<void> {
  try {
    const remote = await fetchRequestsForAgency(agencyId);
    requestsCache = remote.map(toLocalRequest);
    notify();
  } catch { /* keep cache */ }
}

export function setRequestStatus(threadId: string, status: ChatStatus): void {
  const req = requestsCache.find((r) => r.threadId === threadId);
  if (!req) return;

  const prev = req.status;
  req.status = status;
  notify();

  void updateOptionRequestStatus(req.id, status).then((ok) => {
    if (!ok) {
      req.status = prev;
      notify();
      console.error('[setRequestStatus] Supabase rejected status update', req.id);
      return;
    }
    if (status !== 'confirmed') return;

    /** Manual “confirmed” must mirror option_requests into calendar_entries with option_request_id (client calendar join). */
    void (async () => {
      try {
        const full = await getOptionRequestById(req.id);
        if (!full) return;
        const entryType = full.request_type === 'casting' ? 'casting' : 'option';
        const title = `${entryType === 'casting' ? 'Casting' : 'Option'} – ${full.client_name ?? 'Client'}`;
        await upsertCalendarEntry(full.model_id, full.requested_date, 'booked', undefined, {
          start_time: full.start_time ?? undefined,
          end_time: full.end_time ?? undefined,
          title,
          entry_type: entryType,
          option_request_id: full.id,
          client_name: full.client_name ?? undefined,
          booking_details: {},
          created_by_agency: false,
        });
      } catch (e) {
        console.error('[setRequestStatus] calendar sync failed', e);
      }
    })();
  });
}

export function getRequestStatus(threadId: string): ChatStatus | undefined {
  return requestsCache.find((r) => r.threadId === threadId)?.status;
}

export function hasNewMessages(): boolean {
  return requestsCache.length > 0;
}

export function getMessages(threadId: string): ChatMessage[] {
  return messagesCache.filter((m) => m.threadId === threadId);
}

export function addMessage(threadId: string, from: 'client' | 'agency', text: string): void {
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
    addOptionMessage(req.id, from, text);
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

async function ensureOptionCalendarEntry(opt: SupabaseOptionRequest): Promise<void> {
  const entryType = opt.request_type === 'casting' ? 'casting' : 'option';
  const title = `${entryType === 'casting' ? 'Casting' : 'Option'} – ${opt.client_name ?? 'Client'}`;
  await upsertCalendarEntry(
    opt.model_id,
    opt.requested_date,
    'tentative',
    undefined,
    {
      start_time: opt.start_time ?? undefined,
      end_time: opt.end_time ?? undefined,
      title,
      entry_type: entryType,
      option_request_id: opt.id,
      client_name: opt.client_name ?? undefined,
      booking_details: {},
      created_by_agency: false,
    }
  );
}

/** Agency accepts client price → option_confirmed; create calendar entry and system message. */
export async function agencyAcceptClientPriceStore(threadId: string): Promise<boolean> {
  const req = requestsCache.find((r) => r.threadId === threadId);
  if (!req) return false;
  const ok = await agencyAcceptClientPrice(req.id);
  if (!ok) return false;
  const updated = await getOptionRequestById(req.id);
  if (updated) {
    Object.assign(req, toLocalRequest(updated));
    if (updated.final_status === 'option_confirmed') {
      await ensureOptionCalendarEntry(updated);
      await addOptionMessage(req.id, 'agency', 'Agency accepted client price.');
      const sys: ChatMessage = { id: `msg-${Date.now()}`, threadId, from: 'agency', text: 'Agency accepted client price.', createdAt: Date.now() };
      messagesCache.push(sys);
    }
    notify();
  }
  return true;
}

/** Agency sends counter offer; system message + local/web notification hook. */
export async function agencyCounterOfferStore(threadId: string, counterPrice: number, currency: string): Promise<boolean> {
  const req = requestsCache.find((r) => r.threadId === threadId);
  if (!req) return false;
  const ok = await setAgencyCounterOffer(req.id, counterPrice);
  if (!ok) return false;
  req.agencyCounterPrice = counterPrice;
  req.clientPriceStatus = 'pending';
  req.finalStatus = 'option_pending';
  const text = `Agency proposed ${counterPrice} ${currency}.`;
  await addOptionMessage(req.id, 'agency', text);
  messagesCache.push({ id: `msg-${Date.now()}`, threadId, from: 'agency', text, createdAt: Date.now() });
  const agency = req.agencyId ? await getAgencyById(req.agencyId) : null;
  notifyClientAgencyCounterOffer(agency?.name ?? 'Agency');
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
  const text = 'Agency declined the proposed fee. A counter-offer can be sent below.';
  await addOptionMessage(req.id, 'agency', text);
  messagesCache.push({ id: `msg-${Date.now()}`, threadId, from: 'agency', text, createdAt: Date.now() });
  notify();
  return true;
}

/** Client accepts agency counter → option_confirmed; create calendar entry and system message. */
export async function clientAcceptCounterStore(threadId: string): Promise<boolean> {
  const req = requestsCache.find((r) => r.threadId === threadId);
  if (!req) return false;
  const ok = await clientAcceptCounterPrice(req.id);
  if (!ok) return false;
  const updated = await getOptionRequestById(req.id);
  if (updated) {
    Object.assign(req, toLocalRequest(updated));
    if (updated.final_status === 'option_confirmed') {
      await ensureOptionCalendarEntry(updated);
      await addOptionMessage(req.id, 'client', 'Client accepted agency proposal.');
      const sys: ChatMessage = { id: `msg-${Date.now()}`, threadId, from: 'client', text: 'Client accepted agency proposal.', createdAt: Date.now() };
      messagesCache.push(sys);
    }
    notify();
  }
  return true;
}

/** Client confirms job → job_confirmed; update calendar to Job, system message. */
export async function clientConfirmJobStore(threadId: string): Promise<boolean> {
  const req = requestsCache.find((r) => r.threadId === threadId);
  if (!req) return false;
  const ok = await clientConfirmJobOnSupabase(req.id);
  if (!ok) return false;
  req.finalStatus = 'job_confirmed';
  req.status = 'confirmed';
  await updateCalendarEntryToJob(req.id);
  await addOptionMessage(req.id, 'client', 'Job confirmed by client.');
  messagesCache.push({ id: `msg-${Date.now()}`, threadId, from: 'client', text: 'Job confirmed by client.', createdAt: Date.now() });
  notify();
  return true;
}
