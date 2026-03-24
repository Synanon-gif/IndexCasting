/**
 * API Service – central layer for all data access.
 * Now reads from Supabase (models, agencies). Mediaslide endpoints can be wired later.
 */

import {
  getModelsFromSupabase,
  getModelByIdFromSupabase,
  getModelsForClientFromSupabase,
  getModelsForClientFromSupabaseByTerritory,
  getModelsForClientFromSupabaseHybridLocation,
  getModelsForAgencyFromSupabase,
  updateModelVisibilityInSupabase,
} from './modelsSupabase';

const availabilityOverrides = new Map();

/**
 * Full model data: portfolio, calendar blocks, measurements.
 */
export async function getModelData(id) {
  const base = await getModelByIdFromSupabase(id);
  if (!base) return null;

  const blocked = availabilityOverrides.has(id)
    ? availabilityOverrides.get(id).blocked
    : ['2026-03-21', '2026-03-22'];
  const available = availabilityOverrides.has(id)
    ? availabilityOverrides.get(id).available
    : ['2026-03-23', '2026-03-24', '2026-03-25'];

  return {
    id: base.id,
    name: base.name,
    measurements: {
      height: base.height,
      bust: base.bust,
      waist: base.waist,
      hips: base.hips,
    },
    portfolio: {
      images: base.portfolio_images || [],
      polaroids: base.polaroids || [],
    },
    calendar: { blocked, available },
    isVisibleCommercial: base.is_visible_commercial,
    isVisibleFashion: base.is_visible_fashion,
  };
}

/**
 * Kalender-Blocks (Verfügbarkeit) aktualisieren.
 */
export async function updateAvailability(id, dates) {
  availabilityOverrides.set(id, {
    blocked: dates.blocked || [],
    available: dates.available || [],
  });
}

/**
 * Update visibility (Commercial / Fashion) in Supabase.
 */
export async function updateModelVisibility(id, { isVisibleCommercial, isVisibleFashion }) {
  await updateModelVisibilityInSupabase(id, {
    is_visible_commercial: isVisibleCommercial ?? true,
    is_visible_fashion: isVisibleFashion ?? true,
  });
}

/**
 * Models for client view, filtered by client type (fashion/commercial) and optional category.
 * @param {string} [category] - One of 'Fashion' | 'High Fashion' | 'Commercial'. Empty = all.
 */
export async function getModelsForClient(clientType, countryCode, city, category) {
  const cat = category || undefined;
  const list = countryCode
    ? await getModelsForClientFromSupabaseHybridLocation(clientType, countryCode, city ?? undefined, cat)
    : await getModelsForClientFromSupabase(clientType, cat);
  return list.map((m) => ({
    id: m.id,
    name: m.name,
    city: m.city,
    hasRealLocation: Boolean(m.has_real_location ?? m.country_code),
    countryCode: Boolean(m.has_real_location ?? m.country_code)
      ? (m.country_code ?? null)
      : (m.territory_country_code ?? null),
    hairColor: m.hair_color,
    height: m.height,
    bust: m.bust ?? 0,
    waist: m.waist ?? 0,
    hips: m.hips ?? 0,
    gallery: m.portfolio_images || [],
    polaroids: m.polaroids || [],
    isVisibleCommercial: m.is_visible_commercial,
    isVisibleFashion: m.is_visible_fashion,
    categories: m.categories ?? null,
    agencyId: m.territory_agency_id ?? m.agency_id ?? null,
    agencyName: m.agency_name || null,
  }));
}

/**
 * All models for agency view (traction, visibility toggles).
 */
export async function getAgencyModels(agencyId) {
  const list = agencyId
    ? await getModelsForAgencyFromSupabase(agencyId)
    : await getModelsFromSupabase();
  return list.map((m) => ({
    id: m.id,
    name: m.name,
    traction: 0,
    isVisibleCommercial: m.is_visible_commercial,
    isVisibleFashion: m.is_visible_fashion,
  }));
}
