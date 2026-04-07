import { supabase } from '../../lib/supabase';
import { validateFile, checkMagicBytes } from '../../lib/validation';
import { convertHeicToJpegWithStatus } from './imageUtils';

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
    const { file: prepared, conversionFailed } = await convertHeicToJpegWithStatus(file);
    if (conversionFailed) {
      console.error('submitVerification: HEIC/HEIF conversion failed');
      return null;
    }

    // MIME type and size validation — ID documents must be image or PDF only.
    const fileValidation = validateFile(prepared);
    if (!fileValidation.ok) {
      console.error('submitVerification: file validation failed', fileValidation.error);
      return null;
    }

    const magicCheck = await checkMagicBytes(prepared);
    if (!magicCheck.ok) {
      console.error('submitVerification: magic bytes check failed', magicCheck.error);
      return null;
    }

    // Sanitize fileName to prevent path traversal attacks (../,  slashes, null bytes).
    const nameSource = prepared instanceof File ? prepared.name : fileName;
    const sanitizedFileName = nameSource
      .replace(/[^a-zA-Z0-9._-]/g, '_')
      .replace(/\.{2,}/g, '_')
      .slice(0, 200);
    const path = `verifications/${userId}/${Date.now()}_${sanitizedFileName}`;

    const { error: uploadError } = await supabase.storage
      .from('documents')
      .upload(path, prepared, {
        contentType: prepared.type || 'application/octet-stream',
        upsert: false,
      });
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

/**
 * Returns pending verifications scoped to the calling user's agency.
 * Uses the SECURITY DEFINER RPC get_pending_verifications_for_my_agency()
 * so that RLS does not block agency members and cross-agency leakage is
 * impossible at the DB level. C-6 fix — Security Pentest 2026-04.
 */
export async function getPendingVerifications(): Promise<Verification[]> {
  try {
    const { data, error } = await supabase.rpc('get_pending_verifications_for_my_agency');
    if (error) { console.error('getPendingVerifications error:', error); return []; }
    return (data ?? []) as Verification[];
  } catch (e) {
    console.error('getPendingVerifications exception:', e);
    return [];
  }
}
