import { updateAgencySettings } from '../agencySettingsSupabase';

const fromMock = jest.fn();

jest.mock('../../../lib/supabase', () => ({
  supabase: {
    from: (...args: unknown[]) => fromMock(...args),
  },
}));

describe('updateAgencySettings', () => {
  beforeEach(() => {
    fromMock.mockReset();
  });

  it('returns ok when agencies and organizations updates succeed', async () => {
    const chain = {
      update: () => ({
        eq: () => Promise.resolve({ error: null }),
      }),
    };
    fromMock.mockReturnValue(chain);

    const r = await updateAgencySettings({
      agencyId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      organizationId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      payload: {
        name: 'Test Agency',
        description: 'd',
        email: 'e@a.com',
        phone: null,
        website: null,
        street: null,
        city: 'Berlin',
        country: 'DE',
        agency_types: ['Fashion'],
      },
    });
    expect(r.ok).toBe(true);
    expect(fromMock).toHaveBeenCalledWith('agencies');
    expect(fromMock).toHaveBeenCalledWith('organizations');
  });
});
