/**
 * Agency–Model booking chats (Recruiting).
 * Backed by Supabase (recruiting_chat_threads + recruiting_chat_messages).
 * Local cache for sync-like API, Supabase as source of truth.
 */

import {
  getThreads as fetchThreads,
  getThread as fetchThread,
  createThread as createThreadInDb,
  getMessages as fetchMessages,
  addMessage as addMessageInDb,
} from '../services/recruitingChatSupabase';
import { updateApplicationRecruitingThread } from '../services/applicationsSupabase';

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

  createThreadInDb(applicationId, modelName).then((realId) => {
    if (realId) {
      const t = threadsCache.find((t) => t.id === tempId);
      if (t) t.id = realId;
      notify();
    }
  });

  notify();
  return tempId;
}

/** Create thread in DB, link to application (for chat before accept), return thread id. */
export async function startRecruitingChat(applicationId: string, modelName: string): Promise<string | null> {
  const realId = await createThreadInDb(applicationId, modelName);
  if (!realId) return null;
  const ok = await updateApplicationRecruitingThread(applicationId, realId);
  if (!ok) return null;
  threadsCache.push({
    id: realId,
    applicationId,
    modelName,
    createdAt: Date.now(),
  });
  notify();
  return realId;
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
