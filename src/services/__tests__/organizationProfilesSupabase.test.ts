jest.mock('../../../lib/supabase', () => ({
  supabase: {
    from: jest.fn(),
    auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: 'user-owner' } } }) },
  },
}));

import { supabase } from '../../../lib/supabase';
import {
  getOrganizationProfile,
  upsertOrganizationProfile,
  listOrganizationProfileMedia,
  createOrganizationProfileMedia,
  deleteOrganizationProfileMedia,
} from '../organizationProfilesSupabase';

const from = supabase.from as jest.Mock;

const ORG_ID = 'org-agency-1';
const MEDIA_ID = 'media-1';

const mockProfile = {
  organization_id: ORG_ID,
  logo_url: null,
  description: 'Our agency',
  address_line_1: null,
  city: 'Berlin',
  postal_code: null,
  country: 'DE',
  website_url: null,
  contact_email: null,
  contact_phone: null,
  slug: null,
  is_public: false,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

const mockMediaRow = {
  id: MEDIA_ID,
  organization_id: ORG_ID,
  media_type: 'agency_model_cover' as const,
  model_id: null,
  title: 'Cover 1',
  image_url: 'https://example.com/cover.jpg',
  gender_group: 'female' as const,
  sort_order: 0,
  is_visible_public: false,
  created_at: '2026-01-01T00:00:00Z',
};

describe('organizationProfilesSupabase', () => {
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  // ── getOrganizationProfile ─────────────────────────────────────────────────

  describe('getOrganizationProfile', () => {
    it('returns profile row when found', async () => {
      const maybeSingle = jest.fn().mockResolvedValue({ data: mockProfile, error: null });
      from.mockReturnValue({
        select: () => ({ eq: () => ({ maybeSingle }) }),
      });
      const result = await getOrganizationProfile(ORG_ID);
      expect(result).toEqual(mockProfile);
      expect(from).toHaveBeenCalledWith('organization_profiles');
    });

    it('returns null when no profile row exists yet', async () => {
      const maybeSingle = jest.fn().mockResolvedValue({ data: null, error: null });
      from.mockReturnValue({
        select: () => ({ eq: () => ({ maybeSingle }) }),
      });
      const result = await getOrganizationProfile(ORG_ID);
      expect(result).toBeNull();
    });

    it('returns null on RLS / DB error', async () => {
      const maybeSingle = jest.fn().mockResolvedValue({ data: null, error: { message: 'rls denied' } });
      from.mockReturnValue({
        select: () => ({ eq: () => ({ maybeSingle }) }),
      });
      const result = await getOrganizationProfile(ORG_ID);
      expect(result).toBeNull();
      expect(consoleErrorSpy).toHaveBeenCalled();
    });

    it('returns null and logs error when organizationId is empty', async () => {
      const result = await getOrganizationProfile('');
      expect(result).toBeNull();
      expect(from).not.toHaveBeenCalled();
      expect(consoleErrorSpy).toHaveBeenCalled();
    });
  });

  // ── upsertOrganizationProfile ──────────────────────────────────────────────

  describe('upsertOrganizationProfile', () => {
    it('returns true on successful upsert (owner)', async () => {
      const upsertFn = jest.fn().mockResolvedValue({ error: null });
      from.mockReturnValue({ upsert: upsertFn });
      const result = await upsertOrganizationProfile(ORG_ID, { city: 'Munich' });
      expect(result).toBe(true);
      expect(from).toHaveBeenCalledWith('organization_profiles');
      expect(upsertFn).toHaveBeenCalledWith(
        expect.objectContaining({ organization_id: ORG_ID, city: 'Munich' }),
        { onConflict: 'organization_id' },
      );
    });

    it('returns false when DB returns an error (non-owner blocked by RLS)', async () => {
      const upsertFn = jest.fn().mockResolvedValue({ error: { message: 'rls denied' } });
      from.mockReturnValue({ upsert: upsertFn });
      const result = await upsertOrganizationProfile(ORG_ID, { city: 'Hamburg' });
      expect(result).toBe(false);
      expect(consoleErrorSpy).toHaveBeenCalled();
    });

    it('returns false and does not call supabase when organizationId is empty', async () => {
      const result = await upsertOrganizationProfile('', { city: 'Hamburg' });
      expect(result).toBe(false);
      expect(from).not.toHaveBeenCalled();
      expect(consoleErrorSpy).toHaveBeenCalled();
    });

    it('returns false on exception', async () => {
      from.mockReturnValue({ upsert: jest.fn().mockRejectedValue(new Error('network')) });
      const result = await upsertOrganizationProfile(ORG_ID, {});
      expect(result).toBe(false);
      expect(consoleErrorSpy).toHaveBeenCalled();
    });
  });

  // ── listOrganizationProfileMedia ───────────────────────────────────────────

  describe('listOrganizationProfileMedia', () => {
    it('returns media array on success', async () => {
      const order = jest.fn().mockResolvedValue({ data: [mockMediaRow], error: null });
      from.mockReturnValue({
        select: () => ({ eq: () => ({ order }) }),
      });
      const result = await listOrganizationProfileMedia(ORG_ID);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(MEDIA_ID);
      expect(from).toHaveBeenCalledWith('organization_profile_media');
    });

    it('returns empty array when no media exists', async () => {
      const order = jest.fn().mockResolvedValue({ data: [], error: null });
      from.mockReturnValue({
        select: () => ({ eq: () => ({ order }) }),
      });
      const result = await listOrganizationProfileMedia(ORG_ID);
      expect(result).toEqual([]);
    });

    it('returns empty array on error', async () => {
      const order = jest.fn().mockResolvedValue({ data: null, error: { message: 'error' } });
      from.mockReturnValue({
        select: () => ({ eq: () => ({ order }) }),
      });
      const result = await listOrganizationProfileMedia(ORG_ID);
      expect(result).toEqual([]);
      expect(consoleErrorSpy).toHaveBeenCalled();
    });

    it('returns empty array and logs error when organizationId is empty', async () => {
      const result = await listOrganizationProfileMedia('');
      expect(result).toEqual([]);
      expect(from).not.toHaveBeenCalled();
      expect(consoleErrorSpy).toHaveBeenCalled();
    });

    it('cross-org read is blocked: returns empty array on RLS error', async () => {
      // RLS denies cross-org SELECT; the service returns [] on error
      const order = jest.fn().mockResolvedValue({ data: null, error: { message: 'rls denied' } });
      from.mockReturnValue({
        select: () => ({ eq: () => ({ order }) }),
      });
      const result = await listOrganizationProfileMedia('org-other');
      expect(result).toEqual([]);
      expect(consoleErrorSpy).toHaveBeenCalled();
    });
  });

  // ── createOrganizationProfileMedia ────────────────────────────────────────

  describe('createOrganizationProfileMedia', () => {
    const payload = {
      media_type: 'agency_model_cover' as const,
      image_url: 'https://example.com/img.jpg',
      gender_group: 'female' as const,
    };

    it('returns created media row on success (owner)', async () => {
      const single = jest.fn().mockResolvedValue({ data: mockMediaRow, error: null });
      from.mockReturnValue({
        insert: () => ({ select: () => ({ single }) }),
      });
      const result = await createOrganizationProfileMedia(ORG_ID, payload);
      expect(result?.id).toBe(MEDIA_ID);
      expect(from).toHaveBeenCalledWith('organization_profile_media');
    });

    it('returns null on error (non-owner blocked by RLS)', async () => {
      const single = jest.fn().mockResolvedValue({ data: null, error: { message: 'rls denied' } });
      from.mockReturnValue({
        insert: () => ({ select: () => ({ single }) }),
      });
      const result = await createOrganizationProfileMedia(ORG_ID, payload);
      expect(result).toBeNull();
      expect(consoleErrorSpy).toHaveBeenCalled();
    });

    it('returns null and does not call supabase when organizationId is empty', async () => {
      const result = await createOrganizationProfileMedia('', payload);
      expect(result).toBeNull();
      expect(from).not.toHaveBeenCalled();
      expect(consoleErrorSpy).toHaveBeenCalled();
    });

    it('returns null on exception', async () => {
      from.mockReturnValue({
        insert: () => ({ select: () => ({ single: jest.fn().mockRejectedValue(new Error('timeout')) }) }),
      });
      const result = await createOrganizationProfileMedia(ORG_ID, payload);
      expect(result).toBeNull();
      expect(consoleErrorSpy).toHaveBeenCalled();
    });

    it('cross-org write is blocked: returns null on RLS error', async () => {
      const single = jest.fn().mockResolvedValue({ data: null, error: { message: 'rls denied' } });
      from.mockReturnValue({
        insert: () => ({ select: () => ({ single }) }),
      });
      const result = await createOrganizationProfileMedia('org-other', payload);
      expect(result).toBeNull();
      expect(consoleErrorSpy).toHaveBeenCalled();
    });
  });

  // ── deleteOrganizationProfileMedia ────────────────────────────────────────

  describe('deleteOrganizationProfileMedia', () => {
    it('returns true on successful delete (owner)', async () => {
      const eq = jest.fn().mockResolvedValue({ error: null });
      from.mockReturnValue({
        delete: () => ({ eq }),
      });
      const result = await deleteOrganizationProfileMedia(MEDIA_ID);
      expect(result).toBe(true);
      expect(from).toHaveBeenCalledWith('organization_profile_media');
      expect(eq).toHaveBeenCalledWith('id', MEDIA_ID);
    });

    it('returns false on error (non-owner blocked by RLS)', async () => {
      const eq = jest.fn().mockResolvedValue({ error: { message: 'rls denied' } });
      from.mockReturnValue({ delete: () => ({ eq }) });
      const result = await deleteOrganizationProfileMedia(MEDIA_ID);
      expect(result).toBe(false);
      expect(consoleErrorSpy).toHaveBeenCalled();
    });

    it('returns false and logs error when mediaId is empty', async () => {
      const result = await deleteOrganizationProfileMedia('');
      expect(result).toBe(false);
      expect(from).not.toHaveBeenCalled();
      expect(consoleErrorSpy).toHaveBeenCalled();
    });

    it('returns false on exception', async () => {
      from.mockReturnValue({
        delete: () => ({ eq: jest.fn().mockRejectedValue(new Error('network')) }),
      });
      const result = await deleteOrganizationProfileMedia(MEDIA_ID);
      expect(result).toBe(false);
      expect(consoleErrorSpy).toHaveBeenCalled();
    });
  });
});
