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
import {
  getClientVisiblePortfolioUrlsFromModelPhotos,
  getFirstClientVisiblePortfolioUrlForModels,
} from './modelPhotosSupabase';
import { normalizeDocumentspicturesModelImageRef } from '../utils/normalizeModelPortfolioUrl';

const availabilityOverrides = new Map();

/**
 * Full model data: portfolio, calendar blocks, measurements.
 */
export async function getModelData(id) {
  const base = await getModelByIdFromSupabase(id);
  if (!base) return null;

  const blocked = availabilityOverrides.has(id)
    ? availabilityOverrides.get(id).blocked
    : [];
  const available = availabilityOverrides.has(id)
    ? availabilityOverrides.get(id).available
    : [];

  let portfolioSources = base.portfolio_images || [];
  // Align with get_discovery_models / §27.1: when mirror is empty but model_photos has visible rows.
  if (!portfolioSources.length) {
    try {
      portfolioSources = await getClientVisiblePortfolioUrlsFromModelPhotos(id);
    } catch (e) {
      console.error('getModelData: model_photos portfolio fallback failed', e);
      portfolioSources = [];
    }
  }

  return {
    id: base.id,
    name: base.name,
    measurements: {
      height: base.height,
      chest: base.chest ?? base.bust,
      waist: base.waist,
      hips: base.hips,
    },
    portfolio: {
      images: portfolioSources.map((u) =>
        normalizeDocumentspicturesModelImageRef(u, base.id),
      ),
      // Discovery NEVER shows polaroids — enforced here and at RLS level.
      // Polaroids are only accessible via Polaroid Packages (get_guest_link_models RPC, type='polaroid').
      polaroids: [],
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
 * Models for client view.
 * @param {'fashion'|'commercial'|'all'} clientType - 'all' = no visibility restriction.
 * @param {string} [countryCode] - ISO-2 country code to filter by territory / real location.
 * @param {string} [city] - Free-text city filter (requires countryCode).
 * @param {string} [category] - One of 'Fashion' | 'High Fashion' | 'Commercial'. Empty = all.
 * @param {boolean} [sportsWinter] - Filter to models with is_sports_winter = true.
 * @param {boolean} [sportsSummer] - Filter to models with is_sports_summer = true.
 * @param {object} [measurementFilters] - Height range, hair color, hips/waist/chest/inseam ranges.
 */
export async function getModelsForClient(
  clientType,
  countryCode,
  city,
  category,
  sportsWinter,
  sportsSummer,
  measurementFilters = {},
  citySearchLat = undefined,
  citySearchLng = undefined,
  citySearchRadiusKm = undefined,
) {
  const ct = clientType || 'all';
  const cat = category || undefined;
  const sw = sportsWinter || undefined;
  const ss = sportsSummer || undefined;
  const mf = {
    heightMin: measurementFilters.heightMin || undefined,
    heightMax: measurementFilters.heightMax || undefined,
    hairColor: measurementFilters.hairColor || undefined,
    hipsMin: measurementFilters.hipsMin || undefined,
    hipsMax: measurementFilters.hipsMax || undefined,
    waistMin: measurementFilters.waistMin || undefined,
    waistMax: measurementFilters.waistMax || undefined,
    chestMin: measurementFilters.chestMin || undefined,
    chestMax: measurementFilters.chestMax || undefined,
    legsInseamMin: measurementFilters.legsInseamMin || undefined,
    legsInseamMax: measurementFilters.legsInseamMax || undefined,
    sex: measurementFilters.sex || undefined,
  };
  const hasMF = Object.values(mf).some(Boolean);
  const list = countryCode
    ? await getModelsForClientFromSupabaseHybridLocation(
        ct,
        countryCode,
        city ?? undefined,
        cat,
        sw,
        ss,
        hasMF ? mf : undefined,
        citySearchLat ?? null,
        citySearchLng ?? null,
        citySearchRadiusKm ?? null,
      )
    : await getModelsForClientFromSupabase(ct, cat, sw, ss, hasMF ? mf : undefined);
  const mapped = list.map((m) => ({
    id: m.id,
    name: m.name,
    city: m.effective_city ?? m.city ?? '',
    hasRealLocation: Boolean(m.has_real_location ?? m.country_code),
    countryCode: Boolean(m.has_real_location ?? m.country_code)
      ? (m.country_code ?? null)
      : (m.territory_country_code ?? null),
    hairColor: m.hair_color,
    height: m.height,
    bust: m.bust ?? 0,
    chest: m.chest ?? m.bust ?? 0,
    waist: m.waist ?? 0,
    hips: m.hips ?? 0,
    legsInseam: m.legs_inseam ?? 0,
    gallery: m.portfolio_images || [],
    polaroids: [],
    isVisibleCommercial: m.is_visible_commercial,
    isVisibleFashion: m.is_visible_fashion,
    categories: m.categories ?? null,
    isSportsWinter: m.is_sports_winter ?? false,
    isSportsSummer: m.is_sports_summer ?? false,
    sex: m.sex ?? null,
    agencyId: m.territory_agency_id ?? m.agency_id ?? null,
    agencyName: m.agency_name || null,
  }));
  const emptyGalleryIds = mapped.filter((row) => !(row.gallery && row.gallery.length)).map((row) => row.id);
  if (!emptyGalleryIds.length) return mapped;
  let fallbackMap;
  try {
    fallbackMap = await getFirstClientVisiblePortfolioUrlForModels(emptyGalleryIds);
  } catch (e) {
    console.error('getModelsForClient: portfolio fallback batch failed', e);
    return mapped;
  }
  return mapped.map((row) => {
    if (row.gallery && row.gallery.length) return row;
    const u = fallbackMap.get(row.id);
    return u ? { ...row, gallery: [u] } : row;
  });
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
