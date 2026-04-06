/**
 * Storage utilities for Model Claim Tokens.
 *
 * Parallel to inviteToken.ts — stores a one-time model claim token
 * when the app is opened via a ?model_invite=<token> link.
 * The token is consumed in AuthContext after login/signup to link the
 * model record to the new user account via claimModelByToken().
 */

import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'ic_pending_model_claim_token';
/** Set when the user opened a valid ?model_invite= link this session. */
const FLOW_KEY = 'ic_model_claim_flow_active';

export async function persistModelClaimToken(token: string | null): Promise<void> {
  try {
    if (Platform.OS === 'web' && typeof window !== 'undefined' && window.sessionStorage) {
      if (token) window.sessionStorage.setItem(STORAGE_KEY, token);
      else window.sessionStorage.removeItem(STORAGE_KEY);
      if (!token) window.sessionStorage.removeItem(FLOW_KEY);
      return;
    }
    if (token) await AsyncStorage.setItem(STORAGE_KEY, token);
    else await AsyncStorage.removeItem(STORAGE_KEY);
    if (!token) await AsyncStorage.removeItem(FLOW_KEY);
  } catch (e) {
    console.error('persistModelClaimToken error:', e);
  }
}

/** Call when the app loaded with ?model_invite= so the token can be consumed after login. */
export async function markModelClaimFlowFromUrl(): Promise<void> {
  try {
    if (Platform.OS === 'web' && typeof window !== 'undefined' && window.sessionStorage) {
      window.sessionStorage.setItem(FLOW_KEY, '1');
      return;
    }
    await AsyncStorage.setItem(FLOW_KEY, '1');
  } catch (e) {
    console.error('markModelClaimFlowFromUrl error:', e);
  }
}

export async function isModelClaimFlowActive(): Promise<boolean> {
  try {
    if (Platform.OS === 'web' && typeof window !== 'undefined' && window.sessionStorage) {
      return window.sessionStorage.getItem(FLOW_KEY) === '1';
    }
    return (await AsyncStorage.getItem(FLOW_KEY)) === '1';
  } catch (e) {
    console.error('isModelClaimFlowActive error:', e);
    return false;
  }
}

export async function readModelClaimToken(): Promise<string | null> {
  try {
    if (Platform.OS === 'web' && typeof window !== 'undefined' && window.sessionStorage) {
      return window.sessionStorage.getItem(STORAGE_KEY);
    }
    return await AsyncStorage.getItem(STORAGE_KEY);
  } catch (e) {
    console.error('readModelClaimToken error:', e);
    return null;
  }
}
