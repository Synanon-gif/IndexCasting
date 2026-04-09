/**
 * Tests for Phase 3A.2 — Public Agency Settings UI (Owner Only)
 *
 * Covers:
 * - validateSlug: valid slugs return null
 * - validateSlug: various invalid inputs return error strings
 * - slugify: raw strings are sanitized into slug candidates
 * - publicAgencyUrl: correct URL construction
 * - upsertPublicSettings: assertOrgContext empty → { ok: false } without DB call
 * - upsertPublicSettings: success path → { ok: true }
 * - upsertPublicSettings: 23505 unique violation → { ok: false, slugTaken: true }
 * - upsertPublicSettings: other DB error → { ok: false }
 * - upsertPublicSettings: is_public=true saved correctly
 *
 * RLS enforcement (op_owner_update via is_org_owner()) is server-side only.
 */

import { validateSlug, slugify, publicAgencyUrl } from '../../utils/orgProfilePublicSettings';
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
