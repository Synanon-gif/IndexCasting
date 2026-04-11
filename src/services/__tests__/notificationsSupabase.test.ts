jest.mock('../../../lib/supabase', () => ({
  supabase: {
    from: jest.fn(),
    rpc:  jest.fn(),
    auth: {
      getUser: jest.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }),
    },
  },
}));

// Pool is not needed in unit tests — stub it out
jest.mock('../realtimeChannelPool', () => ({
  pooledSubscribe: jest.fn(() => () => {}),
}));

import { supabase } from '../../../lib/supabase';
import {
  createNotification,
  getNotificationsForCurrentUser,
  markNotificationAsRead,
} from '../notificationsSupabase';

const from = supabase.from as jest.Mock;

describe('notificationsSupabase', () => {
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  // ── Test 1a: createNotification (self) goes through direct INSERT ──────────
  it('createNotification (self-target) inserts a row with the correct fields', async () => {
    const insertMock = jest.fn().mockResolvedValue({ error: null });
    from.mockReturnValue({ insert: insertMock });

    // user_id = 'user-1' matches the mocked auth.uid() → self-notification → direct INSERT
    await createNotification({
      user_id: 'user-1',
      type: 'new_message',
      title: 'New message',
      message: 'You have a new message.',
    });

    expect(from).toHaveBeenCalledWith('notifications');
    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'user-1',
        type: 'new_message',
        title: 'New message',
        message: 'You have a new message.',
      }),
    );
  });

  // ── Test 1b-org: org broadcast with option_request_id → DEFINER RPC ─────────
  it('createNotification (org broadcast + option_request_id) calls notify_org_for_option_request', async () => {
    (supabase.rpc as jest.Mock).mockResolvedValue({ error: null });

    await createNotification({
      organization_id: 'agency-org-1',
      type: 'new_option_message',
      title: 'Update',
      message: 'Thread update',
      metadata: { option_request_id: 'opt-req-uuid' },
    });

    expect(supabase.rpc).toHaveBeenCalledWith(
      'notify_org_for_option_request',
      expect.objectContaining({
        p_option_request_id: 'opt-req-uuid',
        p_target_organization_id: 'agency-org-1',
        p_type: 'new_option_message',
      }),
    );
    expect(from).not.toHaveBeenCalled();
  });

  // ── Test 1c-org: org broadcast with thread_id → recruiting RPC ─────────────
  it('createNotification (org broadcast + thread_id) calls notify_org_for_recruiting_thread', async () => {
    (supabase.rpc as jest.Mock).mockResolvedValue({ error: null });

    await createNotification({
      organization_id: 'agency-org-2',
      type: 'new_recruiting_message',
      title: 'Recruiting',
      message: 'New reply',
      metadata: { thread_id: 'thread-uuid' },
    });

    expect(supabase.rpc).toHaveBeenCalledWith(
      'notify_org_for_recruiting_thread',
      expect.objectContaining({
        p_thread_id: 'thread-uuid',
        p_target_organization_id: 'agency-org-2',
      }),
    );
    expect(from).not.toHaveBeenCalled();
  });

  // ── Test 1b: createNotification (cross-party) routes through RPC ───────────
  it('createNotification (cross-party) calls send_notification RPC', async () => {
    (supabase.rpc as jest.Mock).mockResolvedValue({ error: null });

    // user_id = 'other-user' is different from caller 'user-1' → cross-party → RPC
    await createNotification({
      user_id: 'other-user',
      type: 'booking_accepted',
      title: 'Booking accepted',
      message: 'Your booking has been accepted.',
    });

    expect(supabase.rpc).toHaveBeenCalledWith('send_notification', expect.objectContaining({
      p_target_user_id: 'other-user',
      p_type:           'booking_accepted',
    }));
    expect(from).not.toHaveBeenCalled();
  });

  // ── Test 2: getNotificationsForCurrentUser returns only owned rows ─────────
  it('getNotificationsForCurrentUser returns rows when RLS allows', async () => {
    const mockRows = [
      { id: 'n-1', user_id: 'user-1', organization_id: null, type: 'new_message', title: 'New message', message: 'msg', metadata: {}, is_read: false, created_at: '2026-01-01T00:00:00Z' },
      { id: 'n-2', user_id: null, organization_id: 'org-1', type: 'booking_accepted', title: 'Booking', message: 'msg', metadata: {}, is_read: false, created_at: '2026-01-01T00:01:00Z' },
    ];
    const limitMock = jest.fn().mockResolvedValue({ data: mockRows, error: null });
    const orderMock = jest.fn().mockReturnValue({ limit: limitMock });
    const selectMock = jest.fn().mockReturnValue({ order: orderMock });
    from.mockReturnValue({ select: selectMock });

    const rows = await getNotificationsForCurrentUser();

    expect(rows).toHaveLength(2);
    expect(rows[0].id).toBe('n-1');
    expect(rows[1].id).toBe('n-2');
  });

  // ── Test 3: markNotificationAsRead sets is_read = true ────────────────────
  it('markNotificationAsRead calls update with is_read: true', async () => {
    const eqMock = jest.fn().mockResolvedValue({ error: null });
    const updateMock = jest.fn().mockReturnValue({ eq: eqMock });
    from.mockReturnValue({ update: updateMock });

    await markNotificationAsRead('notif-123');

    expect(from).toHaveBeenCalledWith('notifications');
    expect(updateMock).toHaveBeenCalledWith({ is_read: true });
    expect(eqMock).toHaveBeenCalledWith('id', 'notif-123');
  });

  // ── Test 4a: createNotification (self) logs error without throwing ─────────
  it('createNotification (self-target) logs error and does not throw when Supabase fails', async () => {
    const insertMock = jest.fn().mockResolvedValue({ error: { message: 'RLS denied' } });
    from.mockReturnValue({ insert: insertMock });

    // Self-target: user_id = caller's own id → goes through direct INSERT
    await expect(
      createNotification({
        user_id: 'user-1',
        type: 'new_message',
        title: 'New message',
        message: 'You have a new message.',
      }),
    ).resolves.toBeUndefined();

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'createNotification error:',
      expect.objectContaining({ message: 'RLS denied' }),
    );
  });

  // ── Test 4b: createNotification (cross-party) logs RPC error without throw ─
  it('createNotification (cross-party) logs RPC error and does not throw', async () => {
    (supabase.rpc as jest.Mock).mockResolvedValue({ error: { message: 'no relationship' } });

    await expect(
      createNotification({
        user_id: 'unrelated-user',
        type: 'new_message',
        title: 'Test',
        message: 'Test message',
      }),
    ).resolves.toBeUndefined();

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'createNotification (cross-party RPC) error:',
      expect.objectContaining({ message: 'no relationship' }),
    );
  });

  // ── Test 5: getNotificationsForCurrentUser returns [] when not authed ──────
  it('getNotificationsForCurrentUser returns empty array when no auth session', async () => {
    (supabase.auth.getUser as jest.Mock).mockResolvedValueOnce({
      data: { user: null },
    });
    // from() should not be called in this case
    const rows = await getNotificationsForCurrentUser();
    expect(rows).toEqual([]);
    expect(from).not.toHaveBeenCalled();
  });

  // ── Test 6: getNotificationsForCurrentUser returns [] on DB error ──────────
  it('getNotificationsForCurrentUser returns empty array on DB error', async () => {
    const limitMock = jest.fn().mockResolvedValue({ data: null, error: { message: 'timeout' } });
    const orderMock = jest.fn().mockReturnValue({ limit: limitMock });
    const selectMock = jest.fn().mockReturnValue({ order: orderMock });
    from.mockReturnValue({ select: selectMock });

    const rows = await getNotificationsForCurrentUser();

    expect(rows).toEqual([]);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'getNotificationsForCurrentUser error:',
      expect.objectContaining({ message: 'timeout' }),
    );
  });
});
