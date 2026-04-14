/**
 * Service for fetching shared selection model data via the public RPC
 * `get_shared_selection_models`. Works without authentication (anon-granted).
 */
import { supabase } from '../../lib/supabase';
import { signImageUrls } from './guestLinksSupabase';
import { uiCopy } from '../constants/uiCopy';

export type SharedSelectionModel = {
  id: string;
  name: string;
  height: number | null;
  chest: number | null;
  bust: number | null;
  waist: number | null;
  hips: number | null;
  city: string | null;
  portfolio_images: string[];
  effective_city: string | null;
};

/**
 * Compute the HMAC token for a set of model IDs (requires authenticated session).
 * Used when generating share links.
 */
export async function computeSharedSelectionToken(modelIds: string[]): Promise<string | null> {
  if (!modelIds.length) return null;
  try {
    const { data, error } = await supabase.rpc('shared_selection_compute_hmac', {
      p_model_ids: modelIds,
    });
    if (error) {
      console.error('[computeSharedSelectionToken] RPC error:', error);
      return null;
    }
    return data as string;
  } catch (e) {
    console.error('[computeSharedSelectionToken] exception:', e);
    return null;
  }
}

export async function getSharedSelectionModels(
  modelIds: string[],
  token?: string | null,
): Promise<{ ok: true; data: SharedSelectionModel[] } | { ok: false; error: string }> {
  if (!modelIds.length) {
    return { ok: true, data: [] };
  }

  try {
    const { data, error } = await supabase.rpc('get_shared_selection_models', {
      p_model_ids: modelIds,
      p_token: token ?? null,
    });

    if (error) {
      console.error('[getSharedSelectionModels] RPC error:', error);
      return { ok: false, error: uiCopy.sharedSelection.loadFailed ?? 'Failed to load models' };
    }

    const models = (data ?? []) as SharedSelectionModel[];

    const signed = await Promise.all(
      models.map(async (m) => ({
        ...m,
        portfolio_images: (await signImageUrls(m.portfolio_images ?? [], m.id)).filter(
          (u): u is string => u !== null,
        ),
      })),
    );

    return { ok: true, data: signed };
  } catch (e) {
    console.error('[getSharedSelectionModels] exception:', e);
    return { ok: false, error: uiCopy.sharedSelection.loadFailed ?? 'Failed to load models' };
  }
}
