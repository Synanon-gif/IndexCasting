/**
 * Canonical radius defaults for Near Me and city-search proximity inclusion.
 * Keep in sync with get_models_near_location / get_discovery_models defaults on the DB.
 */
export const NEAR_ME_RADIUS_KM_DEFAULT = 50;
export const CITY_SEARCH_RADIUS_KM_DEFAULT = 50;
/** Optional extended radius for future UI / power-user flows — not wired by default. */
export const LOCATION_RADIUS_KM_EXTENDED_MAX = 100;
