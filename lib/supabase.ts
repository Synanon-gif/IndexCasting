/**
 * Supabase Client – zentrale Verbindungsstelle für die ganze App.
 * Session-Persistenz über localStorage (Web) oder AsyncStorage (Native).
 */
import { createClient } from '@supabase/supabase-js';
import { supabaseUrl, supabaseAnonKey } from '../src/config/env';
import { Platform } from 'react-native';

import type { SupportedStorage } from '@supabase/supabase-js';

let storageAdapter: SupportedStorage | undefined = undefined;

if (Platform.OS !== 'web') {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
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

// Guard: createClient throws synchronously when URL/key is empty, which crashes
// the entire module before React mounts (no ErrorBoundary can catch it → blank page).
// Use a safe placeholder URL so the module loads; ConfigGuard in App.tsx will show
// a human-readable error instead of a blank screen.
const SAFE_URL = supabaseUrl || 'https://placeholder.supabase.co';
const SAFE_KEY = supabaseAnonKey || 'placeholder-anon-key';

export const supabase = createClient(SAFE_URL, SAFE_KEY, {
  auth: {
    ...(storageAdapter ? { storage: storageAdapter } : {}),
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: Platform.OS === 'web',
  },
});
