import { supabase } from '../../lib/supabase';
import { validateFile } from '../../lib/validation';

/**
 * Verifizierungen (Model) – in Supabase: verifications (user_id) + Storage (documents).
 * Alle Daten pro Partei (Model) gespeichert.
 */

export type Verification = {
  id: string;
  user_id: string;
  id_document_path: string;
  status: 'pending' | 'verified' | 'rejected';
  verified_by_agency_id: string | null;
  created_at: string;
  updated_at: string;
};

export async function getVerification(userId: string): Promise<Verification | null> {
  try {
    const { data, error } = await supabase
      .from('verifications')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) { console.error('getVerification error:', error); return null; }
    return data as Verification | null;
  } catch (e) {
    console.error('getVerification exception:', e);
    return null;
  }
}

export async function submitVerification(
  userId: string,
  file: File | Blob,
  fileName: string
): Promise<Verification | null> {
  try {
    // MIME type and size validation — ID documents must be image or PDF only.
    const fileValidation = validateFile(file);
    if (!fileValidation.ok) {
      console.error('submitVerification: file validation failed', fileValidation.error);
      return null;
    }

    const path = `verifications/${userId}/${Date.now()}_${fileName}`;

    const { error: uploadError } = await supabase.storage
      .from('documents')
      .upload(path, file, { upsert: false });
    if (uploadError) { console.error('submitVerification upload error:', uploadError); return null; }

    const { data, error } = await supabase
      .from('verifications')
      .insert({
        user_id: userId,
        id_document_path: path,
        status: 'pending',
      })
      .select()
      .single();
    if (error) { console.error('submitVerification db error:', error); return null; }
    return data as Verification;
  } catch (e) {
    console.error('submitVerification exception:', e);
    return null;
  }
}

export async function reviewVerification(
  verificationId: string,
  status: 'verified' | 'rejected',
  agencyId: string
): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('verifications')
      .update({ status, verified_by_agency_id: agencyId })
      .eq('id', verificationId);
    if (error) { console.error('reviewVerification error:', error); return false; }
    return true;
  } catch (e) {
    console.error('reviewVerification exception:', e);
    return false;
  }
}

export async function getPendingVerifications(): Promise<Verification[]> {
  try {
    const { data, error } = await supabase
      .from('verifications')
      .select('*')
      .eq('status', 'pending')
      .order('created_at', { ascending: true });
    if (error) { console.error('getPendingVerifications error:', error); return []; }
    return (data ?? []) as Verification[];
  } catch (e) {
    console.error('getPendingVerifications exception:', e);
    return [];
  }
}
