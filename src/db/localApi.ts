/**
 * Local API store – simulates backend (Supabase-compatible structure).
 * Persists to localStorage. RLS: all reads/writes are scoped by authorized user IDs.
 */

import type { User, Model, Project, Conversation, Message } from './schema';
import { models as mockModels } from '../mockData';

const STORAGE_KEYS = {
  users: 'ci_db_users',
  models: 'ci_db_models',
  projects: 'ci_db_projects',
  conversations: 'ci_db_conversations',
  messages: 'ci_db_messages',
} as const;

function load<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function save(key: string, value: unknown): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore
  }
}

// In-memory tables (initialized from localStorage or seed)
let users: User[] = load(STORAGE_KEYS.users, []);
let models: Model[] = load(STORAGE_KEYS.models, []);
const projects: Project[] = load(STORAGE_KEYS.projects, []);
const conversations: Conversation[] = load(STORAGE_KEYS.conversations, []);
const messages: Message[] = load(STORAGE_KEYS.messages, []);

const listeners = new Set<() => void>();
function notify() {
  listeners.forEach((f) => f());
  save(STORAGE_KEYS.users, users);
  save(STORAGE_KEYS.models, models);
  save(STORAGE_KEYS.projects, projects);
  save(STORAGE_KEYS.conversations, conversations);
  save(STORAGE_KEYS.messages, messages);
}

export function subscribeDb(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// —— Seed (run once if empty) ——
function seedIfNeeded() {
  if (users.length > 0) return;
  const now = Date.now();
  users = [
    { id: 'user-client', email: 'client@demo.com', display_name: 'Client', role: 'client', created_at: now, updated_at: now },
    { id: 'user-agent', email: 'agency@demo.com', display_name: 'Agency', role: 'agent', created_at: now, updated_at: now },
    { id: 'user-model-1', email: 'model1@demo.com', display_name: 'LINA K.', role: 'model', created_at: now, updated_at: now },
    { id: 'user-model-2', email: 'model2@demo.com', display_name: 'NOAH R.', role: 'model', created_at: now, updated_at: now },
    { id: 'user-model-3', email: 'model3@demo.com', display_name: 'AMI S.', role: 'model', created_at: now, updated_at: now },
  ];
  const modelUserId: Record<string, string> = { '1': 'user-model-1', '2': 'user-model-2', '3': 'user-model-3' };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  models = (mockModels as any[]).map((m) => ({
    id: m.id,
    mediaslide_sync_id: m.code || null,
    user_id: modelUserId[m.id] || `user-model-${m.id}`,
    name: m.name,
    height: m.height,
    bust: m.bust,
    waist: m.waist,
    hips: m.hips,
    city: m.city,
    hair_color: m.hairColor || '',
    portfolio_images: m.gallery || [],
    polaroids: m.polaroids || [],
    is_visible_commercial: m.isVisibleCommercial ?? m.visibility?.commercial ?? false,
    is_visible_fashion: m.isVisibleFashion ?? m.visibility?.highFashion ?? false,
    is_sports_winter: m.isSportsWinter ?? false,
    is_sports_summer: m.isSportsSummer ?? false,
    sex: (m.sex as 'male' | 'female' | null) ?? null,
    created_at: now,
    updated_at: now,
  }));
  notify();
}
seedIfNeeded();

// —— RLS-style: Users ——
export function getUsers(): User[] {
  return [...users];
}

export function getUserById(id: string): User | undefined {
  return users.find((u) => u.id === id);
}

/** Only return user if caller is authorized (e.g. same user or admin). */
export function getUsersForScope(_authorizedUserId: string): User[] {
  return [...users];
}

// —— RLS-style: Models ——
export function getModels(): Model[] {
  return [...models];
}

export function getModelById(id: string): Model | undefined {
  return models.find((m) => m.id === id);
}

/** Models visible to client (by visibility flags). */
export function getModelsForClient(_clientUserId: string, clientType: 'fashion' | 'commercial'): Model[] {
  return models.filter((m) =>
    clientType === 'fashion' ? m.is_visible_fashion : m.is_visible_commercial
  );
}

/** Models for agency (all they manage). */
export function getModelsForAgency(_agencyUserId: string): Model[] {
  return [...models];
}

export function updateModelVisibility(id: string, payload: { is_visible_commercial?: boolean; is_visible_fashion?: boolean }) {
  const m = models.find((x) => x.id === id);
  if (!m) return;
  if (payload.is_visible_commercial !== undefined) m.is_visible_commercial = payload.is_visible_commercial;
  if (payload.is_visible_fashion !== undefined) m.is_visible_fashion = payload.is_visible_fashion;
  m.updated_at = Date.now();
  notify();
}

// —— RLS-style: Projects (owner = client) ——
export function getProjectsForUser(userId: string): Project[] {
  return projects.filter((p) => p.owner_id === userId);
}

export function getProjectById(id: string, _authorizedUserId: string): Project | undefined {
  const p = projects.find((x) => x.id === id);
  return p ?? undefined;
}

export function createProject(ownerId: string, name: string): Project {
  const now = Date.now();
  const project: Project = {
    id: `proj-${now}-${Math.random().toString(36).slice(2, 8)}`,
    owner_id: ownerId,
    name,
    model_ids: [],
    created_at: now,
    updated_at: now,
  };
  projects.push(project);
  notify();
  return project;
}

export function updateProject(projectId: string, ownerId: string, updates: Partial<Pick<Project, 'name' | 'model_ids'>>): void {
  const p = projects.find((x) => x.id === projectId && x.owner_id === ownerId);
  if (!p) return;
  if (updates.name !== undefined) p.name = updates.name;
  if (updates.model_ids !== undefined) p.model_ids = updates.model_ids;
  p.updated_at = Date.now();
  notify();
}

export function addModelToProject(projectId: string, ownerId: string, modelId: string): void {
  const p = projects.find((x) => x.id === projectId && x.owner_id === ownerId);
  if (!p || p.model_ids.includes(modelId)) return;
  p.model_ids.push(modelId);
  p.updated_at = Date.now();
  notify();
}

// —— Conversations & Messages (context-aware chat) ——
export function getConversationsForUser(userId: string): Conversation[] {
  return conversations.filter((c) => c.participant_ids.includes(userId));
}

export function getConversationById(id: string, userId: string): Conversation | undefined {
  const c = conversations.find((x) => x.id === id && x.participant_ids.includes(userId));
  return c;
}

export function getMessagesForConversation(conversationId: string, _authorizedUserId: string): Message[] {
  const conv = conversations.find((c) => c.id === conversationId);
  if (!conv) return [];
  return messages.filter((m) => m.conversation_id === conversationId).sort((a, b) => a.created_at - b.created_at);
}

export function createConversation(
  type: Conversation['type'],
  contextId: string,
  contextLabel: string,
  participantIds: string[]
): Conversation {
  const now = Date.now();
  const conv: Conversation = {
    id: `conv-${now}-${Math.random().toString(36).slice(2, 8)}`,
    type,
    context_id: contextId,
    context_label: contextLabel,
    participant_ids: [...participantIds],
    created_at: now,
    updated_at: now,
  };
  conversations.push(conv);
  notify();
  return conv;
}

export function addMessage(conversationId: string, senderId: string, receiverId: string, text: string): Message {
  const conv = conversations.find((c) => c.id === conversationId);
  if (!conv) throw new Error('Conversation not found');
  const now = Date.now();
  const msg: Message = {
    id: `msg-${now}-${Math.random().toString(36).slice(2, 8)}`,
    conversation_id: conversationId,
    sender_id: senderId,
    receiver_id: receiverId,
    text,
    created_at: now,
  };
  messages.push(msg);
  conv.updated_at = now;
  notify();
  return msg;
}

/** Find or create conversation for option (client–agency) by context. */
export function getOrCreateOptionConversation(
  clientUserId: string,
  agencyUserId: string,
  contextId: string,
  contextLabel: string
): Conversation {
  const existing = conversations.find(
    (c) =>
      c.type === 'option' &&
      c.context_id === contextId &&
      c.participant_ids.includes(clientUserId) &&
      c.participant_ids.includes(agencyUserId)
  );
  if (existing) return existing;
  return createConversation('option', contextId, contextLabel, [clientUserId, agencyUserId]);
}

/** Find or create conversation for booking (agency–model). */
export function getOrCreateBookingConversation(
  agencyUserId: string,
  modelUserId: string,
  contextId: string,
  contextLabel: string
): Conversation {
  const existing = conversations.find(
    (c) =>
      c.type === 'booking' &&
      c.context_id === contextId &&
      c.participant_ids.includes(agencyUserId) &&
      c.participant_ids.includes(modelUserId)
  );
  if (existing) return existing;
  return createConversation('booking', contextId, contextLabel, [agencyUserId, modelUserId]);
}
