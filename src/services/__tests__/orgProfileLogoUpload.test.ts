/**
 * Tests for Phase 2C.2 — Owner-Only Organization Logo Upload
 *
 * Covers:
 * - uploadOrganizationLogo: assertOrgContext guard blocks empty org
 * - uploadOrganizationLogo: HEIC conversionFailed → early return with error
 * - uploadOrganizationLogo: invalid MIME type → validation error, no upload
 * - uploadOrganizationLogo: storage upload failure → { ok: false }
 * - uploadOrganizationLogo: success path → upsertOrganizationProfile called with URL
 * - uploadOrganizationLogo: old logo URL extracted and old file removed after success
 * - deleteOrganizationLogo: assertOrgContext guard blocks empty org
 * - deleteOrganizationLogo: storage path extracted from URL and file removed
 * - deleteOrganizationLogo: upsertOrganizationProfile called with logo_url = null
 * - extractLogoStoragePath helper (via delete): correct path extraction
 *
 * RLS enforcement (can_manage_org_logo via is_org_owner()) is server-side only.
 * These tests verify client-side validation, guard logic, and service contracts.
 */

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockUpload = jest.fn();
const mockRemove = jest.fn();
const mockGetPublicUrl = jest.fn();
const mockSelectSingle = jest.fn();

jest.mock('../../../lib/supabase', () => ({
  supabase: {
    storage: {
      from: jest.fn(() => ({
        upload: mockUpload,
        remove: mockRemove,
        getPublicUrl: mockGetPublicUrl,
      })),
    },
    from: jest.fn(() => ({
      select: jest.fn(() => ({
        eq: jest.fn(() => ({
          maybeSingle: mockSelectSingle,
        })),
      })),
    })),
  },
}));

jest.mock('../../utils/orgGuard', () => ({
  assertOrgContext: jest.fn((orgId: string) => {
    if (!orgId) return false;
    return true;
  }),
}));

jest.mock('../../services/organizationProfilesSupabase', () => ({
  upsertOrganizationProfile: jest.fn(),
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
  uploadOrganizationLogo,
  deleteOrganizationLogo,
} from '../organizationLogoSupabase';
import { upsertOrganizationProfile } from '../organizationProfilesSupabase';
import { assertOrgContext } from '../../utils/orgGuard';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeFile(name = 'logo.jpg', type = 'image/jpeg'): File {
  return new File(['data'], name, { type });
}

const PUBLIC_URL = 'https://example.supabase.co/storage/v1/object/public/organization-logos/org-123/12345-logo.jpg';
const ORG_ID = 'org-uuid-123';

// ─── uploadOrganizationLogo ───────────────────────────────────────────────────

describe('uploadOrganizationLogo', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default: happy path
    mockConvertHeicToJpeg.mockResolvedValue({ file: makeFile(), conversionFailed: false });
    mockValidateFile.mockReturnValue({ ok: true });
    mockCheckMagicBytes.mockResolvedValue({ ok: true });
    mockCheckExtensionConsistency.mockReturnValue({ ok: true });
    mockUpload.mockResolvedValue({ error: null });
    mockRemove.mockResolvedValue({ error: null });
    mockGetPublicUrl.mockReturnValue({ data: { publicUrl: PUBLIC_URL } });
    mockSelectSingle.mockResolvedValue({ data: { logo_url: null }, error: null });
    (upsertOrganizationProfile as jest.Mock).mockResolvedValue(true);
  });

  test('returns { ok: false } when organizationId is empty (assertOrgContext guard)', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (assertOrgContext as any).mockReturnValueOnce(false);
    const result = await uploadOrganizationLogo('', makeFile());
    expect(result.ok).toBe(false);
    expect(mockUpload).not.toHaveBeenCalled();
  });

  test('returns { ok: false } when HEIC conversion fails', async () => {
    mockConvertHeicToJpeg.mockResolvedValueOnce({
      file: makeFile('logo.heic', 'image/heic'),
      conversionFailed: true,
    });
    const result = await uploadOrganizationLogo(ORG_ID, makeFile('logo.heic', 'image/heic'));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/convert/i);
    expect(mockValidateFile).not.toHaveBeenCalled();
    expect(mockUpload).not.toHaveBeenCalled();
  });

  test('returns { ok: false } when MIME type is invalid (PDF rejected)', async () => {
    const pdfFile = makeFile('doc.pdf', 'application/pdf');
    mockConvertHeicToJpeg.mockResolvedValueOnce({ file: pdfFile, conversionFailed: false });
    mockValidateFile.mockReturnValueOnce({ ok: false, error: 'File type not allowed' });

    const result = await uploadOrganizationLogo(ORG_ID, pdfFile);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('File type not allowed');
    expect(mockUpload).not.toHaveBeenCalled();
  });

  test('returns { ok: false } when magic bytes check fails', async () => {
    mockCheckMagicBytes.mockResolvedValueOnce({ ok: false, error: 'Magic bytes mismatch' });
    const result = await uploadOrganizationLogo(ORG_ID, makeFile());
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Magic bytes mismatch');
    expect(mockUpload).not.toHaveBeenCalled();
  });

  test('returns { ok: false } when storage upload fails', async () => {
    mockUpload.mockResolvedValueOnce({ error: { message: 'storage error' } });
    const result = await uploadOrganizationLogo(ORG_ID, makeFile());
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/upload failed/i);
    expect(upsertOrganizationProfile).not.toHaveBeenCalled();
  });

  test('success path: calls upsertOrganizationProfile with new logo URL', async () => {
    const result = await uploadOrganizationLogo(ORG_ID, makeFile());
    expect(result.ok).toBe(true);
    expect(result.url).toBe(PUBLIC_URL);
    expect(upsertOrganizationProfile).toHaveBeenCalledWith(
      ORG_ID,
      expect.objectContaining({ logo_url: PUBLIC_URL }),
    );
  });

  test('success path: cleans up old logo file from storage after replacement', async () => {
    // OLD_URL must use the same bucket segment so extractLogoStoragePath can parse it
    const OLD_URL =
      'https://example.supabase.co/storage/v1/object/public/organization-logos/org-123/old-logo.jpg';
    mockSelectSingle.mockResolvedValueOnce({ data: { logo_url: OLD_URL }, error: null });

    const result = await uploadOrganizationLogo(ORG_ID, makeFile());
    expect(result.ok).toBe(true);
    // remove() should have been called with the old path extracted from OLD_URL
    expect(mockRemove).toHaveBeenCalledWith(['org-123/old-logo.jpg']);
  });

  test('cleans up new storage file when DB upsert fails', async () => {
    (upsertOrganizationProfile as jest.Mock).mockResolvedValueOnce(false);
    const result = await uploadOrganizationLogo(ORG_ID, makeFile());
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/could not save/i);
    // remove() should be called to clean up the orphaned upload
    expect(mockRemove).toHaveBeenCalled();
  });
});

// ─── deleteOrganizationLogo ───────────────────────────────────────────────────

describe('deleteOrganizationLogo', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRemove.mockResolvedValue({ data: null, error: null });
    (upsertOrganizationProfile as jest.Mock).mockResolvedValue(true);
  });

  test('returns false when organizationId is empty (assertOrgContext guard)', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (assertOrgContext as any).mockReturnValueOnce(false);
    const result = await deleteOrganizationLogo('', PUBLIC_URL);
    expect(result).toBe(false);
    expect(mockRemove).not.toHaveBeenCalled();
    expect(upsertOrganizationProfile).not.toHaveBeenCalled();
  });

  test('extracts correct storage path from logo URL and calls remove()', async () => {
    // PUBLIC_URL path segment after bucket: org-123/12345-logo.jpg
    await deleteOrganizationLogo(ORG_ID, PUBLIC_URL);
    expect(mockRemove).toHaveBeenCalledWith(['org-123/12345-logo.jpg']);
  });

  test('calls upsertOrganizationProfile with logo_url = null', async () => {
    await deleteOrganizationLogo(ORG_ID, PUBLIC_URL);
    expect(upsertOrganizationProfile).toHaveBeenCalledWith(
      ORG_ID,
      expect.objectContaining({ logo_url: null }),
    );
  });

  test('returns true on success', async () => {
    const result = await deleteOrganizationLogo(ORG_ID, PUBLIC_URL);
    expect(result).toBe(true);
  });

  test('returns false when upsertOrganizationProfile fails', async () => {
    (upsertOrganizationProfile as jest.Mock).mockResolvedValueOnce(false);
    const result = await deleteOrganizationLogo(ORG_ID, PUBLIC_URL);
    expect(result).toBe(false);
  });

  test('skips storage remove when currentLogoUrl is null', async () => {
    await deleteOrganizationLogo(ORG_ID, null);
    expect(mockRemove).not.toHaveBeenCalled();
    expect(upsertOrganizationProfile).toHaveBeenCalledWith(
      ORG_ID,
      expect.objectContaining({ logo_url: null }),
    );
  });
});
