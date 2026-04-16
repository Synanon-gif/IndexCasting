/** Type declarations for apiService.js (allowJs inference is too strict for optional trailing args). */

export function getModelData(id: string): Promise<Record<string, unknown> | null>;

export function updateAvailability(
  id: string,
  dates: { blocked?: string[]; available?: string[] },
): Promise<void>;

export function updateModelVisibility(
  id: string,
  opts: { isVisibleCommercial?: boolean; isVisibleFashion?: boolean },
): Promise<unknown>;

export function getModelsForClient(
  clientType: 'fashion' | 'commercial' | 'all',
  countryCode?: string,
  city?: string,
  category?: string,
  sportsWinter?: boolean,
  sportsSummer?: boolean,
  measurementFilters?: Record<string, unknown>,
  citySearchLat?: number | null,
  citySearchLng?: number | null,
  citySearchRadiusKm?: number | null,
): Promise<unknown[]>;

export function getAgencyModels(agencyId: string | null | undefined): Promise<unknown[]>;
