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

  it('returns null when no MAT row exists', async () => {
    const matChain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
    };
    fromMock.mockReturnValueOnce(matChain);

    const r = await resolveAgencyForModelAndCountry('model-1', 'de');
    expect(r).toBeNull();
    expect(fromMock).toHaveBeenCalledWith('model_agency_territories');
  });

  it('normalizes country_code to uppercase and resolves agency_id from MAT', async () => {
    const matEq = jest.fn().mockReturnThis();
    const matChain = {
      select: jest.fn().mockReturnThis(),
      eq: matEq,
      maybeSingle: jest.fn().mockResolvedValue({ data: { agency_id: 'agency-1' }, error: null }),
    };
    fromMock.mockReturnValueOnce(matChain);

    const r = await resolveAgencyForModelAndCountry('model-1', ' de ');
    expect(r).toBe('agency-1');
    expect(fromMock).toHaveBeenCalledWith('model_agency_territories');
    expect(matEq).toHaveBeenCalledWith('country_code', 'DE');
  });

  it('returns null on empty country code', async () => {
    const r = await resolveAgencyForModelAndCountry('model-1', '  ');
    expect(r).toBeNull();
    expect(fromMock).not.toHaveBeenCalled();
  });
});
