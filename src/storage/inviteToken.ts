import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'ic_pending_invite_token';

export async function persistInviteToken(token: string | null): Promise<void> {
  try {
    if (Platform.OS === 'web' && typeof window !== 'undefined' && window.sessionStorage) {
      if (token) window.sessionStorage.setItem(STORAGE_KEY, token);
      else window.sessionStorage.removeItem(STORAGE_KEY);
      return;
    }
    if (token) await AsyncStorage.setItem(STORAGE_KEY, token);
    else await AsyncStorage.removeItem(STORAGE_KEY);
  } catch (e) {
    console.error('persistInviteToken error:', e);
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
