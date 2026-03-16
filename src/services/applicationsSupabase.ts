import { supabase } from '../../lib/supabase';

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

/** Bewerbungen des eingeloggten Models (für "My Applications"). */
export async function getApplicationsForApplicant(applicantUserId: string): Promise<SupabaseApplication[]> {
  const { data, error } = await supabase
    .from('model_applications')
    .select('*')
    .eq('applicant_user_id', applicantUserId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('getApplicationsForApplicant error:', error);
    return [];
  }
  return (data ?? []) as SupabaseApplication[];
}

export async function insertApplication(app: {
  applicant_user_id: string;
  first_name: string;
  last_name: string;
  age: number;
  height: number;
  gender?: string;
  hair_color?: string;
  city?: string;
  instagram_link?: string;
  images?: Record<string, string>;
  agency_id?: string;
}): Promise<SupabaseApplication | null> {
  const { data, error } = await supabase
    .from('model_applications')
    .insert({
      applicant_user_id: app.applicant_user_id,
      first_name: app.first_name,
      last_name: app.last_name,
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
}

export async function updateApplicationStatus(
  id: string,
  status: 'accepted' | 'rejected',
  extra?: { recruiting_thread_id?: string; accepted_by_agency_id?: string }
): Promise<boolean> {
  const { error } = await supabase
    .from('model_applications')
    .update({ status, ...extra })
    .eq('id', id);

  if (error) {
    console.error('updateApplicationStatus error:', error);
    return false;
  }
  return true;
}

/** Set recruiting thread on a pending application (so agency can chat before accepting). */
export async function updateApplicationRecruitingThread(
  applicationId: string,
  recruitingThreadId: string
): Promise<boolean> {
  const { error } = await supabase
    .from('model_applications')
    .update({ recruiting_thread_id: recruitingThreadId })
    .eq('id', applicationId)
    .eq('status', 'pending');

  if (error) {
    console.error('updateApplicationRecruitingThread error:', error);
    return false;
  }
  return true;
}

/** Nach Accept: Model-Eintrag anlegen und Bewerber der Agentur zuordnen. */
export async function createModelFromApplication(applicationId: string): Promise<string | null> {
  const { data: app, error: fetchErr } = await supabase
    .from('model_applications')
    .select('*')
    .eq('id', applicationId)
    .single();

  if (fetchErr || !app || app.status !== 'accepted' || !app.accepted_by_agency_id) {
    if (fetchErr) console.error('createModelFromApplication fetch error:', fetchErr);
    return null;
  }

  const name = `${(app as any).first_name || ''} ${(app as any).last_name || ''}`.trim() || 'Model';
  const imgs = app.images && typeof app.images === 'object' ? [app.images.profile, app.images.fullBody, app.images.closeUp].filter(Boolean) as string[] : [];
  const { data: model, error: insertErr } = await supabase
    .from('models')
    .insert({
      agency_id: app.accepted_by_agency_id,
      user_id: app.applicant_user_id || null,
      name,
      height: app.height || 0,
      bust: null,
      waist: null,
      hips: null,
      city: app.city || null,
      hair_color: app.hair_color || null,
      eye_color: null,
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
  return (model as { id: string })?.id ?? null;
}
