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
  size: 'all' | 'short' | 'medium' | 'tall';
  location: 'all' | 'Paris' | 'Milan' | 'Berlin' | 'nearby';
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
