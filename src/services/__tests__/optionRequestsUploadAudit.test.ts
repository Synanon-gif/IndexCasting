jest.mock('../../../lib/supabase', () => ({
  supabase: {
    from: jest.fn(),
    storage: { from: jest.fn() },
    auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }) },
  },
}));

jest.mock('../../../lib/validation', () => ({
  validateFile: jest.fn(() => ({ ok: true })),
  checkMagicBytes: jest.fn(async () => ({ ok: true })),
  sanitizeUploadBaseName: jest.fn((name: string) => name),
  checkExtensionConsistency: jest.fn(() => ({ ok: true })),
  CHAT_ALLOWED_MIME_TYPES: ['application/pdf'],
  normalizeInput: jest.fn((v: string) => v),
  validateText: jest.fn(() => ({ ok: true })),
  sanitizeHtml: jest.fn((v: string) => v),
  extractSafeUrls: jest.fn((v: string) => (v.match(/https?:\/\/[^\s]+/gi) ?? [])),
  logSecurityEvent: jest.fn(),
}));

jest.mock('../imageUtils', () => ({
  convertHeicToJpegWithStatus: jest.fn(async (file: Blob) => ({ file, conversionFailed: false })),
}));

jest.mock('../agencyStorageSupabase', () => ({
  checkAndIncrementStorage: jest.fn(async () => ({ allowed: true })),
  decrementStorage: jest.fn(async () => undefined),
}));

jest.mock('../gdprComplianceSupabase', () => ({
  guardUploadSession: jest.fn(async () => ({ ok: true })),
}));

jest.mock('../../utils/logAction', () => ({
  logAction: jest.fn(),
}));

import { supabase } from '../../../lib/supabase';
import { logAction } from '../../utils/logAction';
import { uploadOptionDocument } from '../optionRequestsSupabase';

const from = supabase.from as jest.Mock;
const storageFrom = supabase.storage.from as jest.Mock;

describe('uploadOptionDocument audit logging', () => {
  let consoleErrorSpy: jest.SpyInstance;
  let consoleWarnSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    consoleWarnSpy.mockRestore();
  });

  it('logs option_document_uploaded with resolved org context', async () => {
    storageFrom.mockReturnValue({
      upload: jest.fn().mockResolvedValue({ error: null }),
    });

    from
      .mockReturnValueOnce({
        insert: () => ({
          select: () => ({
            single: jest.fn().mockResolvedValue({
              data: {
                id: 'doc-1',
                option_request_id: 'req-1',
                uploaded_by: 'user-1',
                file_name: 'brief.pdf',
                file_url: 'options/req-1/1_brief.pdf',
                file_type: 'pdf',
                created_at: '2026-04-08T10:00:00Z',
              },
              error: null,
            }),
          }),
        }),
      })
      .mockReturnValueOnce({
        select: () => ({
          eq: () => ({
            maybeSingle: jest.fn().mockResolvedValue({
              data: {
                client_organization_id: 'org-client-1',
                organization_id: 'org-client-legacy',
                agency_organization_id: 'org-agency-1',
              },
              error: null,
            }),
          }),
        }),
      });

    const result = await uploadOptionDocument(
      'req-1',
      'user-1',
      new Blob(['pdf'], { type: 'application/pdf' }),
      'brief.pdf',
    );

    expect(result).not.toBeNull();
    expect(logAction).toHaveBeenCalledWith(
      'org-client-1',
      'uploadOptionDocument',
      expect.objectContaining({
        type: 'option',
        action: 'option_document_uploaded',
        entityId: 'req-1',
      }),
      { source: 'api' },
    );
  });
});
