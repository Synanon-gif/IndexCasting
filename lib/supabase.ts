/**
 * Supabase Client – zentrale Verbindungsstelle für die ganze App.
 * Session-Persistenz über localStorage (Web) oder AsyncStorage (Native).
 */
import { createClient } from '@supabase/supabase-js';
import { supabaseUrl, supabaseAnonKey } from '../src/config/env';
import { Platform } from 'react-native';

let storageAdapter: any = undefined;

if (Platform.OS !== 'web') {
  try {
    const AsyncStorage = require('@react-native-async-storage/async-storage').default;
    storageAdapter = {
      getItem: (key: string) => AsyncStorage.getItem(key),
      setItem: (key: string, value: string) => AsyncStorage.setItem(key, value),
      removeItem: (key: string) => AsyncStorage.removeItem(key),
    };
  } catch {
    // AsyncStorage not installed – session won't persist on native
  }
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    ...(storageAdapter ? { storage: storageAdapter } : {}),
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: Platform.OS === 'web',
  },
});
