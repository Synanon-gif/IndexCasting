import {
  signInOrCreateGuestWithOtp,
  createGuestProfile,
  upgradeGuestToClient,
} from '../guestAuthSupabase';

// ─── Supabase mock ─────────────────────────────────────────────────────────────
const mockSignInWithOtp = jest.fn();
const mockUpsertSingle = jest.fn();
const mockRpc = jest.fn();

jest.mock('../../../lib/supabase', () => ({
  supabase: {
    auth: {
      signInWithOtp: (...args: unknown[]) => mockSignInWithOtp(...args),
    },
    from: () => ({
      upsert: () => ({
        select: () => ({
          single: () => mockUpsertSingle(),
        }),
      }),
    }),
    rpc: (...args: unknown[]) => mockRpc(...args),
  },
}));

// ─── signInOrCreateGuestWithOtp ────────────────────────────────────────────────
describe('signInOrCreateGuestWithOtp', () => {
  beforeEach(() => mockSignInWithOtp.mockReset());

  it('returns ok:true when OTP is sent successfully', async () => {
    mockSignInWithOtp.mockResolvedValue({ error: null });
    const result = await signInOrCreateGuestWithOtp('guest@example.com');
    expect(result.ok).toBe(true);
    expect(mockSignInWithOtp).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'guest@example.com',
        options: expect.objectContaining({ shouldCreateUser: true }),
      }),
    );
  });

  it('returns ok:false with reason when OTP fails', async () => {
    mockSignInWithOtp.mockResolvedValue({ error: { message: 'Rate limit exceeded' } });
    const result = await signInOrCreateGuestWithOtp('guest@example.com');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('Rate limit exceeded');
  });

  it('normalises email to lowercase', async () => {
    mockSignInWithOtp.mockResolvedValue({ error: null });
    await signInOrCreateGuestWithOtp('GUEST@EXAMPLE.COM');
    expect(mockSignInWithOtp).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'guest@example.com' }),
    );
  });
});

// ─── createGuestProfile ────────────────────────────────────────────────────────
// The upsert call in createGuestProfile returns { error } directly (not via single()).
// Re-mock `from` to match the actual implementation.
describe('createGuestProfile', () => {
  const mockUpsert = jest.fn();

  beforeEach(() => {
    mockUpsert.mockReset();
    // Override the module-level mock for this describe block
    const supabaseModule = jest.requireMock('../../../lib/supabase') as {
      supabase: { from: jest.Mock };
    };
    supabaseModule.supabase.from = jest.fn(() => ({
      upsert: mockUpsert,
    }));
  });

  it('sets is_guest=true and has_completed_signup=false in the upsert payload', async () => {
    mockUpsert.mockResolvedValue({ error: null });
    const result = await createGuestProfile('user-123', 'guest@example.com', 'Guest User');
    expect(result.ok).toBe(true);
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'user-123',
        is_guest: true,
        has_completed_signup: false,
        role: 'client',
        is_active: true,
      }),
      expect.any(Object),
    );
  });

  it('returns ok:false when upsert fails', async () => {
    mockUpsert.mockResolvedValue({ error: { message: 'DB error' } });
    const result = await createGuestProfile('user-123', 'guest@example.com');
    expect(result.ok).toBe(false);
    expect(result.error).toBe('DB error');
  });

  it('uses email prefix as display_name when none provided', async () => {
    mockUpsert.mockResolvedValue({ error: null });
    await createGuestProfile('user-123', 'hello@world.com');
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ display_name: 'hello' }),
      expect.any(Object),
    );
  });
});

// ─── upgradeGuestToClient ──────────────────────────────────────────────────────
describe('upgradeGuestToClient', () => {
  beforeEach(() => mockRpc.mockReset());

  it('returns ok:true with organizationId on success', async () => {
    mockRpc.mockResolvedValue({
      data: { ok: true, organization_id: 'org-abc' },
      error: null,
    });
    const result = await upgradeGuestToClient('Acme Inc.');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.organizationId).toBe('org-abc');
    expect(mockRpc).toHaveBeenCalledWith('upgrade_guest_to_client', {
      p_company_name: 'Acme Inc.',
    });
  });

  it('passes null when no company name given', async () => {
    mockRpc.mockResolvedValue({
      data: { ok: true, organization_id: 'org-xyz' },
      error: null,
    });
    await upgradeGuestToClient();
    expect(mockRpc).toHaveBeenCalledWith('upgrade_guest_to_client', {
      p_company_name: null,
    });
  });

  it('returns ok:false when RPC returns not_a_guest', async () => {
    mockRpc.mockResolvedValue({
      data: { ok: false, reason: 'not_a_guest' },
      error: null,
    });
    const result = await upgradeGuestToClient();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('not_a_guest');
  });

  it('returns ok:false when RPC call itself errors', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: 'Connection error' },
    });
    const result = await upgradeGuestToClient();
    expect(result.ok).toBe(false);
  });
});
