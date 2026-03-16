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
import { createRecruitingThread, addRecruitingMessage } from './recruitingChats';

export type ApplicationStatus = 'pending' | 'accepted' | 'rejected';

export type Gender = 'female' | 'male' | 'diverse' | '';

export type ModelApplication = {
  id: string;
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
};

function toLocal(a: SupabaseApplication): ModelApplication {
  return {
    id: a.id,
    firstName: a.first_name,
    lastName: a.last_name,
    age: a.age,
    height: a.height,
    gender: (a.gender as Gender) ?? '',
    hairColor: a.hair_color ?? '',
    city: a.city ?? '',
    instagramLink: a.instagram_link ?? '',
    images: (a.images as any) ?? {},
    createdAt: new Date(a.created_at).getTime(),
    status: a.status,
    chatThreadId: a.recruiting_thread_id ?? undefined,
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

export async function acceptApplication(applicationId: string, agencyId: string): Promise<string | null> {
  const app = cache.find((a) => a.id === applicationId);
  if (!app || app.status !== 'pending') return null;
  const modelName = `${app.firstName} ${app.lastName}`.trim();
  const threadId = createRecruitingThread(applicationId, modelName);
  addRecruitingMessage(threadId, 'agency', 'Welcome to our selection. We have received your application and would like to invite you to the next step.');

  const ok = await updateApplicationStatus(applicationId, 'accepted', {
    recruiting_thread_id: threadId,
    accepted_by_agency_id: agencyId,
  });
  if (!ok) return null;

  await createModelFromApplication(applicationId);

  app.status = 'accepted';
  app.chatThreadId = threadId;
  notify();
  return threadId;
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
