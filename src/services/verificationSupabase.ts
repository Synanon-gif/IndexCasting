import { supabase } from '../../lib/supabase';

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
  const { data, error } = await supabase
    .from('verifications')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) { console.error('getVerification error:', error); return null; }
  return data as Verification | null;
}

export async function submitVerification(
  userId: string,
  file: File | Blob,
  fileName: string
): Promise<Verification | null> {
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
}

export async function reviewVerification(
  verificationId: string,
  status: 'verified' | 'rejected',
  agencyId: string
): Promise<boolean> {
  const { error } = await supabase
    .from('verifications')
    .update({ status, verified_by_agency_id: agencyId })
    .eq('id', verificationId);
  if (error) { console.error('reviewVerification error:', error); return false; }
  return true;
}

export async function getPendingVerifications(): Promise<Verification[]> {
  const { data, error } = await supabase
    .from('verifications')
    .select('*')
    .eq('status', 'pending')
    .order('created_at', { ascending: true });
  if (error) { console.error('getPendingVerifications error:', error); return []; }
  return (data ?? []) as Verification[];
}
