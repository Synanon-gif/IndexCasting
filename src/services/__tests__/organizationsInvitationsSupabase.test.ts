jest.mock('../../../lib/supabase', () => ({
  supabase: {
    rpc: jest.fn(),
    from: jest.fn(),
    auth: {
      getUser: jest.fn(() => Promise.resolve({ data: { user: { id: 'user-1' } }, error: null })),
    },
    functions: {
      invoke: jest.fn(),
    },
  },
}));

import { supabase } from '../../../lib/supabase';
import {
  ensureAgencyOrganization,
  ensureClientOrganization,
  getInvitationPreview,
  acceptOrganizationInvitation,
  buildOrganizationInviteUrl,
  getMyClientMemberRole,
  dissolveOrganization,
  cancelDissolvedOrgStripeSubscription,
} from '../organizationsInvitationsSupabase';

const rpc = supabase.rpc as jest.Mock;
const invoke = supabase.functions.invoke as jest.Mock;

describe('organizationsInvitationsSupabase', () => {
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('buildOrganizationInviteUrl (ohne Web): Deep-Link-Pfad', () => {
    expect(buildOrganizationInviteUrl('tok-1')).toBe('/?invite=tok-1');
  });

  it('ensureAgencyOrganization gibt UUID-String zurück', async () => {
    rpc.mockResolvedValueOnce({
      data: '11111111-1111-1111-1111-111111111111',
      error: null,
    });
    const id = await ensureAgencyOrganization('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
    expect(id).toBe('11111111-1111-1111-1111-111111111111');
    expect(rpc).toHaveBeenCalledWith('ensure_agency_organization', {
      p_agency_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    });
  });

  it('ensureAgencyOrganization: null bei RPC-Fehler', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'forbidden' } });
    await expect(ensureAgencyOrganization('x')).resolves.toBeNull();
  });

  it('ensureClientOrganization: null wenn data kein string', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: null });
    await expect(ensureClientOrganization()).resolves.toBeNull();
  });

  it('getMyClientMemberRole: maps RPC row', async () => {
    rpc.mockResolvedValueOnce({
      data: [{ member_role: 'owner', organization_id: 'org-client-1' }],
      error: null,
    });
    await expect(getMyClientMemberRole()).resolves.toEqual({
      member_role: 'owner',
      organization_id: 'org-client-1',
    });
    expect(rpc).toHaveBeenCalledWith('get_my_client_member_role');
  });

  it('getMyClientMemberRole: null wenn kein org', async () => {
    rpc.mockResolvedValueOnce({ data: [], error: null });
    await expect(getMyClientMemberRole()).resolves.toBeNull();
  });

  it('getInvitationPreview mappt erste Tabellenzeile', async () => {
    rpc.mockResolvedValueOnce({
      data: [
        {
          org_name: 'Acme',
          org_type: 'agency',
          invite_role: 'booker',
          expires_at: '2099-01-01T00:00:00.000Z',
          invited_email_hint: 'b***@acme.com',
        },
      ],
      error: null,
    });
    const p = await getInvitationPreview('secret-token');
    expect(p).toEqual({
      org_name: 'Acme',
      org_type: 'agency',
      invite_role: 'booker',
      expires_at: '2099-01-01T00:00:00.000Z',
      invited_email_hint: 'b***@acme.com',
    });
    expect(rpc).toHaveBeenCalledWith('get_invitation_preview', { p_token: 'secret-token' });
  });

  it('getInvitationPreview mappt invited_email_hint=null wenn nicht vorhanden', async () => {
    rpc.mockResolvedValueOnce({
      data: [
        {
          org_name: 'Acme',
          org_type: 'agency',
          invite_role: 'booker',
          expires_at: '2099-01-01T00:00:00.000Z',
          invited_email_hint: null,
        },
      ],
      error: null,
    });
    const p = await getInvitationPreview('secret-token');
    expect(p?.invited_email_hint).toBeNull();
  });

  it('getInvitationPreview: null wenn leer', async () => {
    rpc.mockResolvedValueOnce({ data: [], error: null });
    await expect(getInvitationPreview('x')).resolves.toBeNull();
  });

  it('acceptOrganizationInvitation: Erfolg', async () => {
    rpc.mockResolvedValueOnce({
      data: { ok: true, organization_id: 'org-uuid' },
      error: null,
    });
    await expect(acceptOrganizationInvitation('t')).resolves.toEqual({
      ok: true,
      organization_id: 'org-uuid',
    });
  });

  it('acceptOrganizationInvitation: RPC-Fehlertext', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'network' } });
    await expect(acceptOrganizationInvitation('t')).resolves.toEqual({
      ok: false,
      error: 'network',
    });
  });

  it('acceptOrganizationInvitation: ok false im JSON-Body', async () => {
    rpc.mockResolvedValueOnce({
      data: { ok: false, error: 'email_mismatch' },
      error: null,
    });
    await expect(acceptOrganizationInvitation('t')).resolves.toEqual({
      ok: false,
      error: 'email_mismatch',
    });
  });

  it('dissolveOrganization: Erfolg', async () => {
    rpc.mockResolvedValueOnce({
      data: {
        ok: true,
        organization_id: 'org-uuid-1',
        organization_name: 'Test Org',
        dissolved_at: '2026-04-18T00:00:00Z',
        scheduled_purge_at: '2026-05-18T00:00:00Z',
        notified_members: 2,
        stripe_customer_id: 'cus_x',
        stripe_subscription_id: 'sub_x',
      },
      error: null,
    });
    const res = await dissolveOrganization('org-uuid-1');
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.organizationId).toBe('org-uuid-1');
      expect(res.data.scheduledPurgeAt).toBe('2026-05-18T00:00:00Z');
      expect(res.data.stripeSubscriptionId).toBe('sub_x');
    }
    expect(rpc).toHaveBeenCalledWith('dissolve_organization', {
      p_organization_id: 'org-uuid-1',
    });
  });

  it('dissolveOrganization: PostgREST-Fehler', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'permission denied' } });
    await expect(dissolveOrganization('org-x')).resolves.toEqual({
      ok: false,
      error: 'permission denied',
    });
  });

  it('dissolveOrganization: ok false im JSON-Body', async () => {
    rpc.mockResolvedValueOnce({
      data: { ok: false, error: 'forbidden_not_owner' },
      error: null,
    });
    await expect(dissolveOrganization('org-x')).resolves.toEqual({
      ok: false,
      error: 'forbidden_not_owner',
    });
  });

  describe('cancelDissolvedOrgStripeSubscription', () => {
    let consoleWarnSpy: jest.SpyInstance;

    beforeEach(() => {
      consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
      consoleWarnSpy.mockRestore();
    });

    it('Erfolg: liefert stripe-Felder aus Edge-Function-Antwort', async () => {
      invoke.mockResolvedValueOnce({
        data: {
          ok: true,
          stripe_subscription_id: 'sub_abc',
          stripe_status: 'canceled',
          note: 'cancelled at period end',
        },
        error: null,
      });
      const res = await cancelDissolvedOrgStripeSubscription('org-uuid-1');
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.data.stripeSubscriptionId).toBe('sub_abc');
        expect(res.data.stripeStatus).toBe('canceled');
        expect(res.data.note).toBe('cancelled at period end');
      }
      expect(invoke).toHaveBeenCalledWith('stripe-cancel-dissolved-org', {
        body: { organization_id: 'org-uuid-1' },
      });
    });

    it('Edge-Function transport error: ok=false, fail-tolerant', async () => {
      invoke.mockResolvedValueOnce({
        data: null,
        error: { message: 'network failure' },
      });
      const res = await cancelDissolvedOrgStripeSubscription('org-x');
      expect(res).toEqual({ ok: false, error: 'network failure' });
    });

    it('Edge-Function liefert ok:false (z. B. kein Stripe-Sub vorhanden)', async () => {
      invoke.mockResolvedValueOnce({
        data: { ok: false, error: 'no_stripe_subscription' },
        error: null,
      });
      const res = await cancelDissolvedOrgStripeSubscription('org-x');
      expect(res).toEqual({ ok: false, error: 'no_stripe_subscription' });
    });

    it('Exception im invoke (Throw): fängt ab und liefert serviceErr', async () => {
      invoke.mockRejectedValueOnce(new Error('boom'));
      const res = await cancelDissolvedOrgStripeSubscription('org-x');
      expect(res).toEqual({ ok: false, error: 'boom' });
    });
  });
});
