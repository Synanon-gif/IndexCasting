/**
 * Tests for Phase 3A.1 — Public Agency Profile
 *
 * Covers:
 * - getPublicAgencyProfile: valid slug + is_public=true → returns profile data
 * - getPublicAgencyProfile: slug matched but RPC returns empty (is_public=false) → null
 * - getPublicAgencyProfile: unknown slug → null
 * - getPublicAgencyProfile: empty slug → null without calling RPC
 * - getPublicAgencyProfile: RPC error → null
 * - getPublicAgencyModels: returns only public fields (id, name, sex, cover_url)
 * - getPublicAgencyModels: empty result → []
 * - getPublicAgencyModels: empty agencyId → [] without calling RPC
 * - getPublicAgencyModels: RPC error → []
 * - getPublicAgencySlugFromPath: correct slug extraction from /agency/my-slug
 * - getPublicAgencySlugFromPath: /terms, /, /agency/ → null
 * - getPublicAgencySlugFromPath: trailing slashes stripped
 *
 * Post-migration: get_public_agency_models RPC requires public agency profile
 * server-side; service maps empty RPC results to []. Whitespace-only slug guard
 * matches deployed SQL trim behavior.
 */

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockRpc = jest.fn();

jest.mock('../../../lib/supabase', () => ({
  supabase: {
    rpc: mockRpc,
  },
}));

// ─── Imports (after mocks) ────────────────────────────────────────────────────

import {
  getPublicAgencyProfile,
  getPublicAgencyModels,
} from '../publicAgencyProfileSupabase';
import { getPublicAgencySlugFromPath } from '../../utils/publicLegalRoutes';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const MOCK_PROFILE_ROW = {
  organization_id: 'org-uuid-111',
  agency_id:       'agency-uuid-222',
  name:            'Elite Models',
  logo_url:        'https://example.com/logo.jpg',
  description:     'Premier model agency.',
  address_line_1:  '10 Fashion St',
  city:            'Paris',
  postal_code:     '75001',
  country:         'France',
  website_url:     'https://elite-models.com',
};

const MOCK_MODEL_ROW = {
  id:        'model-uuid-333',
  name:      'Anna Smith',
  sex:       'female',
  cover_url: 'https://example.com/covers/anna.jpg',
};

// ─── getPublicAgencyProfile ───────────────────────────────────────────────────

describe('getPublicAgencyProfile', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('returns profile data when slug matches and is_public=true (RPC returns row)', async () => {
    mockRpc.mockResolvedValueOnce({ data: [MOCK_PROFILE_ROW], error: null });

    const result = await getPublicAgencyProfile('elite-models');

    expect(result).not.toBeNull();
    expect(result?.organization_id).toBe('org-uuid-111');
    expect(result?.agency_id).toBe('agency-uuid-222');
    expect(result?.name).toBe('Elite Models');
    expect(result?.logo_url).toBe('https://example.com/logo.jpg');
    expect(result?.description).toBe('Premier model agency.');
    expect(result?.website_url).toBe('https://elite-models.com');
    expect(mockRpc).toHaveBeenCalledWith('get_public_agency_profile', { p_slug: 'elite-models' });
  });

  test('returns null when RPC returns empty array (is_public=false or wrong type)', async () => {
    mockRpc.mockResolvedValueOnce({ data: [], error: null });

    const result = await getPublicAgencyProfile('private-agency');

    expect(result).toBeNull();
  });

  test('returns null when slug is not found (RPC returns null)', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: null });

    const result = await getPublicAgencyProfile('unknown-slug-xyz');

    expect(result).toBeNull();
  });

  test('returns null and does not call RPC when slug is empty string', async () => {
    const result = await getPublicAgencyProfile('');

    expect(result).toBeNull();
    expect(mockRpc).not.toHaveBeenCalled();
  });

  test('returns null and does not call RPC when slug is whitespace only', async () => {
    const result = await getPublicAgencyProfile('   \t  ');

    expect(result).toBeNull();
    expect(mockRpc).not.toHaveBeenCalled();
  });

  test('returns null when RPC returns an error', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: 'rpc error' } });

    const result = await getPublicAgencyProfile('broken-agency');

    expect(result).toBeNull();
  });

  test('does NOT expose contact_email or contact_phone (not in type)', async () => {
    // The RPC row intentionally has no contact_email/contact_phone
    mockRpc.mockResolvedValueOnce({ data: [MOCK_PROFILE_ROW], error: null });

    const result = await getPublicAgencyProfile('elite-models');

    // TypeScript interface does not include these fields — verify at runtime too
    expect(result).not.toHaveProperty('contact_email');
    expect(result).not.toHaveProperty('contact_phone');
    expect(result).not.toHaveProperty('slug');
    expect(result).not.toHaveProperty('is_public');
  });
});

// ─── getPublicAgencyModels ────────────────────────────────────────────────────

describe('getPublicAgencyModels', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('returns public model fields only (id, name, sex, cover_url)', async () => {
    mockRpc.mockResolvedValueOnce({ data: [MOCK_MODEL_ROW], error: null });

    const result = await getPublicAgencyModels('agency-uuid-222');

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      id:        'model-uuid-333',
      name:      'Anna Smith',
      sex:       'female',
      cover_url: 'https://example.com/covers/anna.jpg',
    });
    expect(mockRpc).toHaveBeenCalledWith('get_public_agency_models', {
      p_agency_id: 'agency-uuid-222',
    });
  });

  test('returns [] when RPC returns empty array (no models)', async () => {
    mockRpc.mockResolvedValueOnce({ data: [], error: null });

    const result = await getPublicAgencyModels('agency-uuid-222');

    expect(result).toEqual([]);
  });

  test('returns [] when hardened RPC yields no rows (non-public or missing public profile)', async () => {
    mockRpc.mockResolvedValueOnce({ data: [], error: null });

    const result = await getPublicAgencyModels('agency-private-no-public-profile');

    expect(result).toEqual([]);
  });

  test('returns [] when hardened RPC yields no rows for unknown agency id', async () => {
    mockRpc.mockResolvedValueOnce({ data: [], error: null });

    const result = await getPublicAgencyModels('00000000-0000-0000-0000-000000000099');

    expect(result).toEqual([]);
  });

  test('returns [] and does not call RPC when agencyId is empty', async () => {
    const result = await getPublicAgencyModels('');

    expect(result).toEqual([]);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  test('returns [] when RPC returns an error', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: 'rpc error' } });

    const result = await getPublicAgencyModels('agency-uuid-222');

    expect(result).toEqual([]);
  });

  test('handles model with null sex and null cover_url gracefully', async () => {
    mockRpc.mockResolvedValueOnce({
      data: [{ id: 'model-uuid-444', name: 'Pat Lee', sex: null, cover_url: null }],
      error: null,
    });

    const result = await getPublicAgencyModels('agency-uuid-222');

    expect(result[0]).toEqual({ id: 'model-uuid-444', name: 'Pat Lee', sex: null, cover_url: null });
  });
});

// ─── getPublicAgencySlugFromPath ──────────────────────────────────────────────

describe('getPublicAgencySlugFromPath', () => {
  test('extracts slug from /agency/my-slug', () => {
    expect(getPublicAgencySlugFromPath('/agency/my-slug')).toBe('my-slug');
  });

  test('extracts slug with underscores and numbers', () => {
    expect(getPublicAgencySlugFromPath('/agency/elite_models_2026')).toBe('elite_models_2026');
  });

  test('returns null for /agency/ (no slug)', () => {
    expect(getPublicAgencySlugFromPath('/agency/')).toBeNull();
  });

  test('returns null for /agency (no trailing slug)', () => {
    expect(getPublicAgencySlugFromPath('/agency')).toBeNull();
  });

  test('returns null for /terms', () => {
    expect(getPublicAgencySlugFromPath('/terms')).toBeNull();
  });

  test('returns null for / (root)', () => {
    expect(getPublicAgencySlugFromPath('/')).toBeNull();
  });

  test('returns null for empty string', () => {
    expect(getPublicAgencySlugFromPath('')).toBeNull();
  });

  test('handles trailing slash on slug path', () => {
    // /agency/my-slug/ → trailing slash stripped → matches
    expect(getPublicAgencySlugFromPath('/agency/my-slug/')).toBe('my-slug');
  });
});
