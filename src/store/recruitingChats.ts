/**
 * Agency–Model booking chats (Recruiting).
 * Backed by Supabase (recruiting_chat_threads + recruiting_chat_messages).
 * Local cache for sync-like API, Supabase as source of truth.
 */

import {
  getThreads as fetchThreads,
  getThreadsForAgency as fetchThreadsForAgency,
  createThread as createThreadInDb,
  getMessages as fetchMessages,
  addMessage as addMessageInDb,
  uploadRecruitingChatFile,
  findLatestThreadIdForApplication,
  updateThreadAgency,
  agencyStartRecruitingChatRpc,
  formatRecruitingChatRpcError,
} from '../services/recruitingChatSupabase';
import {
  updateApplicationRecruitingThread,
  fetchApplicationById,
} from '../services/applicationsSupabase';
import { supabase } from '../../lib/supabase';
import { guardUploadSession } from '../services/gdprComplianceSupabase';
import {
  getOrganizationIdForAgency,
  ensureAgencyOrganization,
} from '../services/organizationsInvitationsSupabase';

export type RecruitingMessage = {
  id: string;
  threadId: string;
  from: 'agency' | 'model';
  text: string;
  fileUrl: string | null;
  fileType: string | null;
  createdAt: number;
};

export type RecruitingThread = {
  id: string;
  applicationId: string;
  modelName: string;
  createdAt: number;
  /** 'recruiting' = before acceptance; 'active_model' = after acceptance. */
  chatType: 'recruiting' | 'active_model' | null;
};

let threadsCache: RecruitingThread[] = [];
let messagesCache: RecruitingMessage[] = [];
let hydrated = false;
let storeAgencyId: string | undefined;

const MAX_CACHED_REC_THREADS = 50;
const recentRecThreadAccess: string[] = [];

function trackRecThreadAccess(threadId: string): void {
  const idx = recentRecThreadAccess.indexOf(threadId);
  if (idx >= 0) recentRecThreadAccess.splice(idx, 1);
  recentRecThreadAccess.push(threadId);
}

function trimRecMessagesCache(): void {
  if (recentRecThreadAccess.length <= MAX_CACHED_REC_THREADS) return;
  const evict = recentRecThreadAccess.splice(
    0,
    recentRecThreadAccess.length - MAX_CACHED_REC_THREADS,
  );
  const evictSet = new Set(evict);
  messagesCache = messagesCache.filter((m) => !evictSet.has(m.threadId));
}

const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((fn) => fn());
}

async function ensureHydrated() {
  if (hydrated) return;
  hydrated = true;
  const threads = storeAgencyId ? await fetchThreadsForAgency(storeAgencyId) : await fetchThreads();
  threadsCache = threads.map((t) => ({
    id: t.id,
    applicationId: t.application_id,
    modelName: t.model_name,
    createdAt: new Date(t.created_at).getTime(),
    chatType: (t.chat_type as 'recruiting' | 'active_model' | null) ?? null,
  }));
  notify();
}

/**
 * Scopes the store to a specific agency and triggers a fresh load.
 * Call this once from the agency view after the profile is available.
 */
export function initRecruitingChatsForAgency(agencyId: string): void {
  if (!agencyId) return;
  if (storeAgencyId === agencyId && hydrated) return;
  storeAgencyId = agencyId;
  hydrated = false;
  void ensureHydrated();
}

export function subscribeRecruitingChats(fn: () => void): () => void {
  listeners.add(fn);
  void ensureHydrated();
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
    chatType: 'recruiting',
  });

  createThreadInDb(applicationId, modelName, null, undefined).then((realId) => {
    if (realId) {
      const t = threadsCache.find((t) => t.id === tempId);
      if (t) t.id = realId;
      notify();
    } else {
      // Service returned null (DB error / permissions). Inverse-operation rollback:
      // remove the optimistically-added temp entry so the UI stays consistent.
      threadsCache = threadsCache.filter((t) => t.id !== tempId);
      console.error(
        'createRecruitingThread: createThreadInDb returned null — rolled back temp entry',
        tempId,
      );
      notify();
    }
  });

  notify();
  return tempId;
}

export type TryStartRecruitingChatResult =
  | { ok: true; threadId: string }
  | { ok: false; message: string };

/** Same as startRecruitingChat, with English error messages for the UI. */
export async function tryStartRecruitingChat(
  applicationId: string,
  modelName: string,
  agencyId?: string | null,
): Promise<TryStartRecruitingChatResult> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.id) {
    console.error('tryStartRecruitingChat: no authenticated user');
    return { ok: false, message: 'Please sign in to start the chat.' };
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
          chatType: 'recruiting',
        });
        notify();
      }
      return { ok: true, threadId: tid };
    }
    if (rpc.status === 'error') {
      console.error('tryStartRecruitingChat: agency_start_recruiting_chat failed', rpc.error);
      return { ok: false, message: formatRecruitingChatRpcError(rpc.error) };
    }
  }

  const row = await fetchApplicationById(applicationId);
  if (!row || row.status !== 'pending') {
    console.error(
      'tryStartRecruitingChat: application missing or not pending',
      applicationId,
      row?.status,
    );
    if (!row) {
      return {
        ok: false,
        message:
          'Application not found or no read access. Does this application belong to your agency?',
      };
    }
    return {
      ok: false,
      message: 'Recruiting chat is only available while the application is pending.',
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
        chatType: 'recruiting',
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
          chatType: 'recruiting',
        });
        notify();
      }
      return { ok: true, threadId: orphanId };
    }
    console.error(
      'tryStartRecruitingChat: could not link orphan thread to application',
      applicationId,
      orphanId,
    );
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
      message: 'Could not create recruiting thread (permissions or connection).',
    };
  }
  const ok = await updateApplicationRecruitingThread(applicationId, realId);
  if (!ok) {
    console.error(
      'tryStartRecruitingChat: updateApplicationRecruitingThread failed after insert',
      applicationId,
      realId,
    );
    return {
      ok: false,
      message: 'Chat was created but could not be linked to the application.',
    };
  }
  threadsCache.push({
    id: realId,
    applicationId,
    modelName: displayNameFromRow,
    createdAt: Date.now(),
    chatType: 'recruiting',
  });
  notify();
  return { ok: true, threadId: realId };
}

/** Create thread in DB, link to application (for chat before accept), return thread id. */
export async function startRecruitingChat(
  applicationId: string,
  modelName: string,
  agencyId?: string | null,
): Promise<string | null> {
  const r = await tryStartRecruitingChat(applicationId, modelName, agencyId);
  return r.ok ? r.threadId : null;
}

/** Threads für eine Agentur (Booking Chats) – aus Supabase. */
export async function getRecruitingThreadsForAgency(
  agencyId: string,
  options?: { createdByUserId?: string | null },
): Promise<RecruitingThread[]> {
  const threads = await fetchThreadsForAgency(agencyId, options);
  return threads.map((t) => ({
    id: t.id,
    applicationId: t.application_id,
    modelName: t.model_name,
    createdAt: new Date(t.created_at).getTime(),
    chatType: (t.chat_type as 'recruiting' | 'active_model' | null) ?? null,
  }));
}

export function getRecruitingMessages(threadId: string): RecruitingMessage[] {
  trackRecThreadAccess(threadId);
  return messagesCache
    .filter((m) => m.threadId === threadId)
    .sort((a, b) => a.createdAt - b.createdAt);
}

export async function loadMessagesForThread(threadId: string): Promise<RecruitingMessage[]> {
  const msgs = await fetchMessages(threadId);
  const mapped = msgs.map((m) => ({
    id: m.id,
    threadId: m.thread_id,
    from: m.from_role as 'agency' | 'model',
    text: m.text,
    fileUrl: m.file_url ?? null,
    fileType: m.file_type ?? null,
    createdAt: new Date(m.created_at).getTime(),
  }));
  messagesCache = messagesCache.filter((m) => m.threadId !== threadId);
  messagesCache.push(...mapped);
  trackRecThreadAccess(threadId);
  trimRecMessagesCache();
  notify();
  return mapped;
}

export function addRecruitingMessage(
  threadId: string,
  from: 'agency' | 'model',
  text: string,
  fileUrl?: string | null,
  fileType?: string | null,
): void {
  const tempMsg: RecruitingMessage = {
    id: `rec-msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    threadId,
    from,
    text,
    fileUrl: fileUrl ?? null,
    fileType: fileType ?? null,
    createdAt: Date.now(),
  };
  messagesCache.push(tempMsg);
  notify();

  addMessageInDb(threadId, from, text, fileUrl, fileType).then((result) => {
    if (result) {
      const idx = messagesCache.findIndex((m) => m.id === tempMsg.id);
      if (idx >= 0) {
        messagesCache[idx] = {
          id: result.id,
          threadId: result.thread_id,
          from: result.from_role as 'agency' | 'model',
          text: result.text,
          fileUrl: result.file_url ?? null,
          fileType: result.file_type ?? null,
          createdAt: new Date(result.created_at).getTime(),
        };
        notify();
      }
    } else {
      // Service returned null (DB error / permissions). Inverse-operation rollback:
      // remove the optimistically-added temp message so the UI stays consistent.
      messagesCache = messagesCache.filter((m) => m.id !== tempMsg.id);
      console.error(
        'addRecruitingMessage: addMessageInDb returned null — rolled back temp message',
        tempMsg.id,
      );
      notify();
    }
  });
}

export type RecruitingFileUploadResult =
  | { ok: true }
  | { ok: false; reason: 'not_authenticated' | 'image_rights_not_confirmed' | 'upload_failed' };

/**
 * Upload a file for a recruiting chat thread and add a message with the attachment.
 * Call {@link confirmImageRights} with the same `recruiting-chat:${threadId}` session key before this;
 * this function still enforces {@link guardUploadSession} (client-side DB check before upload).
 */
export async function addRecruitingMessageWithFile(
  threadId: string,
  from: 'agency' | 'model',
  file: File | Blob,
  fileName: string,
  caption?: string,
): Promise<RecruitingFileUploadResult> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) {
    console.warn('addRecruitingMessageWithFile: not authenticated');
    return { ok: false, reason: 'not_authenticated' };
  }
  const sessionKey = `recruiting-chat:${threadId}`;
  const guard = await guardUploadSession(auth.user.id, sessionKey);
  if (!guard.ok) {
    console.warn(
      'addRecruitingMessageWithFile: image rights confirmation required before upload',
      sessionKey,
    );
    return { ok: false, reason: 'image_rights_not_confirmed' };
  }

  const path = await uploadRecruitingChatFile(threadId, file, fileName);
  if (!path) return { ok: false, reason: 'upload_failed' };
  const isHeic =
    /\.(heic|heif)$/i.test(fileName) || /^image\/heic/i.test((file as File).type ?? '');
  const mimeType = isHeic ? 'image/jpeg' : (file as File).type || 'application/octet-stream';
  addRecruitingMessage(threadId, from, caption ?? '', path, mimeType);
  return { ok: true };
}

const STORAGE_MODEL_THREAD_IDS = 'ci_model_booking_thread_ids';

function loadModelThreadIds(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_MODEL_THREAD_IDS);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveModelThreadIds(ids: string[]) {
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(STORAGE_MODEL_THREAD_IDS, JSON.stringify(ids));
    } catch {
      /* ignore */
    }
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

/** Clear all cached data and reset hydration state (call on sign-out). */
export function resetRecruitingChatsStore(): void {
  threadsCache = [];
  messagesCache = [];
  hydrated = false;
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.removeItem(STORAGE_MODEL_THREAD_IDS);
    } catch {
      /* ignore */
    }
  }
  notify();
}
