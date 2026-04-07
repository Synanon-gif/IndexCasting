import { supabase } from '../../lib/supabase';
import { serviceErr, serviceOk, type ServiceResult } from '../types/serviceResult';

export type ConsentType = 'terms' | 'privacy' | 'image_rights' | 'marketing' | 'analytics' | 'minor_guardian';

export type ConsentRecord = {
  id: string;
  user_id: string;
  consent_type: ConsentType;
  version: string;
  accepted_at: string;
  ip_address: string | null;
  withdrawn_at: string | null;
  withdrawal_reason: string | null;
};

export async function recordConsent(
  userId: string,
  consentType: ConsentType,
  version: string,
  ipAddress?: string
): Promise<boolean> {
  try {
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
  } catch (e) {
    console.error('recordConsent exception:', e);
    return false;
  }
}

export async function hasAcceptedVersion(
  userId: string,
  consentType: ConsentType,
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
 * Returns true if the user has an ACTIVE (non-withdrawn) consent for this type + version.
 */
export async function hasActiveConsent(
  userId: string,
  consentType: ConsentType,
  version: string,
): Promise<boolean> {
  try {
    const { data } = await supabase
      .from('consent_log')
      .select('id')
      .eq('user_id', userId)
      .eq('consent_type', consentType)
      .eq('version', version)
      .is('withdrawn_at', null)
      .limit(1)
      .maybeSingle();
    return !!data;
  } catch (e) {
    console.error('hasActiveConsent exception:', e);
    return false;
  }
}

/**
 * GDPR Art. 7(3): withdraws all active consents of a given type for the caller.
 * Backend-enforced via SECURITY DEFINER RPC — cannot be spoofed.
 * Downstream features must check withdrawn_at before using consent-dependent data.
 */
export async function withdrawConsent(
  consentType: ConsentType,
  reason?: string,
): Promise<ServiceResult> {
  try {
    const { error } = await supabase.rpc('withdraw_consent', {
      p_consent_type: consentType,
      p_reason:       reason ?? null,
    });
    if (error) {
      console.error('withdrawConsent error:', error);
      return serviceErr(error.message ?? 'withdraw_failed');
    }
    return serviceOk();
  } catch (e) {
    console.error('withdrawConsent exception:', e);
    return serviceErr(e instanceof Error ? e.message : 'exception');
  }
}

/**
 * Anonymizes user data where hard delete is not possible (e.g. bookings with legal hold).
 * Callable by the user themselves or a super_admin.
 */
export async function anonymizeUserData(userId: string): Promise<boolean> {
  try {
    const { error } = await supabase.rpc('anonymize_user_data', {
      p_user_id: userId,
    });
    if (error) {
      console.error('anonymizeUserData error:', error);
      return false;
    }
    return true;
  } catch (e) {
    console.error('anonymizeUserData exception:', e);
    return false;
  }
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
