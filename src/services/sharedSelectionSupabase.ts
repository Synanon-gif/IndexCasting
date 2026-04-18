/**
 * Service for fetching shared selection model data via the public RPC
 * `get_shared_selection_models`. Works without authentication (anon-granted).
 */
import { supabase } from '../../lib/supabase';
import { applySignedUrls, signSharedSelectionImages } from './guestLinksSupabase';
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

    // Server-side signing via Edge Function (Security Audit 2026-10):
    // documentspictures has no anon SELECT policy; client-side createSignedUrl
    // fails for anon viewers. The Edge Function recomputes the HMAC token
    // server-side and only signs paths that belong to the supplied modelIds.
    if (!token) {
      console.warn('[getSharedSelectionModels] missing token — returning models without images');
      return {
        ok: true,
        data: models.map((m) => ({ ...m, portfolio_images: [] })),
      };
    }
    const signedMap = await signSharedSelectionImages(modelIds, token, models);
    const signed = models.map((m) => ({
      ...m,
      portfolio_images: applySignedUrls(m.portfolio_images ?? [], m.id, signedMap).filter(
        (u): u is string => u !== null,
      ),
    }));

    return { ok: true, data: signed };
  } catch (e) {
    console.error('[getSharedSelectionModels] exception:', e);
    return { ok: false, error: uiCopy.sharedSelection.loadFailed ?? 'Failed to load models' };
  }
}
