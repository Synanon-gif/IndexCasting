import { supabase } from '../../lib/supabase';

export type RequestAccountDeletionResult =
  | { ok: true }
  | { ok: false; reason: 'not_owner' | 'failed' };

/** Soft-delete request: sets profiles.deletion_requested_at; purge auth user after 30 days (cron/Edge). */
export async function requestAccountDeletion(): Promise<RequestAccountDeletionResult> {
  try {
    const { data, error } = await supabase.rpc('request_account_deletion');
    if (error) {
      console.error('requestAccountDeletion error:', error);
      const msg = `${error.message ?? ''} ${(error as { details?: string }).details ?? ''}`;
      if (msg.includes('only_organization_owner_can_delete_account')) {
        return { ok: false, reason: 'not_owner' };
      }
      return { ok: false, reason: 'failed' };
    }
    if (data !== true) {
      return { ok: false, reason: 'failed' };
    }
    return { ok: true };
  } catch (e) {
    console.error('requestAccountDeletion exception:', e);
    return { ok: false, reason: 'failed' };
  }
}

/**
 * Soft-delete for any user regardless of org role.
 * Removes the caller from organization_members and sets deletion_requested_at.
 * Use this for non-owner bookers/employees who want to leave and delete their account.
 */
export async function requestPersonalAccountDeletion(): Promise<{ ok: boolean; reason?: string }> {
  try {
    const { error } = await supabase.rpc('request_personal_account_deletion');
    if (error) {
      // Log internally; never expose raw DB/RPC error messages to the UI.
      console.error('requestPersonalAccountDeletion error:', error);
      return { ok: false, reason: 'failed' };
    }
    return { ok: true };
  } catch (e) {
    console.error('requestPersonalAccountDeletion exception:', e);
    return { ok: false, reason: 'failed' };
  }
}

/** Löschwunsch zurückziehen (innerhalb der 30 Tage). */
export async function cancelAccountDeletion(): Promise<boolean> {
  try {
    const { error } = await supabase.rpc('cancel_account_deletion');
    if (error) {
      console.error('cancelAccountDeletion error:', error);
      return false;
    }
    return true;
  } catch (e) {
    console.error('cancelAccountDeletion exception:', e);
    return false;
  }
}
