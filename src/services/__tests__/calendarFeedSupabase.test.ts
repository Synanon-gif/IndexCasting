jest.mock('../../../lib/supabase', () => ({
  supabase: { rpc: jest.fn() },
}));

jest.mock('../../config/env', () => ({
  supabaseUrl: 'https://test-project.supabase.co',
}));

import {
  rotateCalendarFeedToken,
  revokeCalendarFeedToken,
  downloadCalendarIcsFile,
  calendarFeedSubscribeUrl,
  calendarFeedWebcalUrl,
} from '../calendarFeedSupabase';
import { supabase } from '../../../lib/supabase';

describe('calendarFeedSupabase', () => {
  const err = console.error;
  beforeAll(() => {
    console.error = jest.fn();
  });
  afterAll(() => {
    console.error = err;
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('rotateCalendarFeedToken', () => {
    it('returns token when RPC succeeds', async () => {
      (supabase.rpc as jest.Mock).mockResolvedValueOnce({
        data: { token: 'abc123secret', rotated_at: '2026-01-01' },
        error: null,
      });
      await expect(rotateCalendarFeedToken()).resolves.toEqual({ ok: true, token: 'abc123secret' });
    });

    it('returns ok false on RPC error', async () => {
      (supabase.rpc as jest.Mock).mockResolvedValueOnce({
        data: null,
        error: { message: 'not_authenticated' },
      });
      const r = await rotateCalendarFeedToken();
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toContain('not_authenticated');
    });

    it('returns ok false when token missing in payload', async () => {
      (supabase.rpc as jest.Mock).mockResolvedValueOnce({ data: {}, error: null });
      await expect(rotateCalendarFeedToken()).resolves.toEqual({ ok: false, reason: 'no_token' });
    });
  });

  describe('revokeCalendarFeedToken', () => {
    it('returns true on success', async () => {
      (supabase.rpc as jest.Mock).mockResolvedValueOnce({ data: { revoked: true }, error: null });
      await expect(revokeCalendarFeedToken()).resolves.toBe(true);
    });

    it('returns false on RPC error', async () => {
      (supabase.rpc as jest.Mock).mockResolvedValueOnce({
        data: null,
        error: { message: 'failed' },
      });
      await expect(revokeCalendarFeedToken()).resolves.toBe(false);
    });
  });

  describe('downloadCalendarIcsFile', () => {
    it('returns ok false when RPC fails', async () => {
      (supabase.rpc as jest.Mock).mockResolvedValueOnce({
        data: null,
        error: { message: 'permission' },
      });
      const r = await downloadCalendarIcsFile();
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBeDefined();
    });

    it('in Node (no document) returns download_not_available after successful RPC', async () => {
      (supabase.rpc as jest.Mock).mockResolvedValueOnce({
        data: { events: [] },
        error: null,
      });
      await expect(downloadCalendarIcsFile()).resolves.toEqual({
        ok: false,
        reason: 'download_not_available',
      });
    });
  });

  describe('URL helpers', () => {
    it('calendarFeedSubscribeUrl encodes token and targets calendar-feed', () => {
      const u = calendarFeedSubscribeUrl('a b');
      expect(u).toBe(
        'https://test-project.supabase.co/functions/v1/calendar-feed?token=' +
          encodeURIComponent('a b'),
      );
    });

    it('calendarFeedWebcalUrl uses webcal scheme', () => {
      const u = calendarFeedWebcalUrl('tok');
      expect(u.startsWith('webcal://')).toBe(true);
      expect(u).toContain('token=tok');
    });
  });
});
