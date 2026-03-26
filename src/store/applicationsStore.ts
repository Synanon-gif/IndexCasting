/**
 * Store für Model-Bewerbungen (Recruiting).
 * Lädt aus Supabase, cached lokal im Speicher.
 * Pub/Sub-Interface bleibt für UI-Kompatibilität.
 */

import {
  getApplications as fetchApps,
  getApplicationsByStatus,
  insertApplication as insertApp,
  updateApplicationStatus,
  createModelFromApplication,
  type SupabaseApplication,
} from '../services/applicationsSupabase';
import { startRecruitingChat, addRecruitingMessage } from './recruitingChats';
import { updateThreadAgency, updateThreadChatType } from '../services/recruitingChatSupabase';

export type ApplicationStatus = 'pending' | 'accepted' | 'rejected';

export type Gender = 'female' | 'male' | 'diverse' | '';

export type ModelApplication = {
  id: string;
  /** Target agency for this application (for chat branding). */
  agencyId?: string | null;
  firstName: string;
  lastName: string;
  age: number;
  height: number;
  gender: Gender;
  hairColor: string;
  city: string;
  instagramLink: string;
  images: {
    closeUp?: string;
    fullBody?: string;
    profile?: string;
  };
  createdAt: number;
  status: ApplicationStatus;
  chatThreadId?: string;
  ethnicity?: string;
  countryCode?: string;
};

/** Normalize image keys from DB (camelCase or snake_case) so UI always has closeUp, fullBody, profile. */
function normalizeApplicationImages(imgs: unknown): ModelApplication['images'] {
  if (!imgs || typeof imgs !== 'object') return {};
  const o = imgs as Record<string, string | undefined>;
  return {
    closeUp: o.closeUp ?? o.close_up ?? '',
    fullBody: o.fullBody ?? o.full_body ?? '',
    profile: o.profile ?? '',
  };
}

function toLocal(a: SupabaseApplication): ModelApplication {
  return {
    id: a.id,
    agencyId: a.agency_id ?? undefined,
    firstName: a.first_name,
    lastName: a.last_name,
    age: a.age,
    height: a.height,
    gender: (a.gender as Gender) ?? '',
    hairColor: a.hair_color ?? '',
    city: a.city ?? '',
    instagramLink: a.instagram_link ?? '',
    images: normalizeApplicationImages(a.images),
    createdAt: new Date(a.created_at).getTime(),
    status: a.status,
    chatThreadId: a.recruiting_thread_id ?? undefined,
    ethnicity: a.ethnicity ?? undefined,
    countryCode: a.country_code ?? undefined,
  };
}

let cache: ModelApplication[] = [];
let hydrated = false;

const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((fn) => fn());
}

async function ensureHydrated() {
  if (hydrated) return;
  hydrated = true;
  const apps = await fetchApps();
  cache = apps.map(toLocal);
  notify();
}

export function subscribeApplications(fn: () => void): () => void {
  listeners.add(fn);
  ensureHydrated();
  return () => listeners.delete(fn);
}

export function getApplications(): ModelApplication[] {
  ensureHydrated();
  return [...cache];
}

export function getPendingApplications(): ModelApplication[] {
  return cache.filter((a) => a.status === 'pending');
}

/** Pending ohne gestarteten Recruiting-Chat – nur diese erscheinen in der Swipe-Queue. */
export function getPendingSwipeQueueApplications(): ModelApplication[] {
  return cache.filter((a) => a.status === 'pending' && !a.chatThreadId);
}

export async function addApplication(data: Omit<ModelApplication, 'id' | 'createdAt' | 'status'> & { applicantUserId: string }): Promise<ModelApplication | null> {
  const result = await insertApp({
    applicant_user_id: data.applicantUserId,
    first_name: data.firstName,
    last_name: data.lastName,
    age: data.age,
    height: data.height,
    gender: data.gender || undefined,
    hair_color: data.hairColor || undefined,
    city: data.city || undefined,
    country_code: data.countryCode || undefined,
    ethnicity: data.ethnicity || undefined,
    instagram_link: data.instagramLink || undefined,
    images: data.images as Record<string, string>,
  });
  if (!result) return null;
  const local = toLocal(result);
  cache.unshift(local);
  notify();
  return local;
}

export function getAcceptedApplications(): ModelApplication[] {
  return cache.filter((a) => a.status === 'accepted' && a.chatThreadId);
}

export function getApplicationById(id: string): ModelApplication | undefined {
  return cache.find((a) => a.id === id);
}

export type AcceptApplicationResult = {
  threadId: string;
  modelId: string | null;
};

export async function acceptApplication(
  applicationId: string,
  agencyId: string,
): Promise<AcceptApplicationResult | null> {
  const app = cache.find((a) => a.id === applicationId);
  if (!app || app.status !== 'pending') return null;
  const modelName = `${app.firstName} ${app.lastName}`.trim();
  let threadId = app.chatThreadId;
  if (!threadId || threadId.startsWith('recruiting-')) {
    const realId = await startRecruitingChat(applicationId, modelName, agencyId);
    if (realId) threadId = realId;
    else return null;
    addRecruitingMessage(
      threadId,
      'agency',
      'Welcome to our selection. We have received your application and would like to invite you to the next step.',
    );
  }
  const ok = await updateApplicationStatus(applicationId, 'accepted', {
    recruiting_thread_id: threadId,
    accepted_by_agency_id: agencyId,
  });
  if (!ok) return null;

  await updateThreadAgency(threadId, agencyId);

  // Mark chat as active_model so UI can display the correct label/state
  await updateThreadChatType(threadId, 'active_model');

  const modelId = await createModelFromApplication(applicationId);

  app.status = 'accepted';
  app.chatThreadId = threadId;
  notify();
  return { threadId, modelId };
}

export async function rejectApplication(applicationId: string): Promise<void> {
  const app = cache.find((a) => a.id === applicationId);
  if (!app || app.status !== 'pending') return;
  
  const ok = await updateApplicationStatus(applicationId, 'rejected');
  if (!ok) return;
  
  app.status = 'rejected';
  notify();
}

export async function refreshApplications(): Promise<void> {
  const apps = await fetchApps();
  cache = apps.map(toLocal);
  notify();
}

/** Clear all cached data and reset hydration state (call on sign-out). */
export function resetApplicationsStore(): void {
  cache = [];
  hydrated = false;
  notify();
}
