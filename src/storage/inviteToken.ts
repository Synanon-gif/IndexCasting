import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'ic_pending_invite_token';
/** Set when the user opened a valid ?invite= link this session; prevents post-login accept from stray storage (e.g. after email confirmation). */
const FLOW_KEY = 'ic_invite_flow_active';

export async function persistInviteToken(token: string | null): Promise<void> {
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
    console.error('persistInviteToken error:', e);
  }
}

/** Call when the app loaded with ?invite= so stored tokens may be consumed after login. */
export async function markInviteFlowFromUrl(): Promise<void> {
  try {
    if (Platform.OS === 'web' && typeof window !== 'undefined' && window.sessionStorage) {
      window.sessionStorage.setItem(FLOW_KEY, '1');
      return;
    }
    await AsyncStorage.setItem(FLOW_KEY, '1');
  } catch (e) {
    console.error('markInviteFlowFromUrl error:', e);
  }
}

export async function isInviteFlowActive(): Promise<boolean> {
  try {
    if (Platform.OS === 'web' && typeof window !== 'undefined' && window.sessionStorage) {
      return window.sessionStorage.getItem(FLOW_KEY) === '1';
    }
    return (await AsyncStorage.getItem(FLOW_KEY)) === '1';
  } catch (e) {
    console.error('isInviteFlowActive error:', e);
    return false;
  }
}

export async function readInviteToken(): Promise<string | null> {
  try {
    if (Platform.OS === 'web' && typeof window !== 'undefined' && window.sessionStorage) {
      return window.sessionStorage.getItem(STORAGE_KEY);
    }
    return await AsyncStorage.getItem(STORAGE_KEY);
  } catch (e) {
    console.error('readInviteToken error:', e);
    return null;
  }
}
