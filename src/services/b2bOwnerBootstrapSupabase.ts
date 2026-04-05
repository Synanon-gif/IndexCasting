import { supabase } from '../../lib/supabase';

/**
 * Run after a valid session exists (first login after email confirmation, or normal login).
 * Creates client/agency org + owner membership when the user has no org memberships yet.
 *
 * Prüft sowohl den Supabase-Client-Error als auch data.ok === false (RPC-seitige Fehler).
 */
export async function ensurePlainSignupB2bOwnerBootstrap(): Promise<{ error: { message: string } | null }> {
  try {
    const { data, error } = await supabase.rpc('ensure_plain_signup_b2b_owner_bootstrap');
    if (error) {
      console.error('ensure_plain_signup_b2b_owner_bootstrap rpc error:', error);
      return { error };
    }
    // RPC kann { ok: false, message: '...' } zurückgeben ohne Supabase-Error
    const rpcResult = data as { ok?: boolean; message?: string } | null;
    if (rpcResult?.ok === false) {
      const msg = rpcResult.message ?? 'Bootstrap RPC returned ok=false';
      console.error('ensure_plain_signup_b2b_owner_bootstrap ok=false:', msg);
      return { error: { message: msg } };
    }
    return { error: null };
  } catch (e) {
    console.error('ensurePlainSignupB2bOwnerBootstrap exception:', e);
    return { error: { message: e instanceof Error ? e.message : 'unknown' } };
  }
}
