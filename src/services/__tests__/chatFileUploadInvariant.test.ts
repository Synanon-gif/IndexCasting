/**
 * Cross-chat file upload invariant tests.
 *
 * Canonical message variants:
 *   1. text-only   — allowed
 *   2. file-only   — allowed
 *   3. text + file  — allowed
 *   4. empty (no text, no file) — blocked
 */

const maybeSingle = jest.fn().mockResolvedValue({ data: null, error: null });
const eq = jest.fn().mockReturnValue({ maybeSingle, eq: jest.fn().mockReturnValue({ maybeSingle }), is: jest.fn().mockResolvedValue({}) });
const single = jest.fn();
const selectFn = jest.fn().mockReturnValue({ single, eq });
const insertFn = jest.fn().mockReturnValue({ select: selectFn });
const updateFn = jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({}) });
const fromFn = jest.fn().mockReturnValue({ insert: insertFn, select: selectFn, update: updateFn });

jest.mock('../../../lib/supabase', () => ({
  supabase: {
    from: fromFn,
    storage: { from: jest.fn() },
    auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: 'user-test-id' } } }) },
  },
}));

jest.mock('../../../lib/validation', () => ({
  validateFile: jest.fn(() => ({ ok: true })),
  checkMagicBytes: jest.fn(async () => ({ ok: true })),
  sanitizeUploadBaseName: jest.fn((name: string) => name),
  checkExtensionConsistency: jest.fn(() => ({ ok: true })),
  CHAT_ALLOWED_MIME_TYPES: ['image/jpeg', 'image/png', 'application/pdf'],
  MESSAGE_MAX_LENGTH: 2000,
  normalizeInput: jest.fn((v: string) => v.trim()),
  validateText: jest.fn((text: string, opts?: { allowEmpty?: boolean }) => {
    const trimmed = text.trim();
    if (!opts?.allowEmpty && trimmed.length < 1) return { ok: false, error: 'Message is too short.' };
    if (trimmed.length > 2000) return { ok: false, error: 'Message exceeds the maximum length of 2000 characters.' };
    return { ok: true };
  }),
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

jest.mock('../notificationsSupabase', () => ({
  createNotification: jest.fn(async () => undefined),
  createNotifications: jest.fn(async () => undefined),
}));

jest.mock('./../../services/realtimeChannelPool', () => ({
  pooledSubscribe: jest.fn(() => () => {}),
}));

import { addMessage } from '../recruitingChatSupabase';
import { sendMessage } from '../messengerSupabase';

// ═══════════════════════════════════════════════════════════════════════════════
// Recruiting Chat — addMessage
// ═══════════════════════════════════════════════════════════════════════════════

describe('recruitingChatSupabase.addMessage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  function mockInsertSuccess(returnData: Record<string, unknown>) {
    single.mockResolvedValue({ data: returnData, error: null });
  }

  it('allows text-only message (variant 1)', async () => {
    const msgRow = { id: 'm1', thread_id: 't1', from_role: 'agency', text: 'Hello', file_url: null, file_type: null, created_at: new Date().toISOString() };
    mockInsertSuccess(msgRow);
    const result = await addMessage('t1', 'agency', 'Hello');
    expect(result).not.toBeNull();
    expect(result!.text).toBe('Hello');
  });

  it('allows file-only message (variant 2)', async () => {
    const msgRow = { id: 'm2', thread_id: 't1', from_role: 'agency', text: '', file_url: 'recruiting/t1/file.jpg', file_type: 'image/jpeg', created_at: new Date().toISOString() };
    mockInsertSuccess(msgRow);
    const result = await addMessage('t1', 'agency', '', 'recruiting/t1/file.jpg', 'image/jpeg');
    expect(result).not.toBeNull();
    expect(result!.file_url).toBe('recruiting/t1/file.jpg');
  });

  it('allows text + file message (variant 3)', async () => {
    const msgRow = { id: 'm3', thread_id: 't1', from_role: 'agency', text: 'See attached', file_url: 'recruiting/t1/doc.pdf', file_type: 'application/pdf', created_at: new Date().toISOString() };
    mockInsertSuccess(msgRow);
    const result = await addMessage('t1', 'agency', 'See attached', 'recruiting/t1/doc.pdf', 'application/pdf');
    expect(result).not.toBeNull();
    expect(result!.text).toBe('See attached');
    expect(result!.file_url).toBe('recruiting/t1/doc.pdf');
  });

  it('blocks empty message with no file (variant 4)', async () => {
    const result = await addMessage('t1', 'agency', '');
    expect(result).toBeNull();
  });

  it('blocks whitespace-only message with no file', async () => {
    const result = await addMessage('t1', 'agency', '   ');
    expect(result).toBeNull();
  });

  it('does not call validateText for file-only message', async () => {
    const { validateText } = require('../../../lib/validation') as { validateText: jest.Mock };
    const msgRow = { id: 'm4', thread_id: 't1', from_role: 'agency', text: '', file_url: 'path.jpg', file_type: 'image/jpeg', created_at: new Date().toISOString() };
    mockInsertSuccess(msgRow);
    await addMessage('t1', 'agency', '', 'path.jpg', 'image/jpeg');
    expect(validateText).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Messenger — sendMessage
// ═══════════════════════════════════════════════════════════════════════════════

describe('messengerSupabase.sendMessage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  function mockInsertSuccess(returnData: Record<string, unknown>) {
    single.mockResolvedValue({ data: returnData, error: null });
  }

  it('allows text-only message (variant 1)', async () => {
    const msgRow = { id: 'm1', conversation_id: 'c1', sender_id: 's1', text: 'Hello', file_url: null, file_type: null, created_at: new Date().toISOString() };
    mockInsertSuccess(msgRow);
    const result = await sendMessage('c1', 's1', 'Hello');
    expect(result).not.toBeNull();
  });

  it('allows file-only message (variant 2)', async () => {
    const msgRow = { id: 'm2', conversation_id: 'c1', sender_id: 's1', text: null, file_url: 'chat/c1/photo.jpg', file_type: 'image/jpeg', created_at: new Date().toISOString() };
    mockInsertSuccess(msgRow);
    const result = await sendMessage('c1', 's1', '', 'chat/c1/photo.jpg', 'image/jpeg');
    expect(result).not.toBeNull();
  });

  it('blocks empty message with no file and no metadata (variant 4)', async () => {
    const result = await sendMessage('c1', 's1', '');
    expect(result).toBeNull();
  });

  it('allows metadata-only message (structured messages)', async () => {
    const msgRow = { id: 'm3', conversation_id: 'c1', sender_id: 's1', text: null, file_url: null, file_type: null, message_type: 'booking_card', metadata: {}, created_at: new Date().toISOString() };
    mockInsertSuccess(msgRow);
    const result = await sendMessage('c1', 's1', '', undefined, undefined, { messageType: 'booking_card' as 'text', metadata: { booking: true } });
    expect(result).not.toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Security event logging — logSecurityEvent
// ═══════════════════════════════════════════════════════════════════════════════

describe('logSecurityEvent (lib/security/logger)', () => {
  it('auto-resolves userId from auth session when not provided', async () => {
    jest.resetModules();
    const mockInsertSE = jest.fn().mockResolvedValue({ error: null });
    jest.doMock('../../../lib/supabase', () => ({
      supabase: {
        from: jest.fn().mockReturnValue({ insert: mockInsertSE }),
        auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: 'resolved-user' } } }) },
      },
    }));
    const { logSecurityEvent } = require('../../../lib/security/logger');
    await logSecurityEvent({ type: 'large_payload', metadata: { test: true } });
    expect(mockInsertSE).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 'resolved-user' }),
    );
  });

  it('skips DB insert when no authenticated user is available', async () => {
    jest.resetModules();
    const mockInsertSE = jest.fn().mockResolvedValue({ error: null });
    jest.doMock('../../../lib/supabase', () => ({
      supabase: {
        from: jest.fn().mockReturnValue({ insert: mockInsertSE }),
        auth: { getUser: jest.fn().mockResolvedValue({ data: { user: null } }) },
      },
    }));
    const { logSecurityEvent } = require('../../../lib/security/logger');
    await logSecurityEvent({ type: 'file_rejected', metadata: { reason: 'test' } });
    expect(mockInsertSE).not.toHaveBeenCalled();
  });

  it('uses explicitly provided userId without auth lookup', async () => {
    jest.resetModules();
    const mockInsertSE = jest.fn().mockResolvedValue({ error: null });
    const mockGetUser = jest.fn();
    jest.doMock('../../../lib/supabase', () => ({
      supabase: {
        from: jest.fn().mockReturnValue({ insert: mockInsertSE }),
        auth: { getUser: mockGetUser },
      },
    }));
    const { logSecurityEvent } = require('../../../lib/security/logger');
    await logSecurityEvent({ type: 'xss_attempt', userId: 'explicit-user' });
    expect(mockInsertSE).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 'explicit-user' }),
    );
    expect(mockGetUser).not.toHaveBeenCalled();
  });

  it('never throws even on DB error', async () => {
    jest.resetModules();
    const mockInsertSE = jest.fn().mockResolvedValue({ error: { message: 'RLS violation' } });
    jest.doMock('../../../lib/supabase', () => ({
      supabase: {
        from: jest.fn().mockReturnValue({ insert: mockInsertSE }),
        auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: 'u1' } } }) },
      },
    }));
    const { logSecurityEvent } = require('../../../lib/security/logger');
    await expect(logSecurityEvent({ type: 'rate_limit' })).resolves.toBeUndefined();
  });
});
