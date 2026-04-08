/**
 * Storage utilities for Model Claim Tokens.
 *
 * Parallel to inviteToken.ts — stores a one-time model claim token
 * when the app is opened via a ?model_invite=<token> link.
 * Finalization runs via finalizePendingInviteOrClaim() after session exists.
 */

import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'ic_pending_model_claim_token';
/** Telemetry: user hit ?model_invite= (not used to gate finalization). */
const FLOW_KEY = 'ic_model_claim_flow_active';

function webLocal(): Storage | null {
  if (Platform.OS !== 'web' || typeof window === 'undefined' || !window.localStorage) return null;
  return window.localStorage;
}

function webSession(): Storage | null {
  if (Platform.OS !== 'web' || typeof window === 'undefined' || !window.sessionStorage) return null;
  return window.sessionStorage;
}

function migrateWebModelClaimTokenIfNeeded(): void {
  const loc = webLocal();
  const sess = webSession();
  if (!loc || !sess) return;
  try {
    const legacy = sess.getItem(STORAGE_KEY);
    if (legacy && !loc.getItem(STORAGE_KEY)) {
      loc.setItem(STORAGE_KEY, legacy);
    }
    sess.removeItem(STORAGE_KEY);
    const legacyFlow = sess.getItem(FLOW_KEY);
    if (legacyFlow && !loc.getItem(FLOW_KEY)) {
      loc.setItem(FLOW_KEY, legacyFlow);
    }
  } catch (e) {
    console.error('migrateWebModelClaimTokenIfNeeded error:', e);
  }
}

export async function persistModelClaimToken(token: string | null): Promise<void> {
  try {
    const loc = webLocal();
    if (loc) {
      if (token) loc.setItem(STORAGE_KEY, token);
      else {
        loc.removeItem(STORAGE_KEY);
        loc.removeItem(FLOW_KEY);
      }
      const sess = webSession();
      if (sess) {
        sess.removeItem(STORAGE_KEY);
        if (!token) sess.removeItem(FLOW_KEY);
      }
      return;
    }
    if (token) await AsyncStorage.setItem(STORAGE_KEY, token);
    else await AsyncStorage.removeItem(STORAGE_KEY);
    if (!token) await AsyncStorage.removeItem(FLOW_KEY);
  } catch (e) {
    console.error('persistModelClaimToken error:', e);
  }
}

/** Call when the app loaded with ?model_invite= (telemetry only). */
export async function markModelClaimFlowFromUrl(): Promise<void> {
  try {
    const loc = webLocal();
    if (loc) {
      loc.setItem(FLOW_KEY, '1');
      return;
    }
    await AsyncStorage.setItem(FLOW_KEY, '1');
  } catch (e) {
    console.error('markModelClaimFlowFromUrl error:', e);
  }
}

export async function isModelClaimFlowActive(): Promise<boolean> {
  try {
    migrateWebModelClaimTokenIfNeeded();
    const loc = webLocal();
    if (loc) {
      return loc.getItem(FLOW_KEY) === '1';
    }
    return (await AsyncStorage.getItem(FLOW_KEY)) === '1';
  } catch (e) {
    console.error('isModelClaimFlowActive error:', e);
    return false;
  }
}

export async function readModelClaimToken(): Promise<string | null> {
  try {
    migrateWebModelClaimTokenIfNeeded();
    const loc = webLocal();
    if (loc) {
      return loc.getItem(STORAGE_KEY);
    }
    return await AsyncStorage.getItem(STORAGE_KEY);
  } catch (e) {
    console.error('readModelClaimToken error:', e);
    return null;
  }
}
