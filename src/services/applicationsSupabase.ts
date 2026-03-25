import { supabase } from '../../lib/supabase';
import { splitProfileDisplayName } from '../utils/applicantNameFromProfile';

/**
 * Model-Bewerbungen (Apply) – in Supabase gespeichert.
 * model_applications (inkl. images = URLs); Bewerbungsfotos in Storage (documentspictures/model-applications/…).
 * Public bucket so image URLs work; "documents" stays private.
 */
const PUBLIC_IMAGES_BUCKET = 'documentspictures';
const APPLICATION_IMAGES_PREFIX = 'model-applications';

/** Upload one application image (blob or file) to Storage; returns public URL or null. */
export async function uploadApplicationImage(file: Blob | File, slot: string): Promise<string | null> {
  const ext = file instanceof File ? (file.name.split('.').pop() || 'jpg') : 'jpg';
  const path = `${APPLICATION_IMAGES_PREFIX}/${Date.now()}-${slot}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await supabase.storage.from(PUBLIC_IMAGES_BUCKET).upload(path, file, {
    contentType: file.type || 'image/jpeg',
    upsert: false,
  });
  if (error) {
    console.error('uploadApplicationImage error:', error);
    return null;
  }
  const { data } = supabase.storage.from(PUBLIC_IMAGES_BUCKET).getPublicUrl(path);
  return data?.publicUrl ?? null;
}

/** Von PostgREST: Embed über FK agency_id (nicht accepted_by_agency_id). */
export type SupabaseApplicationAgencyEmbed = { name: string } | null;

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
  status: 'pending' | 'accepted' | 'rejected';
  recruiting_thread_id: string | null;
  accepted_by_agency_id: string | null;
  created_at: string;
  updated_at: string;
  /** Nur bei getApplicationsForApplicant; Key = PostgREST-Name für FK agency_id → agencies. */
  agencies?: SupabaseApplicationAgencyEmbed;
};

export async function getApplications(): Promise<SupabaseApplication[]> {
  const { data, error } = await supabase
    .from('model_applications')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('getApplications error:', error);
    return [];
  }
  return (data ?? []) as SupabaseApplication[];
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

export async function getApplicationsByStatus(status: string): Promise<SupabaseApplication[]> {
  const { data, error } = await supabase
    .from('model_applications')
    .select('*')
    .eq('status', status)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('getApplicationsByStatus error:', error);
    return [];
  }
  return (data ?? []) as SupabaseApplication[];
}

/** Bewerbungen des eingeloggten Models (für "My Applications"). Agency-Name nur als Embed (ein Feld). */
export async function getApplicationsForApplicant(applicantUserId: string): Promise<SupabaseApplication[]> {
  try {
    const { data, error } = await supabase
      .from('model_applications')
      .select('*, agencies!agency_id ( name )')
      .eq('applicant_user_id', applicantUserId)
      .order('created_at', { ascending: false });

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
    return data as SupabaseApplication;
  } catch (e) {
    console.error('insertApplication exception:', e);
    return null;
  }
}

export async function updateApplicationStatus(
  id: string,
  status: 'accepted' | 'rejected',
  extra?: { recruiting_thread_id?: string; accepted_by_agency_id?: string }
): Promise<boolean> {
  const { data, error } = await supabase
    .from('model_applications')
    .update({ status, ...extra })
    .eq('id', id)
    .select('id')
    .maybeSingle();

  if (error) {
    console.error('updateApplicationStatus error:', error);
    return false;
  }
  if (!data?.id) {
    console.warn('updateApplicationStatus: no row updated (check id / RLS)', id);
    return false;
  }
  return true;
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
    instagram_link?: string | null;
  },
): Promise<boolean> {
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
}

/** Nach Accept: Model-Eintrag anlegen und Bewerber der Agentur zuordnen. */
export async function createModelFromApplication(applicationId: string): Promise<string | null> {
  try {
    const { data: app, error: fetchErr } = await supabase
      .from('model_applications')
      .select('*')
      .eq('id', applicationId)
      .single();

    if (fetchErr || !app || app.status !== 'accepted' || !app.accepted_by_agency_id) {
      if (fetchErr) console.error('createModelFromApplication fetch error:', fetchErr);
      return null;
    }

    // Guard: if the applicant already has a linked model row, return the existing model id.
    if (app.applicant_user_id) {
      const { data: existing } = await supabase
        .from('models')
        .select('id')
        .eq('user_id', app.applicant_user_id)
        .maybeSingle();
      if (existing?.id) {
        console.warn('createModelFromApplication: model already exists for user_id', app.applicant_user_id);
        return (existing as { id: string }).id;
      }
    }

    const name = `${(app as any).first_name || ''} ${(app as any).last_name || ''}`.trim() || 'Model';
    const imgs = app.images && typeof app.images === 'object'
      ? ([app.images.profile, app.images.fullBody, app.images.closeUp].filter(Boolean) as string[])
      : [];

    const { data: model, error: insertErr } = await supabase
      .from('models')
      .insert({
        agency_id: app.accepted_by_agency_id,
        user_id: app.applicant_user_id || null,
        agency_relationship_status: 'active',
        agency_relationship_ended_at: null,
        name,
        height: app.height || 0,
        bust: null,
        waist: null,
        hips: null,
        city: app.city || null,
        hair_color: app.hair_color || null,
        eye_color: null,
        // Map application gender ('female' | 'male' | 'diverse') → model sex ('female' | 'male').
        sex: (app.gender === 'female' || app.gender === 'male') ? app.gender : null,
        portfolio_images: imgs,
        polaroids: [],
        is_visible_commercial: false,
        is_visible_fashion: true,
      })
      .select('id')
      .single();

    if (insertErr) {
      console.error('createModelFromApplication insert error:', insertErr);
      return null;
    }

    const modelId = (model as { id: string }).id;

    if (imgs.length > 0 && modelId) {
      const rows = imgs.map((url, i) => ({
        model_id: modelId,
        url,
        sort_order: i,
        visible: true,
        is_visible_to_clients: true,
        photo_type: 'portfolio' as const,
        source: 'application',
        api_external_id: null as string | null,
      }));
      const { error: phErr } = await supabase.from('model_photos').insert(rows);
      if (phErr) {
        console.error('createModelFromApplication model_photos error:', phErr);
      }
    }

    return modelId ?? null;
  } catch (e) {
    console.error('createModelFromApplication exception:', e);
    return null;
  }
}
