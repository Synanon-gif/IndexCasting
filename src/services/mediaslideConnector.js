/**
 * Mediaslide API abstraction layer.
 * All Mediaslide calls go through this module. Replace BASE_URL with your real Mediaslide API
 * when connecting the live backend.
 *
 * SETUP: Set MEDIASLIDE_API_BASE_URL in env (e.g. in .env or Supabase secrets).
 * Example: https://api.mediaslide.com/v1
 */

// ---------------------------------------------------------------------------
// CONFIGURATION – Replace with real Mediaslide API URL when going live
// ---------------------------------------------------------------------------
// Option 1: From environment (recommended for production)
// const MEDIASLIDE_API_BASE_URL = process.env.EXPO_PUBLIC_MEDIASLIDE_API_URL || process.env.MEDIASLIDE_API_BASE_URL;
// Option 2: Hardcode for development (replace with your Mediaslide base URL)
const MEDIASLIDE_API_BASE_URL = null; // e.g. 'https://api.mediaslide.com/v1'

const getBaseUrl = () => MEDIASLIDE_API_BASE_URL || '';

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Sync model data from Mediaslide into our DB (models table).
 * When MEDIASLIDE_API_BASE_URL is set, calls Mediaslide; otherwise uses local mock.
 *
 * LATER: Replace the mock block with:
 *   const res = await fetch(`${getBaseUrl()}/models/${mediaslideSyncId}`, { headers: { Authorization: `Bearer ${token}` } });
 *   const data = await res.json();
 *   return mapMediaslideToModel(data);
 */
export async function syncModelData(mediaslideSyncId) {
  await delay(200);
  if (!getBaseUrl()) {
    // Mock: no Mediaslide URL configured – return mock payload
    // REAL: await fetch(`${getBaseUrl()}/api/models/sync/${mediaslideSyncId}`, { method: 'POST', ... })
    return { synced: true, modelId: mediaslideSyncId, source: 'mock' };
  }
  // REAL API CALL (uncomment and adjust when Mediaslide is connected):
  // const url = `${getBaseUrl()}/api/models/sync`;
  // const res = await fetch(url, {
  //   method: 'POST',
  //   headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getSupabaseOrAppToken()}` },
  //   body: JSON.stringify({ mediaslide_id: mediaslideSyncId }),
  // });
  // if (!res.ok) throw new Error(await res.text());
  // return res.json();
  return { synced: true, modelId: mediaslideSyncId };
}

/**
 * Fetch a single model by ID from Mediaslide (or local cache).
 *
 * LATER: Replace mock with:
 *   const res = await fetch(`${getBaseUrl()}/models/${id}`, { headers: { Authorization: ... } });
 *   return res.json();
 */
export async function getModelFromMediaslide(id) {
  await delay(150);
  if (!getBaseUrl()) {
    const { getModelByIdFromSupabase } = await import('./modelsSupabase');
    const model = await getModelByIdFromSupabase(id);
    if (!model) return null;
    return {
      id: model.id,
      mediaslide_sync_id: model.mediaslide_sync_id,
      name: model.name,
      measurements: { height: model.height, bust: model.bust, waist: model.waist, hips: model.hips },
      portfolio: { images: model.portfolio_images || [], polaroids: model.polaroids || [] },
      isVisibleCommercial: model.is_visible_commercial,
      isVisibleFashion: model.is_visible_fashion,
    };
  }
  // REAL: const res = await fetch(`${getBaseUrl()}/api/models/${id}`); return res.json();
  return null;
}

/**
 * Push availability (blocked/available dates) to Mediaslide.
 *
 * LATER: PUT/PATCH to Mediaslide, e.g.:
 *   await fetch(`${getBaseUrl()}/api/models/${id}/availability`, {
 *     method: 'PATCH',
 *     headers: { 'Content-Type': 'application/json', Authorization: ... },
 *     body: JSON.stringify({ blocked: dates.blocked, available: dates.available }),
 *   });
 */
export async function pushAvailabilityToMediaslide(id, dates) {
  await delay(150);
  if (!getBaseUrl()) return { ok: true };
  // REAL: await fetch(`${getBaseUrl()}/api/models/${id}/availability`, { method: 'PATCH', body: JSON.stringify(dates) });
  return { ok: true };
}

/**
 * Push visibility (commercial/fashion) to Mediaslide.
 */
export async function pushVisibilityToMediaslide(id, visibility) {
  await delay(150);
  if (!getBaseUrl()) return { ok: true };
  // REAL: await fetch(`${getBaseUrl()}/api/models/${id}/visibility`, { method: 'PATCH', body: JSON.stringify(visibility) });
  return { ok: true };
}
