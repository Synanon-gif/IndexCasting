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

/**
 * Permanently deletes a user account via the server-side Edge Function.
 * The service_role key is NOT used here — deletion happens inside the
 * `delete-user` Edge Function which is the only place the service key lives.
 *
 * For the DSGVO soft-delete flow (user requests deletion, 30-day grace period)
 * prefer updating profiles.deletion_requested_at instead of calling this directly.
 */
export async function deleteUserData(userId: string): Promise<boolean> {
  try {
    const { data, error } = await supabase.functions.invoke('delete-user', {
      body: { userId },
    });
    if (error) {
      console.error('deleteUserData edge function error:', error);
      return false;
    }
    const result = data as { ok?: boolean; error?: string };
    if (!result?.ok) {
      console.error('deleteUserData edge function returned not ok:', result?.error);
      return false;
    }
    return true;
  } catch (e) {
    console.error('deleteUserData exception:', e);
    return false;
  }
}
