/**
 * Netwalk API abstraction layer.
 * Mirrors the structure of mediaslideConnector.js.
 * All Netwalk calls go through this module.
 *
 * SETUP: Set EXPO_PUBLIC_NETWALK_API_URL in .env (or Supabase secrets).
 * Example: https://api.netwalk.com/v1
 *
 * Until EXPO_PUBLIC_NETWALK_API_URL is set, all functions operate in mock mode
 * by reading data from Supabase (same model, no real Netwalk call).
 */

// ---------------------------------------------------------------------------
// CONFIGURATION — reads from env; falls back to null (mock mode)
// ---------------------------------------------------------------------------
const NETWALK_API_BASE_URL =
  (typeof process !== 'undefined' && process.env?.EXPO_PUBLIC_NETWALK_API_URL) ||
  (typeof process !== 'undefined' && process.env?.NETWALK_API_BASE_URL) ||
  null;

const getBaseUrl = () => NETWALK_API_BASE_URL || '';

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function authHeader(apiKey) {
  return apiKey ? `Bearer ${apiKey}` : '';
}

/**
 * Sync model data from Netwalk into our DB.
 * When NETWALK_API_BASE_URL is set, POSTs to Netwalk; otherwise returns mock.
 *
 * @param {string} netwalkModelId
 * @param {string=} apiKey  Optional Netwalk API key.
 */
export async function syncModelData(netwalkModelId, apiKey) {
  await delay(200);
  if (!getBaseUrl()) {
    return { synced: true, modelId: netwalkModelId, source: 'mock' };
  }
  const url = `${getBaseUrl()}/api/models/sync`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? { Authorization: authHeader(apiKey) } : {}),
    },
    body: JSON.stringify({ netwalk_id: netwalkModelId }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

/**
 * Fetch a single model by Netwalk ID.
 * Returns a NetwalkModelPayload-compatible object or null.
 *
 * Mock fields include all measurement + appearance fields so that
 * netwalkSyncService.ts can map them correctly during dev/test.
 *
 * @param {string} id          Netwalk model ID (netwalk_model_id).
 * @param {string=} apiKey     Optional Netwalk API key.
 */
export async function getModelFromNetwalk(id, apiKey) {
  await delay(150);
  if (!getBaseUrl()) {
    // In mock mode, `id` is the external netwalk_model_id string, NOT a local UUID.
    // Query by the correct column instead of the primary key.
    const { supabase } = await import('../../lib/supabase');
    const { data, error } = await supabase
      .from('models')
      .select('*')
      .eq('netwalk_model_id', id)
      .maybeSingle();
    if (error) console.error('getModelFromNetwalk mock lookup error:', error);
    const model = data ?? null;
    if (!model) return null;
    return {
      id: model.id,
      netwalk_model_id: model.netwalk_model_id ?? null,
      name: model.name,
      updated_at: model.updated_at ?? null,
      measurements: {
        height:      model.height      ?? null,
        bust:        model.bust        ?? null,
        waist:       model.waist       ?? null,
        hips:        model.hips        ?? null,
        chest:       model.chest       ?? null,
        legs_inseam: model.legs_inseam ?? null,
        shoe_size:   model.shoe_size   ?? null,
      },
      portfolio: {
        images:    model.portfolio_images ?? [],
        polaroids: model.polaroids        ?? [],
      },
      city:        model.city        ?? null,
      country:     model.country     ?? null,
      country_code: model.country_code ?? null,
      hair_color:  model.hair_color  ?? null,
      eye_color:   model.eye_color   ?? null,
      sex:         model.sex         ?? null,
      ethnicity:   model.ethnicity   ?? null,
      categories:  model.categories  ?? null,
      visibility: {
        isVisibleCommercial: model.is_visible_commercial ?? true,
        isVisibleFashion:    model.is_visible_fashion    ?? false,
      },
    };
  }
  const res = await fetch(`${getBaseUrl()}/api/models/${id}`, {
    headers: apiKey ? { Authorization: authHeader(apiKey) } : {},
  });
  if (!res.ok) return null;
  return res.json();
}

/**
 * Push availability (blocked/available dates) to Netwalk.
 *
 * @param {string} id
 * @param {{ blocked: string[], available: string[] }} dates
 * @param {string=} apiKey
 */
export async function pushAvailabilityToNetwalk(id, dates, apiKey) {
  await delay(150);
  if (!getBaseUrl()) return { ok: true };
  const res = await fetch(`${getBaseUrl()}/api/models/${id}/availability`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? { Authorization: authHeader(apiKey) } : {}),
    },
    body: JSON.stringify(dates),
  });
  return { ok: res.ok };
}

/**
 * Push visibility (commercial/fashion) to Netwalk.
 *
 * @param {string} id
 * @param {{ isVisibleCommercial: boolean, isVisibleFashion: boolean }} visibility
 * @param {string=} apiKey
 */
export async function pushVisibilityToNetwalk(id, visibility, apiKey) {
  await delay(150);
  if (!getBaseUrl()) return { ok: true };
  const res = await fetch(`${getBaseUrl()}/api/models/${id}/visibility`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? { Authorization: authHeader(apiKey) } : {}),
    },
    body: JSON.stringify(visibility),
  });
  return { ok: res.ok };
}
