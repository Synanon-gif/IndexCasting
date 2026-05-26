import { getDashboardSummary } from '../dashboardSupabase';

const mockRpc = jest.fn();

jest.mock('../../../lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => mockRpc(...args),
  },
}));

describe('getDashboardSummary', () => {
  beforeEach(() => {
    mockRpc.mockReset();
  });

  it('calls get_dashboard_summary with org and user ids', async () => {
    mockRpc.mockResolvedValue({
      data: { open_option_requests: 2, unread_threads: 0, today_events: 1 },
      error: null,
    });
    const result = await getDashboardSummary('org-1', 'user-1');
    expect(mockRpc).toHaveBeenCalledWith('get_dashboard_summary', {
      p_org_id: 'org-1',
      p_user_id: 'user-1',
    });
    expect(result).toEqual({
      open_option_requests: 2,
      unread_threads: 0,
      today_events: 1,
    });
  });

  it('returns null on rpc error without throwing', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'denied' } });
    await expect(getDashboardSummary('org-1', 'user-1')).resolves.toBeNull();
  });
});
