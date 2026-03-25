/**
 * Client filter presets — save/load discovery filter state to/from Supabase profiles.
 * Each user persists their own preset; available across devices and browser sessions.
 * Requires migration_client_filter_preset.sql to be applied in Supabase.
 */
import { supabase } from '../../lib/supabase';
import type { PersistedClientFilters } from '../storage/persistence';

/**
 * Saves the current filter state to the user's Supabase profile row.
 * Returns true on success, false on error.
 */
export async function saveFilterPresetToSupabase(
  filters: PersistedClientFilters,
): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc('save_client_filter_preset', {
      p_preset: filters as unknown as Record<string, unknown>,
    });
    if (error) {
      console.error('saveFilterPresetToSupabase error:', error);
      return false;
    }
    return data === true;
  } catch (e) {
    console.error('saveFilterPresetToSupabase exception:', e);
    return false;
  }
}

/**
 * Loads the user's saved filter preset from Supabase.
 * Returns null if not set or on error.
 */
export async function loadFilterPresetFromSupabase(): Promise<PersistedClientFilters | null> {
  try {
    const { data, error } = await supabase.rpc('load_client_filter_preset');
    if (error) {
      console.error('loadFilterPresetFromSupabase error:', error);
      return null;
    }
    if (!data || typeof data !== 'object') return null;
    return data as unknown as PersistedClientFilters;
  } catch (e) {
    console.error('loadFilterPresetFromSupabase exception:', e);
    return null;
  }
}
