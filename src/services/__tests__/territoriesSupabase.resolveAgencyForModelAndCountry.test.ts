import { resolveAgencyForModelAndCountry } from '../territoriesSupabase';

const fromMock = jest.fn();

jest.mock('../../../lib/supabase', () => ({
  supabase: {
    from: (...args: unknown[]) => fromMock(...args),
  },
}));

describe('resolveAgencyForModelAndCountry', () => {
  beforeEach(() => {
    fromMock.mockReset();
  });

  it('returns null when no territory row exists', async () => {
    const chain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
    };
    fromMock.mockReturnValueOnce(chain);

    const r = await resolveAgencyForModelAndCountry('model-1', 'de');
    expect(r).toBeNull();
  });

  it('normalizes country_code to uppercase', async () => {
    const maybeSingle = jest.fn().mockResolvedValue({ data: { agency_id: 'agency-1' }, error: null });
    const eq = jest.fn().mockReturnThis();
    const chain = { select: jest.fn().mockReturnThis(), eq, maybeSingle };
    fromMock.mockReturnValueOnce(chain);

    const r = await resolveAgencyForModelAndCountry('model-1', ' de ');
    expect(r).toBe('agency-1');

    // eq('country_code', 'DE') should be used at least once.
    expect(eq).toHaveBeenCalledWith('country_code', 'DE');
  });
});

