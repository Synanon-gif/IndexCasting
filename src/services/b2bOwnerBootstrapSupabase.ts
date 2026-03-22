import { supabase } from '../../lib/supabase';

/**
 * Run after a valid session exists (first login after email confirmation, or normal login).
 * Creates client/agency org + owner membership when the user has no org memberships yet.
 */
export async function ensurePlainSignupB2bOwnerBootstrap(): Promise<{ error: { message: string } | null }> {
  try {
    const { error } = await supabase.rpc('ensure_plain_signup_b2b_owner_bootstrap');
    if (error) {
      console.error('ensure_plain_signup_b2b_owner_bootstrap', error);
      return { error };
    }
    return { error: null };
  } catch (e) {
    console.error('ensurePlainSignupB2bOwnerBootstrap exception:', e);
    return { error: { message: e instanceof Error ? e.message : 'unknown' } };
  }
}
