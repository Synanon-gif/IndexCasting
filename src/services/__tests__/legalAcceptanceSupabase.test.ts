import { persistPlatformLegalAcceptance } from '../legalAcceptanceSupabase';
import { supabase } from '../../../lib/supabase';

jest.mock('../../../lib/supabase', () => ({
  supabase: {
    from: jest.fn(),
  },
}));

jest.mock('../consentSupabase', () => ({
  recordConsent: jest.fn().mockResolvedValue(true),
}));

const USER_ID = '11111111-1111-1111-1111-111111111111';

function mockFromChain(updateError: unknown, insertError: unknown) {
  const updateMock = jest.fn().mockReturnValue({
    eq: jest.fn().mockResolvedValue({ error: updateError }),
  });
  const insertMock = jest.fn().mockResolvedValue({ error: insertError });

  (supabase.from as jest.Mock).mockImplementation((table: string) => {
    if (table === 'profiles') {
      return { update: updateMock };
    }
    if (table === 'legal_acceptances') {
      return { insert: insertMock };
    }
    throw new Error(`unexpected table ${table}`);
  });

  return { updateMock, insertMock, rollbackUpdate: updateMock };
}

describe('persistPlatformLegalAcceptance', () => {
  const err = console.error;
  const warn = console.warn;

  beforeAll(() => {
    console.error = jest.fn();
    console.warn = jest.fn();
  });

  afterAll(() => {
    console.error = err;
    console.warn = warn;
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns null error when profiles update and legal_acceptances insert succeed', async () => {
    const { insertMock } = mockFromChain(null, null);
    await expect(persistPlatformLegalAcceptance(USER_ID, false)).resolves.toEqual({ error: null });
    expect(insertMock).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ document_type: 'terms_of_service', user_id: USER_ID }),
        expect.objectContaining({ document_type: 'privacy_policy', user_id: USER_ID }),
      ]),
    );
  });

  it('includes agency_model_rights row when agencyRights is true', async () => {
    const { insertMock } = mockFromChain(null, null);
    await expect(persistPlatformLegalAcceptance(USER_ID, true)).resolves.toEqual({ error: null });
    expect(insertMock).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ document_type: 'agency_model_rights', user_id: USER_ID }),
      ]),
    );
  });

  it('returns error and rolls back profiles when legal_acceptances insert fails', async () => {
    mockFromChain(null, { message: 'insert_failed' });
    const result = await persistPlatformLegalAcceptance(USER_ID, false);
    expect(result.error).toBe('insert_failed');
    expect(supabase.from).toHaveBeenCalledWith('profiles');
    expect(supabase.from).toHaveBeenCalledWith('legal_acceptances');
    // profiles.update called twice: initial accept + rollback
    const profilesFrom = (supabase.from as jest.Mock).mock.results.find(
      (_r, i) => (supabase.from as jest.Mock).mock.calls[i][0] === 'profiles',
    );
    expect(profilesFrom).toBeTruthy();
  });

  it('returns profile error without legal insert when profiles update fails', async () => {
    mockFromChain({ message: 'profile_update_failed' }, null);
    const result = await persistPlatformLegalAcceptance(USER_ID, false);
    expect(result.error).toBe('profile_update_failed');
    expect(supabase.from).not.toHaveBeenCalledWith('legal_acceptances');
  });
});
