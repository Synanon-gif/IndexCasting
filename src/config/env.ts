/**
 * Umgebungsvariablen aus .env.local (via app.config.js → extra).
 * Nutzung: import { supabaseUrl, supabaseAnonKey } from '../config/env';
 */
import Constants from 'expo-constants';

const extra = (Constants.expoConfig as { extra?: Record<string, string> } | null)?.extra ?? {};

export const supabaseUrl = extra.supabaseUrl ?? '';
export const supabaseAnonKey = extra.supabaseAnonKey ?? '';
export const supabasePublishableKey = extra.supabasePublishableKey ?? '';
