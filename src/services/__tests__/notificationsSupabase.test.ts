jest.mock('../../../lib/supabase', () => ({
  supabase: {
    from: jest.fn(),
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

  // ── Test 1: createNotification inserts correctly ───────────────────────────
  it('createNotification inserts a row with the correct fields', async () => {
    const insertMock = jest.fn().mockResolvedValue({ error: null });
    from.mockReturnValue({ insert: insertMock });

    await createNotification({
      user_id: 'user-abc',
      type: 'new_message',
      title: 'New message',
      message: 'You have a new message.',
    });

    expect(from).toHaveBeenCalledWith('notifications');
    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'user-abc',
        type: 'new_message',
        title: 'New message',
        message: 'You have a new message.',
      }),
    );
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

  // ── Test 4: createNotification does NOT throw on Supabase error ────────────
  it('createNotification logs error and does not throw when Supabase fails', async () => {
    const insertMock = jest.fn().mockResolvedValue({ error: { message: 'RLS denied' } });
    from.mockReturnValue({ insert: insertMock });

    await expect(
      createNotification({
        user_id: 'user-xyz',
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
