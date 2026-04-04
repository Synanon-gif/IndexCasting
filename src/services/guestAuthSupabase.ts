/**
 * Guest-to-Client Auth Flow
 *
 * Lightweight (unverified) accounts via Magic Link (OTP).
 * Guest users:
 *   - are stored in auth.users + profiles (is_guest=true)
 *   - have NO client organization
 *   - can upgrade to a full client account via upgradeGuestToClient()
 *
 * DSGVO: only email is collected at this stage.
 * deleteGuestUserContent() / deleteUserData() must be called on account deletion to clean up chat data.
 */

import { supabase } from '../../lib/supabase';

export type GuestSignInResult =
  | { ok: true; isNewUser: boolean }
  | { ok: false; reason: string };

export type UpgradeResult =
  | { ok: true; organizationId: string }
  | { ok: false; reason: string };

/**
 * Sends a Magic Link to the given email.
 * Works for both new and existing users — Supabase OTP handles both cases.
 * The caller is responsible for showing a "Check your email" screen afterwards.
 */
export async function signInOrCreateGuestWithOtp(
  email: string,
): Promise<GuestSignInResult> {
  try {
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim().toLowerCase(),
      options: {
        shouldCreateUser: true,
        data: {
          role: 'client',
          is_guest: true,
        },
      },
    });
    if (error) {
      console.error('signInOrCreateGuestWithOtp error:', error);
      return { ok: false, reason: error.message };
    }
    return { ok: true, isNewUser: true };
  } catch (e) {
    console.error('signInOrCreateGuestWithOtp exception:', e);
    return { ok: false, reason: 'Unexpected error. Please try again.' };
  }
}

/**
 * Creates or updates the profile row for a newly authenticated guest user.
 * Called once after the Magic Link is clicked and the session is active.
 *
 * Idempotent — safe to call multiple times.
 */
export async function createGuestProfile(
  userId: string,
  email: string,
  displayName?: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const { error } = await supabase.from('profiles').upsert(
      {
        id: userId,
        email: email.trim().toLowerCase(),
        display_name: displayName || email.split('@')[0],
        role: 'client',
        is_active: true,
        is_guest: true,
        has_completed_signup: false,
        tos_accepted: false,
        privacy_accepted: false,
      },
      { onConflict: 'id', ignoreDuplicates: false },
    );
    if (error) {
      console.error('createGuestProfile error:', error);
      return { ok: false, error: error.message };
    }
    return { ok: true };
  } catch (e) {
    console.error('createGuestProfile exception:', e);
    return { ok: false, error: 'Could not create guest profile.' };
  }
}

/**
 * Upgrades the current guest user to a full client account.
 * Calls the DB RPC upgrade_guest_to_client which:
 *   1. Creates a client organization
 *   2. Adds the user as owner member
 *   3. Flips is_guest=false, has_completed_signup=true
 *
 * ⚠️  Must only be called when supabase.auth.getUser() returns the guest user.
 */
export async function upgradeGuestToClient(
  companyName?: string,
): Promise<UpgradeResult> {
  try {
    const { data, error } = await supabase.rpc('upgrade_guest_to_client', {
      p_company_name: companyName?.trim() || null,
    });
    if (error) {
      console.error('upgradeGuestToClient RPC error:', error);
      return { ok: false, reason: error.message };
    }
    const result = data as { ok: boolean; reason?: string; organization_id?: string };
    if (!result?.ok) {
      return { ok: false, reason: result?.reason || 'upgrade_failed' };
    }
    return { ok: true, organizationId: result.organization_id! };
  } catch (e) {
    console.error('upgradeGuestToClient exception:', e);
    return { ok: false, reason: 'Unexpected error during upgrade.' };
  }
}

/**
 * DSGVO: deletes all guest-related data for a user.
 * Call this when a guest requests account deletion before upgrading.
 */
export async function deleteGuestUserContent(userId: string): Promise<void> {
  try {
    // Messages are deleted via CASCADE on conversations.
    // Conversations where the user is a participant need explicit cleanup.
    const { data: convs } = await supabase
      .from('conversations')
      .select('id')
      .contains('participant_ids', [userId]);

    if (convs && convs.length > 0) {
      const convIds = convs.map((c: { id: string }) => c.id);
      // Only delete conversations that are purely guest ↔ agency (guest_user_id set)
      await supabase
        .from('conversations')
        .delete()
        .in('id', convIds)
        .eq('guest_user_id', userId);
    }

    // Profile row is deleted via CASCADE on auth.users deletion.
    // The actual auth.users deletion is handled by the server-side Edge Function
    // to avoid exposing the service_role key in the frontend bundle.
    const { error: fnError } = await supabase.functions.invoke('delete-user', {
      body: { userId },
    });
    if (fnError) {
      console.error('deleteGuestUserContent edge function error:', fnError);
    }
  } catch (e) {
    console.error('deleteGuestUserContent exception:', e);
  }
}
