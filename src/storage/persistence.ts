/**
 * LocalStorage persistence for client projects, options, and agency selection.
 * Works in browser and in Capacitor WebView. Safe when localStorage is unavailable (e.g. SSR).
 */

const PREFIX = 'casting_index_';

const KEYS = {
  clientProjects: PREFIX + 'client_projects',
  clientActiveProjectId: PREFIX + 'client_active_project_id',
  clientFilters: PREFIX + 'client_filters',
  clientType: PREFIX + 'client_type',
  agencyProjects: PREFIX + 'agency_projects',
  agencySelectedProjectId: PREFIX + 'agency_selected_project_id',
} as const;

/**
 * All static localStorage keys used across the app (not dynamic/per-org keys).
 * EXPLOIT-M2 fix: must be exhaustive — add new keys here when introduced.
 */
const ALL_STATIC_KEYS = [
  ...Object.values(KEYS),
  // AppDataContext
  'ci_current_user_id',
  // ClientWebApp
  'ci_archived_threads',
  'ci_client_settings',
  'ic_geo_consent_v1',
  // AgencyControllerView
  'ci_agency_archived',
  // store/recruitingChats
  'ci_model_booking_thread_ids',
  // invite / model claim (localStorage on web — sign-out must clear)
  'ic_pending_invite_token',
  'ic_invite_flow_active',
  'ic_pending_model_claim_token',
  'ic_model_claim_flow_active',
] as const;

/**
 * Key prefixes for dynamic per-org or per-agency localStorage entries.
 * Items matching these prefixes are cleared by clearAllPersistence().
 */
const DYNAMIC_KEY_PREFIXES = [
  'discovery_session_seen_',   // clientDiscoverySupabase
  'ic_agency_shortlist_',      // agencyRecruitingShortlist
];

/**
 * Clears all known localStorage and sessionStorage keys for the current user.
 * Must be called on every sign-out path.
 *
 * EXPLOIT-M2 fix: without this, metadata (archived threads, project IDs, filter
 * states, model ID caches) persists for the next user on the same shared device.
 */
export function clearAllPersistence(): void {
  if (!isAvailable()) return;
  try {
    // Clear all static keys
    for (const key of ALL_STATIC_KEYS) {
      window.localStorage.removeItem(key);
    }
    // Clear dynamic keys by prefix
    const allKeys = Object.keys(window.localStorage);
    for (const key of allKeys) {
      if (DYNAMIC_KEY_PREFIXES.some((p) => key.startsWith(p))) {
        window.localStorage.removeItem(key);
      }
    }
    // Clear sessionStorage (invite tokens, guest pending state)
    if (typeof window !== 'undefined' && window.sessionStorage) {
      window.sessionStorage.clear();
    }
  } catch (e) {
    console.error('clearAllPersistence error:', e);
  }
}

function isAvailable(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const k = '__test__';
    window.localStorage.setItem(k, k);
    window.localStorage.removeItem(k);
    return true;
  } catch {
    return false;
  }
}

export function getItem(key: string): string | null {
  if (!isAvailable()) return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function setItem(key: string, value: string): void {
  if (!isAvailable()) return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // ignore
  }
}

// —— Client ——

export type PersistedClientProject = {
  id: string;
  name: string;
  models: Array<{
    id: string;
    name: string;
    city: string;
    hairColor: string;
    height: number;
    bust: number;
    waist: number;
    hips: number;
    coverUrl: string;
  }>;
};

export type PersistedClientFilters = {
  /** Biological sex filter: 'all' | 'male' | 'female' */
  sex?: 'all' | 'male' | 'female';
  /** Numeric height range in cm; empty string = no restriction. */
  heightMin: string;
  heightMax: string;
  /** Multi-select ethnicity filter; empty array = no restriction. */
  ethnicities: string[];
  /** @deprecated use countryCode + city + nearby instead */
  location?: string;
  /** ISO-2 country code, empty string = all countries */
  countryCode: string;
  /** Free-text city filter, empty = all cities */
  city: string;
  /** true = filter by user's detected city */
  nearby: boolean;
  /** Marketing category filter: 'Fashion' | 'High Fashion' | 'Commercial' | '' */
  category: string;
  sportsWinter: boolean;
  sportsSummer: boolean;
  hairColor: string;
  hipsMin: string;
  hipsMax: string;
  waistMin: string;
  waistMax: string;
  chestMin: string;
  chestMax: string;
  legsInseamMin: string;
  legsInseamMax: string;
};

export type ClientType = 'fashion' | 'commercial';

export function loadClientProjects(): PersistedClientProject[] {
  const raw = getItem(KEYS.clientProjects);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as PersistedClientProject[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveClientProjects(projects: PersistedClientProject[]): void {
  setItem(KEYS.clientProjects, JSON.stringify(projects));
}

export function loadClientActiveProjectId(): string | null {
  const raw = getItem(KEYS.clientActiveProjectId);
  return raw || null;
}

export function saveClientActiveProjectId(id: string | null): void {
  if (id) setItem(KEYS.clientActiveProjectId, id);
  else if (isAvailable()) try { window.localStorage.removeItem(KEYS.clientActiveProjectId); } catch { /* ignore */ }
}

export function loadClientFilters(): PersistedClientFilters | null {
  const raw = getItem(KEYS.clientFilters);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PersistedClientFilters;
  } catch {
    return null;
  }
}

export function saveClientFilters(filters: PersistedClientFilters): void {
  setItem(KEYS.clientFilters, JSON.stringify(filters));
}

export function loadClientType(): ClientType | null {
  const raw = getItem(KEYS.clientType);
  if (raw === 'fashion' || raw === 'commercial') return raw;
  return null;
}

export function saveClientType(value: ClientType): void {
  setItem(KEYS.clientType, value);
}

// —— Agency ——

export type PersistedAgencyProject = {
  id: string;
  name: string;
  enabledModelIds: string[];
};

export function loadAgencyProjects(): PersistedAgencyProject[] {
  const raw = getItem(KEYS.agencyProjects);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as PersistedAgencyProject[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveAgencyProjects(projects: PersistedAgencyProject[]): void {
  setItem(KEYS.agencyProjects, JSON.stringify(projects));
}

export function loadAgencySelectedProjectId(): string | null {
  const raw = getItem(KEYS.agencySelectedProjectId);
  return raw || null;
}

export function saveAgencySelectedProjectId(id: string | null): void {
  if (id) setItem(KEYS.agencySelectedProjectId, id);
  else if (isAvailable()) try { window.localStorage.removeItem(KEYS.agencySelectedProjectId); } catch { /* ignore */ }
}
