/**
 * Umgebungsvariablen aus .env.local (via app.config.js → extra) oder process.env.
 * Nutzung: import { supabaseUrl, supabaseAnonKey } from '../config/env';
 */
import Constants from 'expo-constants';

const extra = (Constants.expoConfig as { extra?: Record<string, string> } | null)?.extra ?? {} as Record<string, string>;

function get(key: 'supabaseUrl' | 'supabaseAnonKey' | 'supabasePublishableKey', envKeys: string[]): string {
  const fromExtra = extra[key];
  if (fromExtra && fromExtra.trim() !== '') return fromExtra.trim();
  if (typeof process !== 'undefined' && process.env) {
    for (const k of envKeys) {
      const v = process.env[k];
      if (v && v.trim() !== '') return v.trim();
    }
  }
  return '';
}

export const supabaseUrl = get('supabaseUrl', ['EXPO_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL']);
export const supabaseAnonKey = get('supabaseAnonKey', ['EXPO_PUBLIC_SUPABASE_ANON_KEY', 'NEXT_PUBLIC_SUPABASE_ANON_KEY']);
export const supabasePublishableKey = get('supabasePublishableKey', ['EXPO_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY', 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY']);

/**
 * The canonical public URL of the app.
 * Controlled by EXPO_PUBLIC_APP_URL env-var; falls back to production.
 * Used as redirectTo in password-reset flows so it always matches the
 * Supabase uri_allow_list (https://index-casting.com/**).
 */
export const appUrl: string = (() => {
  const fromExtra = extra['appUrl'];
  if (fromExtra && fromExtra.trim() !== '') return fromExtra.trim().replace(/\/$/, '');
  if (typeof process !== 'undefined' && process.env) {
    const fromEnv = process.env['EXPO_PUBLIC_APP_URL'];
    if (fromEnv && fromEnv.trim() !== '') return fromEnv.trim().replace(/\/$/, '');
  }
  return 'https://index-casting.com';
})();
