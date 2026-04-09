/**
 * Tests for Phase 3A.2 + 3A.3 + 3B.2 — Public Agency/Client Settings & Share Link
 *
 * Covers:
 * - validateSlug: valid slugs return null
 * - validateSlug: various invalid inputs return error strings
 * - slugify: raw strings are sanitized into slug candidates
 * - publicAgencyUrl: correct display URL construction
 * - publicAgencyHref: correct https:// URL for clipboard / Linking
 * - shareUrl visibility logic: truthy only when owner + is_public + slug
 * - upsertPublicSettings: assertOrgContext empty → { ok: false } without DB call
 * - upsertPublicSettings: success path → { ok: true }
 * - upsertPublicSettings: 23505 unique violation → { ok: false, slugTaken: true }
 * - upsertPublicSettings: other DB error → { ok: false }
 * - upsertPublicSettings: is_public=true saved correctly
 * - publicClientUrl: correct display URL construction for client profiles (Phase 3B.2)
 * - upsertPublicSettings (client org): same service reused — owner saves slug → ok
 *
 * RLS enforcement (op_owner_update via is_org_owner()) is server-side only.
 */

import {
  validateSlug,
  slugify,
  publicAgencyUrl,
  publicAgencyHref,
  publicClientUrl,
  publicClientHref,
} from '../../utils/orgProfilePublicSettings';
import { upsertPublicSettings } from '../organizationProfilesSupabase';

// ─── Mocks ────────────────────────────────────────────────────────────────────

jest.mock('../../../lib/supabase', () => ({
  supabase: {
    from: jest.fn(),
  },
}));

jest.mock('../../utils/orgGuard', () => ({
  assertOrgContext: jest.fn(),
}));

import { supabase } from '../../../lib/supabase';
import { assertOrgContext } from '../../utils/orgGuard';

const mockAssertOrgContext = assertOrgContext as jest.MockedFunction<typeof assertOrgContext>;
const mockFrom = supabase.from as jest.Mock;

// Shared upsert chain builder
function buildUpsertChain(result: { error: { code?: string; message?: string } | null }) {
  const mockUpsert = jest.fn().mockResolvedValue(result);
  mockFrom.mockReturnValue({ upsert: mockUpsert });
  return { mockUpsert };
}

const ORG_ID = 'org-uuid-123';

// ─── validateSlug ─────────────────────────────────────────────────────────────

describe('validateSlug', () => {
  describe('valid slugs → null', () => {
    it('accepts a simple lowercase slug', () => {
      expect(validateSlug('my-agency')).toBeNull();
    });

    it('accepts a slug with numbers', () => {
      expect(validateSlug('agency-01')).toBeNull();
    });

    it('accepts a slug that is exactly 2 characters', () => {
      expect(validateSlug('ab')).toBeNull();
    });

    it('accepts a slug that is exactly 60 characters', () => {
      expect(validateSlug('a'.repeat(60))).toBeNull();
    });

    it('accepts a slug with mixed letters and numbers', () => {
      expect(validateSlug('vienna-agency-01')).toBeNull();
    });
  });

  describe('invalid slugs → error string', () => {
    it('rejects an empty string', () => {
      expect(validateSlug('')).toBeTruthy();
    });

    it('rejects a string with only spaces', () => {
      expect(validateSlug('   ')).toBeTruthy();
    });

    it('rejects a slug that is too short (1 char or less)', () => {
      // validateSlug requires min 2 characters
      expect(validateSlug('a')).toBeTruthy();
      expect(validateSlug('-')).toBeTruthy();
    });

    it('rejects a slug that is too long (>60 chars)', () => {
      expect(validateSlug('a'.repeat(61))).toBeTruthy();
    });

    it('rejects a slug starting with a hyphen', () => {
      expect(validateSlug('-agency')).toBeTruthy();
    });

    it('rejects a slug ending with a hyphen', () => {
      expect(validateSlug('agency-')).toBeTruthy();
    });

    it('rejects a slug with uppercase letters', () => {
      expect(validateSlug('MyAgency')).toBeTruthy();
    });

    it('rejects a slug with spaces', () => {
      expect(validateSlug('my agency')).toBeTruthy();
    });

    it('rejects a slug with special characters', () => {
      expect(validateSlug('agency_test!')).toBeTruthy();
    });

    it('rejects a slug with a forward slash', () => {
      expect(validateSlug('/agency/foo')).toBeTruthy();
    });
  });
});

// ─── slugify ──────────────────────────────────────────────────────────────────

describe('slugify', () => {
  it('lowercases the input', () => {
    expect(slugify('MyAgency')).toBe('myagency');
  });

  it('replaces spaces with hyphens', () => {
    expect(slugify('My Agency')).toBe('my-agency');
  });

  it('replaces special characters with hyphens and strips trailing hyphens', () => {
    // underscore and ! become hyphens, then trailing hyphens are stripped
    expect(slugify('agency_test!')).toBe('agency-test');
  });

  it('collapses multiple hyphens', () => {
    expect(slugify('my  --  agency')).toBe('my-agency');
  });

  it('strips leading and trailing hyphens', () => {
    expect(slugify('-agency-')).toBe('agency');
  });

  it('truncates to 60 characters', () => {
    const result = slugify('a'.repeat(80));
    expect(result.length).toBeLessThanOrEqual(60);
  });
});

// ─── publicAgencyUrl ──────────────────────────────────────────────────────────

describe('publicAgencyUrl', () => {
  it('returns the correct URL for a valid slug', () => {
    expect(publicAgencyUrl('my-agency')).toBe('index-casting.com/agency/my-agency');
  });

  it('returns null for an empty slug', () => {
    expect(publicAgencyUrl('')).toBeNull();
  });

  it('returns null for null slug', () => {
    expect(publicAgencyUrl(null)).toBeNull();
  });

  it('returns null for undefined slug', () => {
    expect(publicAgencyUrl(undefined)).toBeNull();
  });

  it('trims whitespace before building URL', () => {
    expect(publicAgencyUrl('  my-agency  ')).toBe('index-casting.com/agency/my-agency');
  });
});

// ─── publicAgencyHref ─────────────────────────────────────────────────────────

describe('publicAgencyHref', () => {
  it('returns the correct https:// URL for a valid slug', () => {
    expect(publicAgencyHref('my-agency')).toBe('https://index-casting.com/agency/my-agency');
  });

  it('returns null for an empty slug', () => {
    expect(publicAgencyHref('')).toBeNull();
  });

  it('returns null for null slug', () => {
    expect(publicAgencyHref(null)).toBeNull();
  });

  it('returns null for undefined slug', () => {
    expect(publicAgencyHref(undefined)).toBeNull();
  });

  it('trims whitespace before building URL', () => {
    expect(publicAgencyHref('  vienna-agency  ')).toBe(
      'https://index-casting.com/agency/vienna-agency',
    );
  });

  it('includes https:// prefix (distinct from publicAgencyUrl)', () => {
    const display = publicAgencyUrl('my-agency');
    const href = publicAgencyHref('my-agency');
    expect(href).toBe(`https://${display}`);
  });
});

// ─── shareUrl visibility logic ────────────────────────────────────────────────
//
// The derived shareUrl value in AgencyOrgProfileScreen is:
//   isOwner && orgProfile?.is_public && orgProfile?.slug
//     ? publicAgencyHref(orgProfile.slug) : null
//
// These tests verify that logic in pure form (no rendering needed).

describe('shareUrl visibility logic (derived from publicAgencyHref)', () => {
  function computeShareUrl(
    isOwner: boolean,
    isPublic: boolean | undefined,
    slug: string | null | undefined,
  ): string | null {
    return isOwner && isPublic && slug ? publicAgencyHref(slug) : null;
  }

  it('returns href when owner, is_public=true, slug present', () => {
    expect(computeShareUrl(true, true, 'my-agency')).toBe(
      'https://index-casting.com/agency/my-agency',
    );
  });

  it('returns null when is_public=false (profile not live)', () => {
    expect(computeShareUrl(true, false, 'my-agency')).toBeNull();
  });

  it('returns null when slug is null (not configured)', () => {
    expect(computeShareUrl(true, true, null)).toBeNull();
  });

  it('returns null when slug is empty string', () => {
    expect(computeShareUrl(true, true, '')).toBeNull();
  });

  it('returns null when isOwner=false (booker / model view)', () => {
    expect(computeShareUrl(false, true, 'my-agency')).toBeNull();
  });

  it('returns null when all conditions are false', () => {
    expect(computeShareUrl(false, false, null)).toBeNull();
  });
});

// ─── upsertPublicSettings ─────────────────────────────────────────────────────

describe('upsertPublicSettings', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAssertOrgContext.mockReturnValue(true);
  });

  it('returns { ok: false } immediately when assertOrgContext fails (empty orgId)', async () => {
    mockAssertOrgContext.mockReturnValue(false);
    const result = await upsertPublicSettings('', { is_public: false, slug: null });
    expect(result).toEqual({ ok: false });
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('returns { ok: true } on successful upsert', async () => {
    buildUpsertChain({ error: null });
    const result = await upsertPublicSettings(ORG_ID, {
      is_public: false,
      slug: 'my-agency',
    });
    expect(result).toEqual({ ok: true });
  });

  it('returns { ok: false, slugTaken: true } on 23505 unique violation', async () => {
    buildUpsertChain({ error: { code: '23505', message: 'unique violation' } });
    const result = await upsertPublicSettings(ORG_ID, {
      is_public: false,
      slug: 'taken-slug',
    });
    expect(result).toEqual({ ok: false, slugTaken: true });
  });

  it('returns { ok: false } on other DB error', async () => {
    buildUpsertChain({ error: { code: '42501', message: 'permission denied' } });
    const result = await upsertPublicSettings(ORG_ID, {
      is_public: false,
      slug: 'my-agency',
    });
    expect(result).toEqual({ ok: false });
    expect(result.slugTaken).toBeUndefined();
  });

  it('saves is_public=true correctly', async () => {
    const { mockUpsert } = buildUpsertChain({ error: null });
    const result = await upsertPublicSettings(ORG_ID, {
      is_public: true,
      slug: 'my-agency',
    });
    expect(result).toEqual({ ok: true });
    // Verify the upsert was called with is_public=true and the slug
    const upsertArg = mockUpsert.mock.calls[0][0];
    expect(upsertArg.is_public).toBe(true);
    expect(upsertArg.slug).toBe('my-agency');
    expect(upsertArg.organization_id).toBe(ORG_ID);
  });

  it('saves null slug correctly (clears the slug)', async () => {
    const { mockUpsert } = buildUpsertChain({ error: null });
    const result = await upsertPublicSettings(ORG_ID, {
      is_public: false,
      slug: null,
    });
    expect(result).toEqual({ ok: true });
    const upsertArg = mockUpsert.mock.calls[0][0];
    expect(upsertArg.slug).toBeNull();
  });

  it('includes updated_at in the upsert payload', async () => {
    const { mockUpsert } = buildUpsertChain({ error: null });
    await upsertPublicSettings(ORG_ID, { is_public: false, slug: 'my-agency' });
    const upsertArg = mockUpsert.mock.calls[0][0];
    expect(upsertArg.updated_at).toBeDefined();
    // Should be a valid ISO date string
    expect(() => new Date(upsertArg.updated_at as string)).not.toThrow();
  });

  it('returns { ok: false } when an exception is thrown', async () => {
    mockFrom.mockImplementation(() => {
      throw new Error('network error');
    });
    const result = await upsertPublicSettings(ORG_ID, {
      is_public: false,
      slug: 'my-agency',
    });
    expect(result).toEqual({ ok: false });
  });
});

// ─── publicClientUrl (Phase 3B.2) ─────────────────────────────────────────────

describe('publicClientUrl', () => {
  it('returns index-casting.com/client/<slug> for a valid slug', () => {
    expect(publicClientUrl('my-client')).toBe('index-casting.com/client/my-client');
  });

  it('returns index-casting.com/client/<slug> for slug with hyphens and numbers', () => {
    expect(publicClientUrl('acme-couture-2026')).toBe('index-casting.com/client/acme-couture-2026');
  });

  it('returns null for null slug', () => {
    expect(publicClientUrl(null)).toBeNull();
  });

  it('returns null for undefined slug', () => {
    expect(publicClientUrl(undefined)).toBeNull();
  });

  it('returns null for empty string slug', () => {
    expect(publicClientUrl('')).toBeNull();
  });

  it('trims whitespace before building URL', () => {
    expect(publicClientUrl('  my-client  ')).toBe('index-casting.com/client/my-client');
  });

  it('is distinct from publicAgencyUrl (different base URL)', () => {
    const slug = 'same-slug';
    expect(publicClientUrl(slug)).toBe('index-casting.com/client/same-slug');
    expect(publicAgencyUrl(slug)).toBe('index-casting.com/agency/same-slug');
    expect(publicClientUrl(slug)).not.toBe(publicAgencyUrl(slug));
  });
});

// ─── upsertPublicSettings — client org reuse (Phase 3B.2) ────────────────────

describe('upsertPublicSettings (client org)', () => {
  const CLIENT_ORG_ID = 'client-org-uuid-456';

  beforeEach(() => {
    jest.clearAllMocks();
    mockAssertOrgContext.mockReturnValue(true);
  });

  it('returns { ok: true } when client owner saves is_public=true + slug', async () => {
    buildUpsertChain({ error: null });
    const result = await upsertPublicSettings(CLIENT_ORG_ID, {
      is_public: true,
      slug: 'acme-couture',
    });
    expect(result).toEqual({ ok: true });
    const upsertArg = (supabase.from as jest.Mock).mock.results[0].value.upsert.mock.calls[0][0];
    expect(upsertArg.is_public).toBe(true);
    expect(upsertArg.slug).toBe('acme-couture');
    expect(upsertArg.organization_id).toBe(CLIENT_ORG_ID);
  });

  it('returns { ok: false } when assertOrgContext fails (empty org id — employee guard)', async () => {
    mockAssertOrgContext.mockReturnValue(false);
    const result = await upsertPublicSettings('', {
      is_public: true,
      slug: 'acme-couture',
    });
    expect(result).toEqual({ ok: false });
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('returns { ok: false, slugTaken: true } on 23505 — slug already taken by another org', async () => {
    buildUpsertChain({ error: { code: '23505', message: 'unique violation' } });
    const result = await upsertPublicSettings(CLIENT_ORG_ID, {
      is_public: true,
      slug: 'taken-by-agency',
    });
    expect(result).toEqual({ ok: false, slugTaken: true });
  });

  it('returns { ok: false } on other DB error (not 23505)', async () => {
    buildUpsertChain({ error: { code: '42501', message: 'permission denied' } });
    const result = await upsertPublicSettings(CLIENT_ORG_ID, {
      is_public: false,
      slug: 'acme-couture',
    });
    expect(result).toEqual({ ok: false });
    expect(result.slugTaken).toBeUndefined();
  });

  it('saves null slug (clears slug) when toggling profile to private', async () => {
    const { mockUpsert } = buildUpsertChain({ error: null });
    const result = await upsertPublicSettings(CLIENT_ORG_ID, {
      is_public: false,
      slug: null,
    });
    expect(result).toEqual({ ok: true });
    const upsertArg = mockUpsert.mock.calls[0][0];
    expect(upsertArg.slug).toBeNull();
    expect(upsertArg.is_public).toBe(false);
  });

  it('public preview text: publicClientUrl returns correct preview for draft slug', () => {
    // Simulates what the UI renders in the publicPreviewUrl text
    expect(publicClientUrl('acme-couture')).toBe('index-casting.com/client/acme-couture');
    expect(publicClientUrl('')).toBeNull();
    expect(publicClientUrl(null)).toBeNull();
  });
});

// ─── publicClientHref (Phase 3B.3) ───────────────────────────────────────────

describe('publicClientHref', () => {
  it('returns https:// prefixed URL for a valid slug', () => {
    expect(publicClientHref('my-client')).toBe(
      'https://index-casting.com/client/my-client',
    );
  });

  it('returns null for null slug', () => {
    expect(publicClientHref(null)).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(publicClientHref('')).toBeNull();
  });

  it('returns null for whitespace-only slug', () => {
    expect(publicClientHref('   ')).toBeNull();
  });

  it('trims whitespace before building URL', () => {
    expect(publicClientHref('  brand-co  ')).toBe(
      'https://index-casting.com/client/brand-co',
    );
  });

  it('includes https:// prefix — distinct from publicClientUrl', () => {
    const href = publicClientHref('brand-co');
    const url = publicClientUrl('brand-co');
    expect(href).toContain('https://');
    expect(url).not.toContain('https://');
    expect(href).not.toBe(url);
  });
});

// ─── shareUrl visibility logic (Phase 3B.3) ──────────────────────────────────

describe('shareUrl visibility (client)', () => {
  // Mirrors the derived value logic in ClientOrgProfileScreen:
  // const shareUrl = isOwner && orgProfile?.is_public && orgProfile?.slug
  //   ? publicClientHref(orgProfile.slug)
  //   : null;
  function deriveShareUrl(
    isOwner: boolean,
    is_public: boolean | undefined,
    slug: string | null | undefined,
  ): string | null {
    return isOwner && is_public && slug ? publicClientHref(slug) : null;
  }

  it('returns URL when owner, is_public=true, slug present', () => {
    expect(deriveShareUrl(true, true, 'brand-co')).toBe(
      'https://index-casting.com/client/brand-co',
    );
  });

  it('returns null when not owner', () => {
    expect(deriveShareUrl(false, true, 'brand-co')).toBeNull();
  });

  it('returns null when is_public=false', () => {
    expect(deriveShareUrl(true, false, 'brand-co')).toBeNull();
  });

  it('returns null when slug is null', () => {
    expect(deriveShareUrl(true, true, null)).toBeNull();
  });

  it('returns null when slug is empty string', () => {
    expect(deriveShareUrl(true, true, '')).toBeNull();
  });

  it('returns null when is_public is undefined', () => {
    expect(deriveShareUrl(true, undefined, 'brand-co')).toBeNull();
  });
});
