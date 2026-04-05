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

  it('returns null when no assignment row exists', async () => {
    // Step 1: model_assignments → null
    const assignmentChain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
    };
    fromMock.mockReturnValueOnce(assignmentChain);

    const r = await resolveAgencyForModelAndCountry('model-1', 'de');
    expect(r).toBeNull();
  });

  it('normalizes country_code to uppercase and resolves agency_id via organizations', async () => {
    // Step 1: model_assignments → organization_id
    const assignmentEq = jest.fn().mockReturnThis();
    const assignmentChain = {
      select: jest.fn().mockReturnThis(),
      eq: assignmentEq,
      maybeSingle: jest.fn().mockResolvedValue({ data: { organization_id: 'org-1' }, error: null }),
    };
    // Step 2: organizations → agency_id
    const orgChain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn().mockResolvedValue({ data: { agency_id: 'agency-1' }, error: null }),
    };
    fromMock
      .mockReturnValueOnce(assignmentChain)  // model_assignments query
      .mockReturnValueOnce(orgChain);         // organizations query

    const r = await resolveAgencyForModelAndCountry('model-1', ' de ');
    expect(r).toBe('agency-1');

    // territory='DE' (uppercase) should be used in model_assignments query
    expect(assignmentEq).toHaveBeenCalledWith('territory', 'DE');
  });
});
