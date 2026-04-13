/**
 * Client Discovery Service (v2)
 *
 * Wraps the SECURITY DEFINER RPCs from migration_client_model_interactions_v2.sql.
 *
 * New in v2:
 *   • DISCOVERY_WEIGHTS   — centralised scoring config; mirrors DB weights.
 *   • withRetry           — 1-2 retries on network failure, non-blocking.
 *   • loadSessionIds /
 *     saveSessionId /
 *     clearSessionIds     — localStorage-backed session persistence.
 *   • applyDiversityShuffle — tier-based shuffle for variety.
 *   • DiscoveryCursor /
 *     getDiscoveryModels  — cursor-based pagination (score + model_id keyset).
 */

import { supabase } from '../../lib/supabase';
import type { ClientMeasurementFilters } from './modelsSupabase';

// ─── Scoring weights ──────────────────────────────────────────────────────────

/**
 * Centralised scoring weights — must mirror the CASE expressions inside the
 * get_discovery_models RPC. Update both when tuning.
 */
export const DISCOVERY_WEIGHTS = {
  neverSeen: 50,
  sameCity: 30,
  recentActive: 20,
  seenPenalty: -10,
  rejectedPenalty: -40,
} as const;

// ─── Types ────────────────────────────────────────────────────────────────────

export type InteractionAction = 'viewed' | 'rejected' | 'booked';

export type DiscoveryModel = {
  id: string;
  name: string;
  city: string | null;
  country_code: string | null;
  height: number;
  bust: number | null;
  waist: number | null;
  hips: number | null;
  chest: number | null;
  legs_inseam: number | null;
  portfolio_images: string[];
  hair_color: string | null;
  is_visible_fashion: boolean;
  is_visible_commercial: boolean;
  is_sports_winter: boolean;
  is_sports_summer: boolean;
  sex: 'male' | 'female' | null;
  ethnicity: string | null;
  categories: string[] | null;
  agency_id: string | null;
  created_at: string | null;
  updated_at: string | null;
  territory_country_code: string | null;
  agency_name: string | null;
  territory_agency_id: string | null;
  discovery_score: number;
  /** Canonical city from model_locations (live>current>agency), falls back to models.city when NULL. */
  effective_city?: string | null;
};

export type DiscoveryFilters = ClientMeasurementFilters & {
  /** ISO-2 country code — required for territory-based discovery. */
  countryCode: string;
  /** Resolved city for the +30 location boost (approximate, privacy-safe). */
  clientCity?: string | null;
  /** Hard city filter — case-insensitive substring match on effective_city. */
  city?: string | null;
  category?: string | null;
  sportsWinter?: boolean;
  sportsSummer?: boolean;
};

/**
 * Opaque cursor for keyset pagination.
 * Extracted from the last model in a result page; pass to the next call.
 */
export type DiscoveryCursor = { score: number; modelId: string } | null;

/** Page size used for all paginated discovery calls. */
export const DISCOVERY_PAGE_SIZE = 50;

// ─── Retry helper ─────────────────────────────────────────────────────────────

/**
 * Retries an async function up to `maxRetries` times on exception.
 * Uses linear back-off (300 ms * attempt). Does NOT retry on application-level
 * errors (e.g. Supabase RPC returning { error }); those are handled by callers.
 */
async function withRetry<T>(fn: () => Promise<T>, maxRetries: number = 2): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e;
      if (attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
      }
    }
  }
  throw lastError;
}

// ─── Session persistence (localStorage) ──────────────────────────────────────

const SESSION_KEY = (orgId: string) => `discovery_session_seen_${orgId}`;

/** Loads the set of model IDs seen in the current discovery session from localStorage. */
export function loadSessionIds(clientOrgId: string): Set<string> {
  try {
    if (typeof localStorage === 'undefined') return new Set();
    const raw = localStorage.getItem(SESSION_KEY(clientOrgId));
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set<string>(parsed);
  } catch {
    return new Set();
  }
}

/** Adds a single model ID to the persisted session set. */
export function saveSessionId(clientOrgId: string, modelId: string): void {
  try {
    if (typeof localStorage === 'undefined') return;
    const existing = loadSessionIds(clientOrgId);
    existing.add(modelId);
    localStorage.setItem(SESSION_KEY(clientOrgId), JSON.stringify(Array.from(existing)));
  } catch {
    // localStorage write failures (e.g. private mode quota) are non-fatal.
  }
}

/** Removes the persisted session set for this org (call on filter change). */
export function clearSessionIds(clientOrgId: string): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem(SESSION_KEY(clientOrgId));
  } catch {
    // Non-fatal.
  }
}

// ─── Diversity shuffle ────────────────────────────────────────────────────────

/**
 * Groups models into three score tiers and Fisher-Yates shuffles within
 * each tier, then re-concatenates Tier1 → Tier2 → Tier3.
 *
 * Tier 1: score >= DISCOVERY_WEIGHTS.neverSeen  (50+)
 * Tier 2: 0 ≤ score < neverSeen
 * Tier 3: score < 0  (previously rejected / seen)
 *
 * This prevents the same agency's models from appearing in a run, while
 * preserving the overall score ordering across tiers.
 */
export function applyDiversityShuffle(models: DiscoveryModel[]): DiscoveryModel[] {
  const threshold = DISCOVERY_WEIGHTS.neverSeen;

  const tier1 = models.filter((m) => m.discovery_score >= threshold);
  const tier2 = models.filter((m) => m.discovery_score >= 0 && m.discovery_score < threshold);
  const tier3 = models.filter((m) => m.discovery_score < 0);

  return [...fisherYates(tier1), ...fisherYates(tier2), ...fisherYates(tier3)];
}

function fisherYates<T>(arr: T[]): T[] {
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

// ─── Platform access guard ────────────────────────────────────────────────────

/**
 * Throws if the current user does not have active platform access
 * (no valid trial or subscription). Mirrors assertPlatformAccess in
 * modelsSupabase.ts but kept local to avoid a circular import.
 */
async function assertPlatformAccess(): Promise<void> {
  const { data, error } = await supabase.rpc('can_access_platform');
  if (error) {
    console.error('[clientDiscovery] assertPlatformAccess RPC error:', error);
    throw new Error('platform_access_check_failed');
  }
  const result = data as { allowed: boolean; reason?: string } | null;
  if (!result?.allowed) {
    throw Object.assign(new Error('platform_access_denied'), {
      code: 'platform_access_denied',
      reason: result?.reason ?? 'unknown',
    });
  }
}

// ─── recordInteraction ────────────────────────────────────────────────────────

/**
 * Records a viewed / rejected / booked interaction for the current user's
 * client organisation. Retries up to 2 times on network failure.
 * Never throws — failures are logged but do not block the UI.
 */
export async function recordInteraction(modelId: string, action: InteractionAction): Promise<void> {
  try {
    await withRetry(async () => {
      const { error } = await supabase.rpc('record_client_interaction', {
        p_model_id: modelId,
        p_action: action,
      });
      if (error) {
        // Application-level error (e.g. not a client org member): do not retry.
        console.error('recordInteraction error:', error);
        return;
      }
    });
  } catch (e) {
    console.error('recordInteraction failed after retries:', e);
  }
}

// ─── getDiscoveryModels ───────────────────────────────────────────────────────

/**
 * Returns a ranked, filtered, diversity-shuffled list of models for discovery.
 *
 * Scoring weights (mirrors get_discovery_models RPC):
 *   +50  never seen by this organisation
 *   +30  model city matches client city
 *   +20  model created / updated in last 30 days
 *   -10  already viewed
 *   -40  previously rejected (after cooldown)
 *
 * Hard exclusions:
 *   • rejected within p_reject_hours (default 24 h)
 *   • booked within p_book_days (default 7 days)
 *   • IDs in sessionSeenIds
 *
 * Pagination:
 *   Pass the returned `nextCursor` as the `cursor` parameter of the next call
 *   to page through results without duplicates (keyset pagination).
 *   First call: cursor = null.
 *
 * Returns { models: [], nextCursor: null } on any error.
 */
export async function getDiscoveryModels(
  clientOrgId: string,
  filters: DiscoveryFilters,
  cursor: DiscoveryCursor = null,
  sessionSeenIds: Set<string> = new Set(),
  rejectHours: number = 24,
  bookDays: number = 7,
): Promise<{ models: DiscoveryModel[]; nextCursor: DiscoveryCursor }> {
  if (!clientOrgId) {
    console.warn('getDiscoveryModels: clientOrgId is required');
    return { models: [], nextCursor: null };
  }
  if (!filters.countryCode?.trim()) {
    console.warn('getDiscoveryModels: countryCode is required for ranked discovery');
    return { models: [], nextCursor: null };
  }

  // Frontend paywall check (belt-and-suspenders; the RPC enforces it server-side too).
  try {
    await assertPlatformAccess();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (e: any) {
    if (e?.code === 'platform_access_denied') {
      return { models: [], nextCursor: null };
    }
    throw e;
  }

  const excludeIds: string[] = Array.from(sessionSeenIds);

  try {
    const { data, error } = await supabase.rpc('get_discovery_models', {
      p_client_org_id: clientOrgId,
      p_iso: filters.countryCode.trim().toUpperCase(),
      p_client_type: 'all',
      // Legacy OFFSET params — used when cursor is null.
      p_from: 0,
      p_to: DISCOVERY_PAGE_SIZE - 1,
      // Location
      p_client_city: filters.clientCity?.trim() ?? null,
      // Category
      p_category: filters.category ?? null,
      // Sports
      p_sports_winter: filters.sportsWinter ?? false,
      p_sports_summer: filters.sportsSummer ?? false,
      // Measurements
      p_height_min: filters.heightMin ?? null,
      p_height_max: filters.heightMax ?? null,
      p_hair_color: filters.hairColor ?? null,
      p_hips_min: filters.hipsMin ?? null,
      p_hips_max: filters.hipsMax ?? null,
      p_waist_min: filters.waistMin ?? null,
      p_waist_max: filters.waistMax ?? null,
      p_chest_min: filters.chestMin ?? null,
      p_chest_max: filters.chestMax ?? null,
      p_legs_inseam_min: filters.legsInseamMin ?? null,
      p_legs_inseam_max: filters.legsInseamMax ?? null,
      p_sex: filters.sex ?? null,
      p_ethnicities: filters.ethnicities?.length ? filters.ethnicities : null,
      // Hard city filter (case-insensitive substring on effective_city)
      p_city: filters.city?.trim() || null,
      // Session dedup
      p_exclude_ids: excludeIds.length ? excludeIds : null,
      // Cooldown
      p_reject_hours: rejectHours,
      p_book_days: bookDays,
      // Cursor pagination (overrides OFFSET when non-null)
      p_cursor_score: cursor?.score ?? null,
      p_cursor_model_id: cursor?.modelId ?? null,
      p_limit: DISCOVERY_PAGE_SIZE,
    });

    if (error) {
      console.error('getDiscoveryModels RPC error:', error);
      return { models: [], nextCursor: null };
    }

    const models = applyDiversityShuffle((data ?? []) as DiscoveryModel[]);

    const last = models.length > 0 ? models[models.length - 1] : null;
    const nextCursor: DiscoveryCursor =
      last && models.length === DISCOVERY_PAGE_SIZE
        ? { score: last.discovery_score, modelId: last.id }
        : null;

    return { models, nextCursor };
  } catch (e) {
    console.error('getDiscoveryModels exception:', e);
    return { models: [], nextCursor: null };
  }
}
