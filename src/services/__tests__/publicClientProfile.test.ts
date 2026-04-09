/**
 * Tests for Phase 3B.1 — Public Client Profile
 *
 * Covers:
 * - getPublicClientProfile: valid slug + is_public=true → returns profile data
 * - getPublicClientProfile: slug matched but RPC returns empty (is_public=false) → null
 * - getPublicClientProfile: unknown slug → null
 * - getPublicClientProfile: empty slug → null without calling RPC
 * - getPublicClientProfile: RPC error → null
 * - getPublicClientProfile: allowlist only (no contact_email, contact_phone, slug, is_public)
 * - getPublicClientGallery: returns only client_gallery fields (id, image_url, title, sort_order)
 * - getPublicClientGallery: empty result → []
 * - getPublicClientGallery: empty organizationId → [] without calling RPC
 * - getPublicClientGallery: RPC error → []
 * - getPublicClientGallery: handles null title gracefully
 * - getPublicClientSlugFromPath: /client/my-client → 'my-client'
 * - getPublicClientSlugFromPath: /client/, /client, /, /agency/foo → null
 * - getPublicClientSlugFromPath: trailing slashes stripped
 * - getPublicClientSlugFromPath: slug with numbers and hyphens
 *
 * RLS guards (is_public=true AND type='client') are enforced server-side by the
 * SECURITY DEFINER RPC. These tests verify the TypeScript service contracts.
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
  getPublicClientProfile,
  getPublicClientGallery,
} from '../publicClientProfileSupabase';
import { getPublicClientSlugFromPath } from '../../utils/publicLegalRoutes';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const MOCK_PROFILE_ROW = {
  organization_id: 'org-uuid-client-111',
  name:            'Acme Couture',
  logo_url:        'https://example.com/client-logo.jpg',
  description:     'A premier fashion client.',
  address_line_1:  '5 Rue de la Mode',
  city:            'Milan',
  postal_code:     '20121',
  country:         'Italy',
  website_url:     'https://acme-couture.com',
};

const MOCK_GALLERY_ROW = {
  id:         'media-uuid-444',
  image_url:  'https://example.com/gallery/img1.jpg',
  title:      'Campaign 2026',
  sort_order: 0,
};

// ─── getPublicClientProfile ───────────────────────────────────────────────────

describe('getPublicClientProfile', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('returns profile data when slug matches and is_public=true (RPC returns row)', async () => {
    mockRpc.mockResolvedValueOnce({ data: [MOCK_PROFILE_ROW], error: null });

    const result = await getPublicClientProfile('acme-couture');

    expect(result).not.toBeNull();
    expect(result?.organization_id).toBe('org-uuid-client-111');
    expect(result?.name).toBe('Acme Couture');
    expect(result?.logo_url).toBe('https://example.com/client-logo.jpg');
    expect(result?.description).toBe('A premier fashion client.');
    expect(result?.city).toBe('Milan');
    expect(result?.website_url).toBe('https://acme-couture.com');
    expect(mockRpc).toHaveBeenCalledWith('get_public_client_profile', { p_slug: 'acme-couture' });
  });

  test('returns null when RPC returns empty array (is_public=false or wrong type)', async () => {
    mockRpc.mockResolvedValueOnce({ data: [], error: null });

    const result = await getPublicClientProfile('private-client');

    expect(result).toBeNull();
  });

  test('returns null when slug is not found (RPC returns null)', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: null });

    const result = await getPublicClientProfile('unknown-slug-xyz');

    expect(result).toBeNull();
  });

  test('returns null and does not call RPC when slug is empty string', async () => {
    const result = await getPublicClientProfile('');

    expect(result).toBeNull();
    expect(mockRpc).not.toHaveBeenCalled();
  });

  test('returns null when RPC returns an error', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: 'rpc error' } });

    const result = await getPublicClientProfile('broken-client');

    expect(result).toBeNull();
  });

  test('does NOT expose contact_email, contact_phone, slug, or is_public', async () => {
    mockRpc.mockResolvedValueOnce({ data: [MOCK_PROFILE_ROW], error: null });

    const result = await getPublicClientProfile('acme-couture');

    expect(result).not.toHaveProperty('contact_email');
    expect(result).not.toHaveProperty('contact_phone');
    expect(result).not.toHaveProperty('slug');
    expect(result).not.toHaveProperty('is_public');
  });

  test('handles partial profile data gracefully (nulls)', async () => {
    mockRpc.mockResolvedValueOnce({
      data: [{
        organization_id: 'org-uuid-min',
        name:            'Minimal Client',
        logo_url:        null,
        description:     null,
        address_line_1:  null,
        city:            null,
        postal_code:     null,
        country:         null,
        website_url:     null,
      }],
      error: null,
    });

    const result = await getPublicClientProfile('minimal-client');

    expect(result).not.toBeNull();
    expect(result?.name).toBe('Minimal Client');
    expect(result?.logo_url).toBeNull();
    expect(result?.description).toBeNull();
    expect(result?.website_url).toBeNull();
  });
});

// ─── getPublicClientGallery ───────────────────────────────────────────────────

describe('getPublicClientGallery', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('returns gallery fields (id, image_url, title, sort_order) for valid org', async () => {
    mockRpc.mockResolvedValueOnce({ data: [MOCK_GALLERY_ROW], error: null });

    const result = await getPublicClientGallery('org-uuid-client-111');

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      id:         'media-uuid-444',
      image_url:  'https://example.com/gallery/img1.jpg',
      title:      'Campaign 2026',
      sort_order: 0,
    });
    expect(mockRpc).toHaveBeenCalledWith('get_public_client_gallery', {
      p_organization_id: 'org-uuid-client-111',
    });
  });

  test('returns [] when RPC returns empty array (no gallery images)', async () => {
    mockRpc.mockResolvedValueOnce({ data: [], error: null });

    const result = await getPublicClientGallery('org-uuid-client-111');

    expect(result).toEqual([]);
  });

  test('returns [] and does not call RPC when organizationId is empty', async () => {
    const result = await getPublicClientGallery('');

    expect(result).toEqual([]);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  test('returns [] when RPC returns an error', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: 'rpc error' } });

    const result = await getPublicClientGallery('org-uuid-client-111');

    expect(result).toEqual([]);
  });

  test('handles item with null title gracefully', async () => {
    mockRpc.mockResolvedValueOnce({
      data: [{ id: 'media-uuid-555', image_url: 'https://example.com/img2.jpg', title: null, sort_order: 1 }],
      error: null,
    });

    const result = await getPublicClientGallery('org-uuid-client-111');

    expect(result[0].title).toBeNull();
    expect(result[0].image_url).toBe('https://example.com/img2.jpg');
    expect(result[0].sort_order).toBe(1);
  });

  test('returns [] when RPC returns null data', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: null });

    const result = await getPublicClientGallery('org-uuid-client-111');

    expect(result).toEqual([]);
  });

  test('returns multiple gallery items correctly', async () => {
    mockRpc.mockResolvedValueOnce({
      data: [
        { id: 'media-1', image_url: 'https://example.com/a.jpg', title: 'A', sort_order: 0 },
        { id: 'media-2', image_url: 'https://example.com/b.jpg', title: null, sort_order: 1 },
        { id: 'media-3', image_url: 'https://example.com/c.jpg', title: 'C', sort_order: 2 },
      ],
      error: null,
    });

    const result = await getPublicClientGallery('org-uuid-client-111');

    expect(result).toHaveLength(3);
    expect(result[1].title).toBeNull();
    expect(result[2].sort_order).toBe(2);
  });
});

// ─── getPublicClientSlugFromPath ──────────────────────────────────────────────

describe('getPublicClientSlugFromPath', () => {
  test('extracts slug from /client/my-client', () => {
    expect(getPublicClientSlugFromPath('/client/my-client')).toBe('my-client');
  });

  test('extracts slug with numbers and hyphens', () => {
    expect(getPublicClientSlugFromPath('/client/acme-couture-2026')).toBe('acme-couture-2026');
  });

  test('extracts slug with underscores', () => {
    expect(getPublicClientSlugFromPath('/client/some_client_org')).toBe('some_client_org');
  });

  test('returns null for /client/ (no slug)', () => {
    expect(getPublicClientSlugFromPath('/client/')).toBeNull();
  });

  test('returns null for /client (no trailing slug)', () => {
    expect(getPublicClientSlugFromPath('/client')).toBeNull();
  });

  test('returns null for / (root)', () => {
    expect(getPublicClientSlugFromPath('/')).toBeNull();
  });

  test('returns null for /terms', () => {
    expect(getPublicClientSlugFromPath('/terms')).toBeNull();
  });

  test('returns null for /agency/some-slug (agency route, not client)', () => {
    expect(getPublicClientSlugFromPath('/agency/some-slug')).toBeNull();
  });

  test('returns null for empty string', () => {
    expect(getPublicClientSlugFromPath('')).toBeNull();
  });

  test('handles trailing slash on slug path', () => {
    // /client/my-client/ → trailing slash stripped → matches
    expect(getPublicClientSlugFromPath('/client/my-client/')).toBe('my-client');
  });

  test('returns null for /privacy', () => {
    expect(getPublicClientSlugFromPath('/privacy')).toBeNull();
  });
});
