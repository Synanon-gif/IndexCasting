import { supabase } from '../../lib/supabase';
import { logger } from '../utils/logger';

/**
 * Run after a valid session exists (first login after email confirmation, or normal login).
 * Creates client/agency org + owner membership when the user has no org memberships yet.
 *
 * Prüft sowohl den Supabase-Client-Error als auch data.ok === false (RPC-seitige Fehler).
 */
export async function ensurePlainSignupB2bOwnerBootstrap(): Promise<{
  error: { message: string } | null;
}> {
  try {
    const { data, error } = await supabase.rpc('ensure_plain_signup_b2b_owner_bootstrap');
    if (error) {
      console.error('ensure_plain_signup_b2b_owner_bootstrap rpc error:', error);
      logger.error('b2bOwnerBootstrap', 'ensure_plain_signup_b2b_owner_bootstrap rpc error', {
        message: error.message,
        code: (error as { code?: string }).code,
      });
      return { error };
    }
    // RPC kann { ok: false, message: '...' } zurückgeben ohne Supabase-Error
    const rpcResult = data as { ok?: boolean; message?: string } | null;
    if (rpcResult?.ok === false) {
      const msg = rpcResult.message ?? 'Bootstrap RPC returned ok=false';
      console.error('ensure_plain_signup_b2b_owner_bootstrap ok=false:', msg);
      logger.warn(
        'b2bOwnerBootstrap',
        'ensure_plain_signup_b2b_owner_bootstrap returned ok=false',
        { message: msg },
      );
      return { error: { message: msg } };
    }
    return { error: null };
  } catch (e) {
    console.error('ensurePlainSignupB2bOwnerBootstrap exception:', e);
    logger.error('b2bOwnerBootstrap', 'ensurePlainSignupB2bOwnerBootstrap exception', {
      message: e instanceof Error ? e.message : 'unknown',
    });
    return { error: { message: e instanceof Error ? e.message : 'unknown' } };
  }
}
