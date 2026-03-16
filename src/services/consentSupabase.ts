import { supabase } from '../../lib/supabase';

export type ConsentRecord = {
  id: string;
  user_id: string;
  consent_type: 'terms' | 'privacy';
  version: string;
  accepted_at: string;
  ip_address: string | null;
};

export async function recordConsent(
  userId: string,
  consentType: 'terms' | 'privacy',
  version: string,
  ipAddress?: string
): Promise<boolean> {
  const { error } = await supabase
    .from('consent_log')
    .insert({
      user_id: userId,
      consent_type: consentType,
      version,
      ip_address: ipAddress || null,
    });
  if (error) { console.error('recordConsent error:', error); return false; }
  return true;
}

export async function hasAcceptedVersion(
  userId: string,
  consentType: 'terms' | 'privacy',
  version: string
): Promise<boolean> {
  const { data } = await supabase
    .from('consent_log')
    .select('id')
    .eq('user_id', userId)
    .eq('consent_type', consentType)
    .eq('version', version)
    .limit(1)
    .maybeSingle();
  return !!data;
}

export async function getConsentHistory(userId: string): Promise<ConsentRecord[]> {
  const { data, error } = await supabase
    .from('consent_log')
    .select('*')
    .eq('user_id', userId)
    .order('accepted_at', { ascending: false });
  if (error) { console.error('getConsentHistory error:', error); return []; }
  return (data ?? []) as ConsentRecord[];
}

export async function deleteUserData(userId: string): Promise<boolean> {
  const { error } = await supabase.auth.admin.deleteUser(userId);
  if (error) {
    console.error('deleteUserData error:', error);
    const { error: profileError } = await supabase
      .from('profiles')
      .delete()
      .eq('id', userId);
    if (profileError) { console.error('deleteProfile error:', profileError); return false; }
  }
  return true;
}
