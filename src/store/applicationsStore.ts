/**
 * Store für Model-Bewerbungen (Recruiting).
 * Lädt aus Supabase, cached lokal im Speicher.
 * Pub/Sub-Interface bleibt für UI-Kompatibilität.
 */

import {
  getApplications as fetchApps,
  insertApplication as insertApp,
  updateApplicationStatus,
  confirmApplicationByModel as confirmByModelService,
  rejectApplicationByModel as rejectByModelService,
  notifyAgencyOfModelConfirmation,
  type SupabaseApplication,
} from '../services/applicationsSupabase';
import { supabase } from '../../lib/supabase';
import { startRecruitingChat, addRecruitingMessage } from './recruitingChats';
import { updateThreadAgency, updateThreadChatType } from '../services/recruitingChatSupabase';
import { createNotification } from '../services/notificationsSupabase';
import { uiCopy } from '../constants/uiCopy';

export type ApplicationStatus =
  | 'pending'
  | 'pending_model_confirmation'
  | 'accepted'
  | 'rejected'
  /** Agency ended representation (MAT removed); not an active acceptance — model may re-apply. */
  | 'representation_ended';

export type Gender = 'female' | 'male' | 'diverse' | '';

export type ModelApplication = {
  id: string;
  /** Target agency for this application (for chat branding; may be null for global applications). */
  agencyId?: string | null;
  /**
   * The agency that accepted this application (set on agency accept).
   * May differ from agencyId when the model applied globally (agencyId = null)
   * and any agency accepted.
   */
  acceptedByAgencyId?: string | null;
  /** User ID of the applicant (for notifications). */
  applicantUserId?: string | null;
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
  /** Row `updated_at` from DB (ms); used for stale pending+no-MAT diagnostics. */
  updatedAt: number;
  status: ApplicationStatus;
  chatThreadId?: string;
  ethnicity?: string;
  countryCode?: string;
  /**
   * Resolved models.id for applicant_user_id (auth uid). Used for MAT defense-in-depth on accepted rows.
   */
  applicantModelId?: string | null;
  /**
   * True iff at least one MAT row exists for (applicantModelId, acceptedByAgencyId).
   * Set after hydration for `accepted` and `pending_model_confirmation` when `acceptedByAgencyId` + model id resolve.
   */
  matWithAcceptedAgency?: boolean;
};

/** Threshold for `[STALE_PENDING_MODEL_CONFIRMATION_NO_MAT]` (no automatic mutation). */
export const STALE_PENDING_MODEL_CONFIRMATION_NO_MAT_MS = 24 * 60 * 60 * 1000;

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
    acceptedByAgencyId: a.accepted_by_agency_id ?? undefined,
    applicantUserId: a.applicant_user_id ?? undefined,
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
    updatedAt: new Date(a.updated_at ?? a.created_at).getTime(),
    status: a.status,
    chatThreadId: a.recruiting_thread_id ?? undefined,
    ethnicity: a.ethnicity ?? undefined,
    countryCode: a.country_code ?? undefined,
  };
}

let cache: ModelApplication[] = [];
let hydrated = false;
let storeAgencyId: string | undefined;

const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((fn) => fn());
}

/**
 * Defense-in-depth: resolve models.id per applicant and whether MAT exists for (model, accepted agency).
 * Fail-closed for `accepted` in recruiting bucket if lookups fail (no MAT → hidden).
 */
async function attachApplicantModelIdsAndMatFlags(apps: ModelApplication[]): Promise<void> {
  const userIds = [...new Set(apps.map((a) => a.applicantUserId).filter(Boolean))] as string[];
  if (userIds.length === 0) {
    for (const a of apps) {
      a.applicantModelId = null;
      a.matWithAcceptedAgency = undefined;
    }
    return;
  }
  try {
    const { data: modelRows, error: mErr } = await supabase
      .from('models')
      .select('id,user_id')
      .in('user_id', userIds);
    if (mErr || !modelRows) {
      console.error('[applicationsStore] attachApplicantModelIdsAndMatFlags models error:', mErr);
      for (const a of apps) {
        a.applicantModelId = undefined;
        a.matWithAcceptedAgency = undefined;
      }
      return;
    }
    const uidToMid = new Map(modelRows.map((m) => [m.user_id as string, m.id as string]));
    const modelIds = [...new Set(modelRows.map((m) => m.id as string))];
    let matRows: { model_id: string; agency_id: string }[] = [];
    if (modelIds.length > 0) {
      const { data: mats, error: matErr } = await supabase
        .from('model_agency_territories')
        .select('model_id,agency_id')
        .in('model_id', modelIds);
      if (matErr) {
        console.error('[applicationsStore] attachApplicantModelIdsAndMatFlags mat error:', matErr);
      } else {
        matRows = (mats ?? []) as { model_id: string; agency_id: string }[];
      }
    }
    const matKey = new Set(matRows.map((r) => `${r.model_id}:${r.agency_id}`));
    for (const a of apps) {
      const mid = a.applicantUserId ? (uidToMid.get(a.applicantUserId) ?? null) : null;
      a.applicantModelId = mid;
      const needsMatFlag =
        (a.status === 'accepted' || a.status === 'pending_model_confirmation') &&
        Boolean(a.acceptedByAgencyId && mid);
      if (needsMatFlag) {
        a.matWithAcceptedAgency = matKey.has(`${mid}:${a.acceptedByAgencyId}`);
      } else {
        a.matWithAcceptedAgency = undefined;
      }
    }
  } catch (e) {
    console.error('[applicationsStore] attachApplicantModelIdsAndMatFlags exception:', e);
  }
}

async function ensureHydrated() {
  if (hydrated) return;
  // Guard: never fetch without an agency scope — RLS is the last line of defence,
  // not the only one. initApplicationsForAgency() must be called first.
  if (!storeAgencyId) {
    // Harmless in the model-side UI: the model surfaces (ModelApplicationsView)
    // bypass this agency-scoped store and fetch their own applications directly.
    // Downgrade to debug so it does not spam the console for normal model sessions.
    console.debug(
      '[applicationsStore] ensureHydrated called before agencyId was set — skipping fetch',
    );
    return;
  }
  hydrated = true;
  const apps = await fetchApps(storeAgencyId);
  cache = apps.map(toLocal);
  await attachApplicantModelIdsAndMatFlags(cache);
  notify();
}

/**
 * Scopes the store to a specific agency and triggers a fresh load.
 * Call this once from the agency view after the profile is available.
 */
export function initApplicationsForAgency(agencyId: string): void {
  if (!agencyId) return;
  if (storeAgencyId === agencyId && hydrated) return;
  storeAgencyId = agencyId;
  hydrated = false;
  void ensureHydrated();
}

export function subscribeApplications(fn: () => void): () => void {
  listeners.add(fn);
  void ensureHydrated();
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

export async function addApplication(
  data: Omit<ModelApplication, 'id' | 'createdAt' | 'updatedAt' | 'status'> & {
    applicantUserId: string;
  },
): Promise<ModelApplication | null> {
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
  await attachApplicantModelIdsAndMatFlags(cache);
  notify();
  return local;
}

/**
 * Recruiting "Accepted" bucket: pending_model_confirmation (MAT may not exist yet) or accepted with
 * live MAT for (model_id, accepted_by_agency_id). Defense-in-depth vs ghost accepted rows.
 */
export function applicationQualifiesForAgencyRecruitingAcceptedBucket(
  a: ModelApplication,
): boolean {
  if (!(a.status === 'accepted' || a.status === 'pending_model_confirmation') || !a.chatThreadId) {
    return false;
  }
  if (!a.acceptedByAgencyId) return false;
  if (a.status === 'pending_model_confirmation') return true;
  if (!a.applicantModelId) return false;
  return a.matWithAcceptedAgency === true;
}

/** Enthält accepted UND pending_model_confirmation (Vertretungsanfrage noch offen). */
export function getAcceptedApplications(): ModelApplication[] {
  const list = cache.filter(applicationQualifiesForAgencyRecruitingAcceptedBucket);
  const now = Date.now();
  for (const a of list) {
    if (
      a.status === 'pending_model_confirmation' &&
      a.matWithAcceptedAgency !== true &&
      now - a.updatedAt > STALE_PENDING_MODEL_CONFIRMATION_NO_MAT_MS
    ) {
      console.warn('[STALE_PENDING_MODEL_CONFIRMATION_NO_MAT]', { applicationId: a.id });
    }
  }
  return list;
}

export function getApplicationById(id: string): ModelApplication | undefined {
  return cache.find((a) => a.id === id);
}

export type AcceptApplicationResult = {
  threadId: string;
  /** Null bis das Model seine Bestätigung gibt. */
  modelId: null;
};

/**
 * Agency akzeptiert eine Bewerbung: setzt status → 'pending_model_confirmation'.
 * Das Model muss anschließend confirmApplicationByModel aufrufen, bevor
 * ein Model-Eintrag erstellt wird.
 *
 * territoryCodes: ISO-3166-1 alpha-2 Ländercodes, die die Agency beim Accept gewählt hat.
 * Sie werden als pending_territories auf dem Application-Record gespeichert und beim
 * Model-Confirm automatisch via DB-Trigger auf model_agency_territories übertragen.
 */
export async function acceptApplication(
  applicationId: string,
  agencyId: string,
  territoryCodes?: string[],
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
      'We would like to represent you. Please confirm or decline our request in your application.',
    );
  }
  const ok = await updateApplicationStatus(applicationId, 'pending_model_confirmation', {
    recruiting_thread_id: threadId,
    accepted_by_agency_id: agencyId,
    // Persist territory codes so they survive until the model confirms.
    // The DB trigger tr_transfer_pending_territories applies them on status → 'accepted'.
    // Pass the native JS array — Supabase serialises it to JSONB automatically.
    // Do NOT wrap with JSON.stringify(); the DB column has a CHECK constraint
    // enforcing jsonb_typeof = 'array'. A double-encoded string would fail the check.
    ...(territoryCodes && territoryCodes.length > 0 ? { pending_territories: territoryCodes } : {}),
  });
  if (!ok) return null;

  await updateThreadAgency(threadId, agencyId);

  app.status = 'pending_model_confirmation';
  app.chatThreadId = threadId;
  app.acceptedByAgencyId = agencyId;
  await attachApplicantModelIdsAndMatFlags(cache);
  notify();

  if (app.applicantUserId) {
    void createNotification({
      user_id: app.applicantUserId,
      type: 'application_accepted',
      title: uiCopy.notifications.applicationAccepted.title,
      message: uiCopy.notifications.applicationAccepted.message,
      metadata: { application_id: applicationId },
    });
  }

  return { threadId, modelId: null };
}

/**
 * Model bestätigt die Vertretungsanfrage.
 * Erst jetzt wird der Model-Eintrag angelegt.
 * Notifies the accepting agency org after successful confirmation.
 */
export async function confirmApplicationByModel(
  applicationId: string,
  applicantUserId: string,
): Promise<{ modelId: string | null } | null> {
  const app = cache.find((a) => a.id === applicationId);
  if (!app || app.status !== 'pending_model_confirmation') return null;

  // Capture accepted_by_agency_id before the service call mutates the DB row.
  // We need this to notify the agency org after confirmation succeeds.
  const acceptedByAgencyId =
    (app as ModelApplication & { acceptedByAgencyId?: string | null }).acceptedByAgencyId ?? null;

  const result = await confirmByModelService(applicationId, applicantUserId);
  if (!result) return null;

  // Mark recruiting chat as active_model (represents the finalised relationship)
  if (app.chatThreadId) {
    await updateThreadChatType(app.chatThreadId, 'active_model');
  }

  app.status = 'accepted';
  await attachApplicantModelIdsAndMatFlags(cache);
  notify();

  // Notify the accepting agency that the model confirmed representation
  if (acceptedByAgencyId) {
    void notifyAgencyOfModelConfirmation(acceptedByAgencyId, applicationId);
  }

  return result;
}

/**
 * Model lehnt die Vertretungsanfrage ab.
 */
export async function rejectApplicationByModel(
  applicationId: string,
  applicantUserId: string,
): Promise<boolean> {
  const app = cache.find((a) => a.id === applicationId);
  if (!app || app.status !== 'pending_model_confirmation') return false;

  const ok = await rejectByModelService(applicationId, applicantUserId);
  if (!ok) return false;

  app.status = 'rejected';
  notify();
  return true;
}

export async function rejectApplication(applicationId: string): Promise<void> {
  const app = cache.find((a) => a.id === applicationId);
  if (!app || app.status !== 'pending') return;

  const ok = await updateApplicationStatus(applicationId, 'rejected');
  if (!ok) return;

  app.status = 'rejected';
  notify();

  if (app.applicantUserId) {
    void createNotification({
      user_id: app.applicantUserId,
      type: 'application_rejected',
      title: uiCopy.notifications.applicationRejected.title,
      message: uiCopy.notifications.applicationRejected.message,
      metadata: { application_id: applicationId },
    });
  }
}

/**
 * Reloads the applications cache from Supabase.
 * For agency views: uses the current storeAgencyId scope (set by initApplicationsForAgency).
 * For model views (no storeAgencyId): relies on RLS (applicant_user_id = auth.uid()).
 */
export async function refreshApplications(): Promise<void> {
  const apps = await fetchApps(storeAgencyId);
  cache = apps.map(toLocal);
  await attachApplicantModelIdsAndMatFlags(cache);
  notify();
}

/** Clear all cached data and reset hydration state (call on sign-out). */
export function resetApplicationsStore(): void {
  cache = [];
  hydrated = false;
  notify();
}
