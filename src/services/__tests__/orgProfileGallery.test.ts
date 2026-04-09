/**
 * Tests for Phase 2D — Client Gallery Upload + Delete
 *
 * Covers:
 * - uploadClientGalleryImage: assertOrgContext guard blocks empty org
 * - uploadClientGalleryImage: HEIC conversionFailed → early return with error
 * - uploadClientGalleryImage: invalid MIME type → validation error, no upload
 * - uploadClientGalleryImage: magic bytes failure → early return, no upload
 * - uploadClientGalleryImage: storage upload failure → { ok: false }, DB not called
 * - uploadClientGalleryImage: DB insert failure (createOrganizationProfileMedia returns null)
 *                              → storage cleaned up, { ok: false }
 * - uploadClientGalleryImage: success → createOrganizationProfileMedia called with
 *                              media_type 'client_gallery' + correct image_url, returns { ok: true, media }
 * - deleteClientGalleryImage: assertOrgContext guard blocks empty org
 * - deleteClientGalleryImage: calls deleteOrganizationProfileMedia with correct mediaId
 * - deleteClientGalleryImage: extracts correct storage path from image URL and calls remove()
 * - deleteClientGalleryImage: returns true on success
 * - deleteClientGalleryImage: returns false when deleteOrganizationProfileMedia fails
 *
 * RLS enforcement (can_manage_org_gallery via is_org_owner()) is server-side only.
 * These tests verify client-side validation, guard logic, and service contracts.
 */

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockUpload = jest.fn();
const mockRemove = jest.fn();
const mockGetPublicUrl = jest.fn();

jest.mock('../../../lib/supabase', () => ({
  supabase: {
    storage: {
      from: jest.fn(() => ({
        upload: mockUpload,
        remove: mockRemove,
        getPublicUrl: mockGetPublicUrl,
      })),
    },
  },
}));

jest.mock('../../utils/orgGuard', () => ({
  assertOrgContext: jest.fn((orgId: string) => {
    if (!orgId) return false;
    return true;
  }),
}));

const mockCreateOrganizationProfileMedia = jest.fn();
const mockDeleteOrganizationProfileMedia = jest.fn();

jest.mock('../../services/organizationProfilesSupabase', () => ({
  createOrganizationProfileMedia: mockCreateOrganizationProfileMedia,
  deleteOrganizationProfileMedia: mockDeleteOrganizationProfileMedia,
}));

const mockConvertHeicToJpeg = jest.fn();
jest.mock('../../services/imageUtils', () => ({
  convertHeicToJpegWithStatus: mockConvertHeicToJpeg,
}));

const mockValidateFile = jest.fn();
const mockCheckMagicBytes = jest.fn();
const mockCheckExtensionConsistency = jest.fn();
const mockSanitizeUploadBaseName = jest.fn((name: string) => name);

jest.mock('../../../lib/validation', () => ({
  ALLOWED_MIME_TYPES: [
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/heic',
    'image/heif',
    'application/pdf',
  ],
  validateFile: mockValidateFile,
  checkMagicBytes: mockCheckMagicBytes,
  checkExtensionConsistency: mockCheckExtensionConsistency,
  sanitizeUploadBaseName: mockSanitizeUploadBaseName,
}));

// ─── Imports (after mocks) ────────────────────────────────────────────────────

import {
  uploadClientGalleryImage,
  deleteClientGalleryImage,
} from '../organizationGallerySupabase';
import { assertOrgContext } from '../../utils/orgGuard';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeFile(name = 'photo.jpg', type = 'image/jpeg'): File {
  return new File(['data'], name, { type });
}

const ORG_ID = 'org-uuid-456';
const MEDIA_ID = 'media-uuid-789';

const IMAGE_URL =
  'https://example.supabase.co/storage/v1/object/public/organization-profiles/' +
  `${ORG_ID}/client-gallery/1234567890-photo.jpg`;

const MOCK_MEDIA = {
  id: MEDIA_ID,
  organization_id: ORG_ID,
  media_type: 'client_gallery',
  image_url: IMAGE_URL,
  sort_order: 1234567890,
  is_visible_public: false,
  created_at: '2026-05-16T00:00:00Z',
  model_id: null,
  title: null,
  gender_group: null,
};

// ─── uploadClientGalleryImage ─────────────────────────────────────────────────

describe('uploadClientGalleryImage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default happy-path
    mockConvertHeicToJpeg.mockResolvedValue({ file: makeFile(), conversionFailed: false });
    mockValidateFile.mockReturnValue({ ok: true });
    mockCheckMagicBytes.mockResolvedValue({ ok: true });
    mockCheckExtensionConsistency.mockReturnValue({ ok: true });
    mockUpload.mockResolvedValue({ error: null });
    mockRemove.mockResolvedValue({ error: null });
    mockGetPublicUrl.mockReturnValue({ data: { publicUrl: IMAGE_URL } });
    mockCreateOrganizationProfileMedia.mockResolvedValue(MOCK_MEDIA);
  });

  test('returns { ok: false } when organizationId is empty (assertOrgContext guard)', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (assertOrgContext as any).mockReturnValueOnce(false);
    const result = await uploadClientGalleryImage('', makeFile());
    expect(result.ok).toBe(false);
    expect(mockUpload).not.toHaveBeenCalled();
  });

  test('returns { ok: false } when HEIC conversion fails', async () => {
    mockConvertHeicToJpeg.mockResolvedValueOnce({
      file: makeFile('photo.heic', 'image/heic'),
      conversionFailed: true,
    });
    const result = await uploadClientGalleryImage(ORG_ID, makeFile('photo.heic', 'image/heic'));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/convert/i);
    expect(mockValidateFile).not.toHaveBeenCalled();
    expect(mockUpload).not.toHaveBeenCalled();
  });

  test('returns { ok: false } when MIME type is invalid (PDF rejected)', async () => {
    const pdfFile = makeFile('doc.pdf', 'application/pdf');
    mockConvertHeicToJpeg.mockResolvedValueOnce({ file: pdfFile, conversionFailed: false });
    mockValidateFile.mockReturnValueOnce({ ok: false, error: 'File type not allowed' });

    const result = await uploadClientGalleryImage(ORG_ID, pdfFile);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('File type not allowed');
    expect(mockUpload).not.toHaveBeenCalled();
  });

  test('returns { ok: false } when magic bytes check fails', async () => {
    mockCheckMagicBytes.mockResolvedValueOnce({ ok: false, error: 'Magic bytes mismatch' });
    const result = await uploadClientGalleryImage(ORG_ID, makeFile());
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Magic bytes mismatch');
    expect(mockUpload).not.toHaveBeenCalled();
  });

  test('returns { ok: false } when storage upload fails', async () => {
    mockUpload.mockResolvedValueOnce({ error: { message: 'storage error' } });
    const result = await uploadClientGalleryImage(ORG_ID, makeFile());
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/upload failed/i);
    expect(mockCreateOrganizationProfileMedia).not.toHaveBeenCalled();
  });

  test('cleans up storage file and returns { ok: false } when DB insert fails', async () => {
    mockCreateOrganizationProfileMedia.mockResolvedValueOnce(null);
    const result = await uploadClientGalleryImage(ORG_ID, makeFile());
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/could not save/i);
    // Storage cleanup must have been attempted
    expect(mockRemove).toHaveBeenCalled();
  });

  test('success: calls createOrganizationProfileMedia with media_type client_gallery and image_url', async () => {
    const result = await uploadClientGalleryImage(ORG_ID, makeFile());
    expect(result.ok).toBe(true);
    expect(result.media).toEqual(MOCK_MEDIA);
    expect(mockCreateOrganizationProfileMedia).toHaveBeenCalledWith(
      ORG_ID,
      expect.objectContaining({
        media_type: 'client_gallery',
        image_url: IMAGE_URL,
      }),
    );
  });

  test('storage path includes organizationId and client-gallery sub-path', async () => {
    await uploadClientGalleryImage(ORG_ID, makeFile('photo.jpg'));
    const uploadCall = mockUpload.mock.calls[0];
    const storagePath: string = uploadCall[0];
    expect(storagePath).toContain(ORG_ID);
    expect(storagePath).toContain('client-gallery');
  });

  test('upload uses upsert: false', async () => {
    await uploadClientGalleryImage(ORG_ID, makeFile());
    const uploadOptions = mockUpload.mock.calls[0][2];
    expect(uploadOptions).toMatchObject({ upsert: false });
  });
});

// ─── deleteClientGalleryImage ─────────────────────────────────────────────────

describe('deleteClientGalleryImage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDeleteOrganizationProfileMedia.mockResolvedValue(true);
    mockRemove.mockResolvedValue({ data: null, error: null });
  });

  test('returns false when organizationId is empty (assertOrgContext guard)', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (assertOrgContext as any).mockReturnValueOnce(false);
    const result = await deleteClientGalleryImage('', MEDIA_ID, IMAGE_URL);
    expect(result).toBe(false);
    expect(mockDeleteOrganizationProfileMedia).not.toHaveBeenCalled();
  });

  test('calls deleteOrganizationProfileMedia with the correct mediaId', async () => {
    await deleteClientGalleryImage(ORG_ID, MEDIA_ID, IMAGE_URL);
    expect(mockDeleteOrganizationProfileMedia).toHaveBeenCalledWith(MEDIA_ID);
  });

  test('extracts correct storage path from image URL and calls remove()', async () => {
    await deleteClientGalleryImage(ORG_ID, MEDIA_ID, IMAGE_URL);
    // Expected path: everything after /object/public/organization-profiles/
    const expectedPath = `${ORG_ID}/client-gallery/1234567890-photo.jpg`;
    expect(mockRemove).toHaveBeenCalledWith([expectedPath]);
  });

  test('returns true on success', async () => {
    const result = await deleteClientGalleryImage(ORG_ID, MEDIA_ID, IMAGE_URL);
    expect(result).toBe(true);
  });

  test('returns false and skips storage remove when deleteOrganizationProfileMedia fails', async () => {
    mockDeleteOrganizationProfileMedia.mockResolvedValueOnce(false);
    const result = await deleteClientGalleryImage(ORG_ID, MEDIA_ID, IMAGE_URL);
    expect(result).toBe(false);
    // Storage remove should NOT be called if DB delete failed
    expect(mockRemove).not.toHaveBeenCalled();
  });
});
