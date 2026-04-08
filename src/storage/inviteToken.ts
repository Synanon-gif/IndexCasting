import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'ic_pending_invite_token';
/** Telemetry: user hit a valid ?invite= link (not used to gate finalization). */
const FLOW_KEY = 'ic_invite_flow_active';

function webLocal(): Storage | null {
  if (Platform.OS !== 'web' || typeof window === 'undefined' || !window.localStorage) return null;
  return window.localStorage;
}

function webSession(): Storage | null {
  if (Platform.OS !== 'web' || typeof window === 'undefined' || !window.sessionStorage) return null;
  return window.sessionStorage;
}

/** Migrate legacy sessionStorage token to localStorage (web). */
function migrateWebInviteTokenIfNeeded(): void {
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
    console.error('migrateWebInviteTokenIfNeeded error:', e);
  }
}

export async function persistInviteToken(token: string | null): Promise<void> {
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
    console.error('persistInviteToken error:', e);
  }
}

/** Call when the app loaded with ?invite= (telemetry only). */
export async function markInviteFlowFromUrl(): Promise<void> {
  try {
    const loc = webLocal();
    if (loc) {
      loc.setItem(FLOW_KEY, '1');
      return;
    }
    await AsyncStorage.setItem(FLOW_KEY, '1');
  } catch (e) {
    console.error('markInviteFlowFromUrl error:', e);
  }
}

export async function isInviteFlowActive(): Promise<boolean> {
  try {
    migrateWebInviteTokenIfNeeded();
    const loc = webLocal();
    if (loc) {
      return loc.getItem(FLOW_KEY) === '1';
    }
    return (await AsyncStorage.getItem(FLOW_KEY)) === '1';
  } catch (e) {
    console.error('isInviteFlowActive error:', e);
    return false;
  }
}

export async function readInviteToken(): Promise<string | null> {
  try {
    migrateWebInviteTokenIfNeeded();
    const loc = webLocal();
    if (loc) {
      return loc.getItem(STORAGE_KEY);
    }
    return await AsyncStorage.getItem(STORAGE_KEY);
  } catch (e) {
    console.error('readInviteToken error:', e);
    return null;
  }
}
