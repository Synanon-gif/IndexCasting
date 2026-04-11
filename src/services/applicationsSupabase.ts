import { supabase } from '../../lib/supabase';
import { splitProfileDisplayName } from '../utils/applicantNameFromProfile';
import { validateFile, checkMagicBytes, checkExtensionConsistency } from '../../lib/validation';
import { convertHeicToJpegWithStatus } from './imageUtils';
import { toStorageUri, resolveStorageUrl } from '../storage/storageUrl';
import {
  hasRecentImageRightsForSessionKey,
  IMAGE_RIGHTS_WINDOW_MINUTES,
} from './gdprComplianceSupabase';
import { createNotification } from './notificationsSupabase';
import { uiCopy } from '../constants/uiCopy';

/**
 * Model-Bewerbungen (Apply) – in Supabase gespeichert.
 * model_applications (inkl. images = Storage-URIs); Bewerbungsfotos in Storage
 * (documentspictures/model-applications/…) im privaten Bucket.
 *
 * M-3 fix: uploadApplicationImage now stores the canonical supabase-storage://
 * URI (not a public URL) matching the pattern used by model_photos. Callers
 * must use resolveApplicationImageUrl() to display images.
 */
const APPLICATION_IMAGES_BUCKET = 'documentspictures';
const APPLICATION_IMAGES_PREFIX = 'model-applications';

/** Session key used to scope application-upload image rights confirmations. */
export const APPLICATION_UPLOAD_SESSION_KEY = 'application-upload';

/**
 * Upload one application image to Storage.
 * Returns a canonical supabase-storage:// URI for persistent DB storage,
 * or null on failure. Use resolveApplicationImageUrl() to get a signed URL
 * for display.
 *
 * Requires a signed-in user. Enforces a recent image-rights confirmation for
 * {@link APPLICATION_UPLOAD_SESSION_KEY} within {@link IMAGE_RIGHTS_WINDOW_MINUTES}
 * (call {@link confirmImageRights} with that session key before upload).
 */
export async function uploadApplicationImage(
  file: Blob | File,
  slot: string,
): Promise<string | null> {
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData.user) {
    console.error('uploadApplicationImage: not authenticated', userErr);
    return null;
  }
  const userId = userData.user.id;
  const hasConsent = await hasRecentImageRightsForSessionKey(
    userId,
    APPLICATION_UPLOAD_SESSION_KEY,
    IMAGE_RIGHTS_WINDOW_MINUTES,
  );
  if (!hasConsent) {
    console.error('uploadApplicationImage: image rights not confirmed for user', userId);
    return null;
  }

  {
    const { file: prepared, conversionFailed } = await convertHeicToJpegWithStatus(file);
    if (conversionFailed) {
      console.error('uploadApplicationImage: HEIC/HEIF conversion failed');
      return null;
    }
    file = prepared;
  }

  const mimeValidation = validateFile(file);
  if (!mimeValidation.ok) {
    console.error('uploadApplicationImage: file validation failed', mimeValidation.error);
    return null;
  }

  const magicCheck = await checkMagicBytes(file);
  if (!magicCheck.ok) {
    console.error('uploadApplicationImage: magic bytes check failed', magicCheck.error);
    return null;
  }

  if (file instanceof File) {
    const extCheck = checkExtensionConsistency(file);
    if (!extCheck.ok) {
      console.error('uploadApplicationImage: extension/MIME mismatch', extCheck.error);
      return null;
    }
  }

  const ext = file instanceof File ? (file.name.split('.').pop() || 'jpg') : 'jpg';
  const path = `${APPLICATION_IMAGES_PREFIX}/${Date.now()}-${slot}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await supabase.storage.from(APPLICATION_IMAGES_BUCKET).upload(path, file, {
    contentType: file.type || 'image/jpeg',
    upsert: false,
  });
  if (error) {
    console.error('uploadApplicationImage error:', error);
    return null;
  }
  return toStorageUri(APPLICATION_IMAGES_BUCKET, path);
}

/**
 * Resolves a stored application image URI or legacy URL to a short-lived
 * signed URL suitable for display. Backward-compatible: handles both the new
 * supabase-storage:// URI format and legacy full public URLs.
 */
export async function resolveApplicationImageUrl(uriOrUrl: string): Promise<string | null> {
  return resolveStorageUrl(uriOrUrl);
}

/** Von PostgREST: Embed über FK agency_id (nicht accepted_by_agency_id). */
export type SupabaseApplicationAgencyEmbed = { name: string } | null;

export type ApplicationStatus = 'pending' | 'pending_model_confirmation' | 'accepted' | 'rejected';

export type SupabaseApplication = {
  id: string;
  applicant_user_id: string | null;
  agency_id: string | null;
  first_name: string;
  last_name: string;
  age: number;
  height: number;
  gender: 'female' | 'male' | 'diverse' | null;
  hair_color: string | null;
  city: string | null;
  instagram_link: string | null;
  images: Record<string, string>;
  status: ApplicationStatus;
  recruiting_thread_id: string | null;
  accepted_by_agency_id: string | null;
  created_at: string;
  updated_at: string;
  ethnicity?: string | null;
  country_code?: string | null;
  /** Nur bei getApplicationsForApplicant; Key = PostgREST-Name für FK agency_id → agencies. */
  agencies?: SupabaseApplicationAgencyEmbed;
};

export type ApplicationListOptions = {
  /** Max rows per page. Defaults to 100. */
  limit?: number;
  /**
   * Cursor: ISO timestamp of the oldest loaded item.
   * Pass to load earlier items ("Load more").
   */
  afterCreatedAt?: string;
};

export async function getApplications(
  agencyId?: string,
  opts?: ApplicationListOptions,
): Promise<SupabaseApplication[]> {
  if (agencyId !== undefined && !agencyId) {
    console.error('[getApplications] agencyId provided but empty — call aborted');
    return [];
  }
  if (agencyId === undefined) {
    // RLS-only path: no explicit org filter. Defense-in-Depth missing.
    // Callers SHOULD always pass agencyId — see rls-security-patterns.mdc Risiko 6.
    console.warn('[getApplications] called without agencyId — relying on RLS only (no defense-in-depth org filter)');
  }
  try {
    let q = supabase
      .from('model_applications')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(opts?.limit ?? 100);
    if (agencyId) q = q.eq('agency_id', agencyId);
    if (opts?.afterCreatedAt) q = q.lt('created_at', opts.afterCreatedAt);
    const { data, error } = await q;
    if (error) { console.error('getApplications error:', error); return []; }
    return (data ?? []) as SupabaseApplication[];
  } catch (e) {
    console.error('getApplications exception:', e);
    return [];
  }
}

/** Single application row (RLS: agency or applicant). */
export async function fetchApplicationById(applicationId: string): Promise<SupabaseApplication | null> {
  try {
    const { data, error } = await supabase
      .from('model_applications')
      .select('*')
      .eq('id', applicationId)
      .maybeSingle();
    if (error) {
      console.error('fetchApplicationById error:', error);
      return null;
    }
    return (data ?? null) as SupabaseApplication | null;
  } catch (e) {
    console.error('fetchApplicationById exception:', e);
    return null;
  }
}

export async function getApplicationsByStatus(
  status: string,
  agencyId?: string,
  opts?: ApplicationListOptions,
): Promise<SupabaseApplication[]> {
  if (agencyId !== undefined && !agencyId) {
    console.error('[getApplicationsByStatus] agencyId provided but empty — call aborted');
    return [];
  }
  if (agencyId === undefined) {
    console.warn('[getApplicationsByStatus] called without agencyId — relying on RLS only (no defense-in-depth org filter)');
  }
  try {
    let q = supabase
      .from('model_applications')
      .select('*')
      .eq('status', status)
      .order('created_at', { ascending: false })
      .limit(opts?.limit ?? 100);
    if (agencyId) q = q.eq('agency_id', agencyId);
    if (opts?.afterCreatedAt) q = q.lt('created_at', opts.afterCreatedAt);
    const { data, error } = await q;
    if (error) { console.error('getApplicationsByStatus error:', error); return []; }
    return (data ?? []) as SupabaseApplication[];
  } catch (e) {
    console.error('getApplicationsByStatus exception:', e);
    return [];
  }
}

/** Bewerbungen des eingeloggten Models (für "My Applications"). Agency-Name nur als Embed (ein Feld). */
export async function getApplicationsForApplicant(applicantUserId: string): Promise<SupabaseApplication[]> {
  try {
    const { data, error } = await supabase
      .from('model_applications')
      .select('*, agencies!agency_id ( name )')
      .eq('applicant_user_id', applicantUserId)
      .order('created_at', { ascending: false })
      .limit(200);

    if (error) {
      console.error('getApplicationsForApplicant error:', error);
      return [];
    }
    return (data ?? []) as SupabaseApplication[];
  } catch (e) {
    console.error('getApplicationsForApplicant exception:', e);
    return [];
  }
}

export async function insertApplication(app: {
  applicant_user_id: string;
  /** Wird ignoriert – Namen kommen immer aus profiles.display_name (identisch zum Account). */
  first_name?: string;
  last_name?: string;
  age: number;
  height: number;
  gender?: string;
  hair_color?: string;
  city?: string;
  country_code?: string;
  ethnicity?: string;
  instagram_link?: string;
  images?: Record<string, string>;
  agency_id?: string;
}): Promise<SupabaseApplication | null> {
  try {
    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userData.user || userData.user.id !== app.applicant_user_id) {
      console.error('insertApplication: applicant must match signed-in user', userErr);
      return null;
    }

    const { data: prof, error: pErr } = await supabase
      .from('profiles')
      .select('display_name')
      .eq('id', app.applicant_user_id)
      .maybeSingle();

    if (pErr) {
      console.error('insertApplication profile load error:', pErr);
      return null;
    }

    const { firstName: fn, lastName: ln } = splitProfileDisplayName(
      (prof as { display_name?: string | null } | null)?.display_name
    );
    if (!fn.trim()) {
      console.error('insertApplication: profile display_name empty');
      return null;
    }

    const first_name = fn.trim();
    const last_name = ln.trim();

    const { data, error } = await supabase
      .from('model_applications')
      .insert({
        applicant_user_id: app.applicant_user_id,
        first_name,
        last_name,
        age: app.age,
        height: app.height,
        gender: app.gender || null,
        hair_color: app.hair_color || null,
        city: app.city || null,
        country_code: app.country_code || null,
        ethnicity: app.ethnicity || null,
        instagram_link: app.instagram_link || null,
        images: app.images || {},
        agency_id: app.agency_id || null,
        status: 'pending',
      })
      .select()
      .single();

    if (error) {
      console.error('insertApplication error:', error);
      return null;
    }

    const inserted = data as SupabaseApplication;

    if (inserted.agency_id) {
      void (async () => {
        try {
          const { data: org } = await supabase
            .from('organizations')
            .select('id')
            .eq('agency_id', inserted.agency_id!)
            .eq('type', 'agency')
            .maybeSingle();
          if (org?.id) {
            void createNotification({
              organization_id: org.id,
              type: 'application_received',
              title: uiCopy.notifications.applicationReceived.title,
              message: uiCopy.notifications.applicationReceived.message,
              metadata: { application_id: inserted.id },
            });
          }
        } catch (notifErr) {
          console.error('insertApplication: notification failed', notifErr);
        }
      })();
    }

    return inserted;
  } catch (e) {
    console.error('insertApplication exception:', e);
    return null;
  }
}

/**
 * Updates application status with an enforced prior-state guard.
 *
 * Allowed transitions and their required prior status:
 *   pending_model_confirmation  ← must currently be 'pending'
 *   rejected                    ← must currently be 'pending'
 *   accepted                    ← must currently be 'pending_model_confirmation'
 *                                 (model confirmation path — use confirmApplicationByModel instead)
 *
 * The prior-state filter makes the UPDATE atomic: if two simultaneous calls
 * race (e.g. double-tap accept), only the first wins; the second gets no-row-
 * updated and returns false without corrupting state.
 */
export async function updateApplicationStatus(
  id: string,
  status: ApplicationStatus,
  extra?: { recruiting_thread_id?: string; accepted_by_agency_id?: string }
): Promise<boolean> {
  const priorStatusMap: Record<ApplicationStatus, ApplicationStatus> = {
    pending_model_confirmation: 'pending',
    rejected: 'pending',
    accepted: 'pending_model_confirmation',
    pending: 'pending', // self-loop guard (should not be called in practice)
  };

  const requiredPrior = priorStatusMap[status];

  try {
    const { data, error } = await supabase
      .from('model_applications')
      .update({ status, ...extra })
      .eq('id', id)
      .eq('status', requiredPrior)
      .select('id')
      .maybeSingle();

    if (error) {
      console.error('updateApplicationStatus error:', error);
      return false;
    }
    if (!data?.id) {
      console.warn(
        'updateApplicationStatus: no row updated — wrong prior status or concurrent update',
        { id, targetStatus: status, requiredPrior },
      );
      return false;
    }
    return true;
  } catch (e) {
    console.error('updateApplicationStatus exception:', e);
    return false;
  }
}

/** Set recruiting thread on a pending application (so agency can chat before accepting). */
export async function updateApplicationRecruitingThread(
  applicationId: string,
  recruitingThreadId: string
): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from('model_applications')
      .update({ recruiting_thread_id: recruitingThreadId })
      .eq('id', applicationId)
      .eq('status', 'pending')
      .select('id')
      .maybeSingle();

    if (error) {
      console.error('updateApplicationRecruitingThread error:', error);
      return false;
    }
    if (!data?.id) {
      console.error('updateApplicationRecruitingThread: no row updated (not pending or wrong id)', applicationId);
      return false;
    }
    return true;
  } catch (e) {
    console.error('updateApplicationRecruitingThread exception:', e);
    return false;
  }
}

/** Bewerbung löschen (nur für Applicant, nur pending/rejected). RLS muss DELETE für eigene Zeilen erlauben. */
export async function deleteApplication(applicationId: string, applicantUserId: string): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('model_applications')
      .delete()
      .eq('id', applicationId)
      .eq('applicant_user_id', applicantUserId)
      .in('status', ['pending', 'rejected']);

    if (error) {
      console.error('deleteApplication error:', error);
      return false;
    }
    return true;
  } catch (e) {
    console.error('deleteApplication exception:', e);
    return false;
  }
}

/** Stammdaten des Bewerbers auf allen offenen Bewerbungen aktualisieren. */
export async function updateApplicationsProfileForApplicant(
  applicantUserId: string,
  payload: {
    first_name?: string;
    last_name?: string;
    height?: number;
    city?: string | null;
    hair_color?: string | null;
    country_code?: string | null;
    ethnicity?: string | null;
    instagram_link?: string | null;
  },
): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('model_applications')
      .update(payload)
      .eq('applicant_user_id', applicantUserId)
      .in('status', ['pending', 'rejected']);

    if (error) {
      console.error('updateApplicationsProfileForApplicant error:', error);
      return false;
    }
    return true;
  } catch (e) {
    console.error('updateApplicationsProfileForApplicant exception:', e);
    return false;
  }
}

/**
 * Model bestätigt die Vertretungsanfrage der Agentur.
 * Setzt status → 'accepted' und legt den Model-Eintrag an.
 * Darf nur vom Applicant selbst aufgerufen werden (RLS enforced).
 */
export async function confirmApplicationByModel(
  applicationId: string,
  applicantUserId: string,
): Promise<{ modelId: string | null } | null> {
  try {
    const { data, error } = await supabase
      .from('model_applications')
      .update({ status: 'accepted' })
      .eq('id', applicationId)
      .eq('applicant_user_id', applicantUserId)
      .eq('status', 'pending_model_confirmation')
      .select('id')
      .maybeSingle();

    if (error) {
      console.error('confirmApplicationByModel update error:', error);
      return null;
    }
    if (!data?.id) {
      console.warn('confirmApplicationByModel: no row updated (wrong id / status / RLS)', applicationId);
      return null;
    }

    const modelId = await createModelFromApplication(applicationId);
    return { modelId };
  } catch (e) {
    console.error('confirmApplicationByModel exception:', e);
    return null;
  }
}

/**
 * Model lehnt die Vertretungsanfrage der Agentur ab.
 * Setzt status → 'rejected'.
 * Darf nur vom Applicant selbst aufgerufen werden (RLS enforced).
 */
export async function rejectApplicationByModel(
  applicationId: string,
  applicantUserId: string,
): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from('model_applications')
      .update({ status: 'rejected' })
      .eq('id', applicationId)
      .eq('applicant_user_id', applicantUserId)
      .eq('status', 'pending_model_confirmation')
      .select('id')
      .maybeSingle();

    if (error) {
      console.error('rejectApplicationByModel error:', error);
      return false;
    }
    if (!data?.id) {
      console.warn('rejectApplicationByModel: no row updated (wrong id / status / RLS)', applicationId);
      return false;
    }
    return true;
  } catch (e) {
    console.error('rejectApplicationByModel exception:', e);
    return false;
  }
}

/**
 * Nach Accept: Model-Eintrag anlegen und Bewerber der Agentur zuordnen.
 *
 * Delegiert an die SECURITY DEFINER RPC `create_model_from_accepted_application`,
 * damit der Aufrufer (Bewerber oder Agentur-Mitglied) keine direkte INSERT-Berechtigung
 * auf `models` braucht (RLS verlangt Agentur-Mitgliedschaft, die ein Bewerber nicht hat).
 */
export async function createModelFromApplication(applicationId: string): Promise<string | null> {
  try {
    const { data, error } = await supabase.rpc('create_model_from_accepted_application', {
      p_application_id: applicationId,
    });

    if (error) {
      console.error('createModelFromApplication RPC error:', error);
      return null;
    }

    return (data as string | null) ?? null;
  } catch (e) {
    console.error('createModelFromApplication exception:', e);
    return null;
  }
}
