/**
 * Agency–Model booking chats (Recruiting).
 * Backed by Supabase (recruiting_chat_threads + recruiting_chat_messages).
 * Local cache for sync-like API, Supabase as source of truth.
 */

import {
  getThreads as fetchThreads,
  getThread as fetchThread,
  getThreadsForAgency as fetchThreadsForAgency,
  createThread as createThreadInDb,
  getMessages as fetchMessages,
  addMessage as addMessageInDb,
  findLatestThreadIdForApplication,
  updateThreadAgency,
  agencyStartRecruitingChatRpc,
  formatRecruitingChatRpcErrorDe,
} from '../services/recruitingChatSupabase';
import { updateApplicationRecruitingThread, fetchApplicationById } from '../services/applicationsSupabase';
import { supabase } from '../../lib/supabase';
import {
  getOrganizationIdForAgency,
  ensureAgencyOrganization,
} from '../services/organizationsInvitationsSupabase';

export type RecruitingMessage = {
  id: string;
  threadId: string;
  from: 'agency' | 'model';
  text: string;
  createdAt: number;
};

export type RecruitingThread = {
  id: string;
  applicationId: string;
  modelName: string;
  createdAt: number;
};

let threadsCache: RecruitingThread[] = [];
let messagesCache: RecruitingMessage[] = [];
let hydrated = false;

const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((fn) => fn());
}

async function ensureHydrated() {
  if (hydrated) return;
  hydrated = true;
  const threads = await fetchThreads();
  threadsCache = threads.map((t) => ({
    id: t.id,
    applicationId: t.application_id,
    modelName: t.model_name,
    createdAt: new Date(t.created_at).getTime(),
  }));
  notify();
}

export function subscribeRecruitingChats(fn: () => void): () => void {
  listeners.add(fn);
  ensureHydrated();
  return () => listeners.delete(fn);
}

export function getRecruitingThreads(): RecruitingThread[] {
  ensureHydrated();
  return [...threadsCache];
}

export function getRecruitingThread(threadId: string): RecruitingThread | undefined {
  return threadsCache.find((t) => t.id === threadId);
}

export function createRecruitingThread(applicationId: string, modelName: string): string {
  const tempId = `recruiting-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  threadsCache.push({
    id: tempId,
    applicationId,
    modelName,
    createdAt: Date.now(),
  });

  createThreadInDb(applicationId, modelName, null, undefined).then((realId) => {
    if (realId) {
      const t = threadsCache.find((t) => t.id === tempId);
      if (t) t.id = realId;
      notify();
    }
  });

  notify();
  return tempId;
}

export type TryStartRecruitingChatResult =
  | { ok: true; threadId: string }
  | { ok: false; messageDe: string };

/** Wie startRecruitingChat, mit deutscher Fehlermeldung für die UI. */
export async function tryStartRecruitingChat(
  applicationId: string,
  modelName: string,
  agencyId?: string | null
): Promise<TryStartRecruitingChatResult> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.id) {
    console.error('tryStartRecruitingChat: no authenticated user');
    return { ok: false, messageDe: 'Bitte anmelden, um den Chat zu starten.' };
  }

  let displayName = modelName.trim();
  if (!displayName) {
    const r = await fetchApplicationById(applicationId);
    displayName = (r ? `${r.first_name} ${r.last_name}`.trim() : '') || 'Model';
  }

  if (agencyId) {
    const rpc = await agencyStartRecruitingChatRpc(applicationId, agencyId, displayName);
    if (rpc.status === 'ok') {
      const tid = rpc.threadId;
      if (!threadsCache.some((t) => t.id === tid)) {
        threadsCache.push({
          id: tid,
          applicationId,
          modelName: displayName,
          createdAt: Date.now(),
        });
        notify();
      }
      return { ok: true, threadId: tid };
    }
    if (rpc.status === 'error') {
      console.error('tryStartRecruitingChat: agency_start_recruiting_chat failed', rpc.error);
      return { ok: false, messageDe: formatRecruitingChatRpcErrorDe(rpc.error) };
    }
  }

  const row = await fetchApplicationById(applicationId);
  if (!row || row.status !== 'pending') {
    console.error('tryStartRecruitingChat: application missing or not pending', applicationId, row?.status);
    if (!row) {
      return {
        ok: false,
        messageDe:
          'Bewerbung nicht gefunden oder keine Leseberechtigung. Passt die Bewerbung zu dieser Agentur?',
      };
    }
    return {
      ok: false,
      messageDe: 'Recruiting-Chat nur möglich, solange die Bewerbung noch offen (pending) ist.',
    };
  }

  const displayNameFromRow = `${row.first_name} ${row.last_name}`.trim() || displayName;

  if (row.recruiting_thread_id) {
    const tid = row.recruiting_thread_id;
    if (agencyId) await updateThreadAgency(tid, agencyId);
    if (!threadsCache.some((t) => t.id === tid)) {
      threadsCache.push({
        id: tid,
        applicationId,
        modelName: displayNameFromRow,
        createdAt: Date.now(),
      });
      notify();
    }
    return { ok: true, threadId: tid };
  }

  const orphanId = await findLatestThreadIdForApplication(applicationId);
  if (orphanId) {
    const linked = await updateApplicationRecruitingThread(applicationId, orphanId);
    if (linked) {
      if (agencyId) await updateThreadAgency(orphanId, agencyId);
      if (!threadsCache.some((t) => t.id === orphanId)) {
        threadsCache.push({
          id: orphanId,
          applicationId,
          modelName: displayNameFromRow,
          createdAt: Date.now(),
        });
        notify();
      }
      return { ok: true, threadId: orphanId };
    }
    console.error('tryStartRecruitingChat: could not link orphan thread to application', applicationId, orphanId);
  }

  if (agencyId) {
    await ensureAgencyOrganization(agencyId);
  }

  let organizationId: string | null = null;
  if (agencyId) {
    organizationId = await getOrganizationIdForAgency(agencyId);
  }

  const realId = await createThreadInDb(applicationId, displayNameFromRow, agencyId ?? undefined, {
    organizationId,
    createdBy: user.id,
  });
  if (!realId) {
    console.error('tryStartRecruitingChat: createThreadInDb failed', applicationId);
    return {
      ok: false,
      messageDe: 'Recruiting-Thread konnte nicht angelegt werden (Rechte oder Verbindung).',
    };
  }
  const ok = await updateApplicationRecruitingThread(applicationId, realId);
  if (!ok) {
    console.error(
      'tryStartRecruitingChat: updateApplicationRecruitingThread failed after insert',
      applicationId,
      realId
    );
    return {
      ok: false,
      messageDe: 'Chat wurde angelegt, die Bewerbung konnte aber nicht verknüpft werden.',
    };
  }
  threadsCache.push({
    id: realId,
    applicationId,
    modelName: displayNameFromRow,
    createdAt: Date.now(),
  });
  notify();
  return { ok: true, threadId: realId };
}

/** Create thread in DB, link to application (for chat before accept), return thread id. */
export async function startRecruitingChat(
  applicationId: string,
  modelName: string,
  agencyId?: string | null
): Promise<string | null> {
  const r = await tryStartRecruitingChat(applicationId, modelName, agencyId);
  return r.ok ? r.threadId : null;
}

/** Threads für eine Agentur (Booking Chats) – aus Supabase. */
export async function getRecruitingThreadsForAgency(
  agencyId: string,
  options?: { createdByUserId?: string | null }
): Promise<RecruitingThread[]> {
  const threads = await fetchThreadsForAgency(agencyId, options);
  return threads.map((t) => ({
    id: t.id,
    applicationId: t.application_id,
    modelName: t.model_name,
    createdAt: new Date(t.created_at).getTime(),
  }));
}

export function getRecruitingMessages(threadId: string): RecruitingMessage[] {
  return messagesCache.filter((m) => m.threadId === threadId).sort((a, b) => a.createdAt - b.createdAt);
}

export async function loadMessagesForThread(threadId: string): Promise<RecruitingMessage[]> {
  const msgs = await fetchMessages(threadId);
  const mapped = msgs.map((m) => ({
    id: m.id,
    threadId: m.thread_id,
    from: m.from_role as 'agency' | 'model',
    text: m.text,
    createdAt: new Date(m.created_at).getTime(),
  }));
  messagesCache = messagesCache.filter((m) => m.threadId !== threadId);
  messagesCache.push(...mapped);
  notify();
  return mapped;
}

export function addRecruitingMessage(threadId: string, from: 'agency' | 'model', text: string): void {
  const tempMsg: RecruitingMessage = {
    id: `rec-msg-${Date.now()}`,
    threadId,
    from,
    text,
    createdAt: Date.now(),
  };
  messagesCache.push(tempMsg);
  notify();

  addMessageInDb(threadId, from, text).then((result) => {
    if (result) {
      const idx = messagesCache.findIndex((m) => m.id === tempMsg.id);
      if (idx >= 0) {
        messagesCache[idx] = {
          id: result.id,
          threadId: result.thread_id,
          from: result.from_role as 'agency' | 'model',
          text: result.text,
          createdAt: new Date(result.created_at).getTime(),
        };
        notify();
      }
    }
  });
}

const STORAGE_MODEL_THREAD_IDS = 'ci_model_booking_thread_ids';

function loadModelThreadIds(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_MODEL_THREAD_IDS);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveModelThreadIds(ids: string[]) {
  if (typeof window !== 'undefined') {
    try { window.localStorage.setItem(STORAGE_MODEL_THREAD_IDS, JSON.stringify(ids)); }
    catch { /* ignore */ }
  }
}

export function getModelBookingThreadIds(): string[] {
  return [...loadModelThreadIds()];
}

export function addModelBookingThreadId(threadId: string): void {
  const ids = loadModelThreadIds();
  if (ids.includes(threadId)) return;
  ids.unshift(threadId);
  saveModelThreadIds(ids);
}
