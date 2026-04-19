/**
 * Tests for src/services/agencySharePackagesSupabase.ts
 *
 * Agency-to-Agency Roster Share is a *sender + recipient* B2B flow that creates
 * `guest_links` rows with `purpose='agency_share'` and lets a recipient agency
 * import models into `model_agency_territories`. These tests cover:
 *
 *   1. Sender path:
 *      - createAgencyShareePackage validates org context, email, model ids
 *      - Maps RPC result correctly (array OR single object shape)
 *      - sendAgencyShareInviteEmail invokes the Edge Function with correct body
 *
 *   2. Recipient path:
 *      - getAgencyShareInbox returns Option-A `[]` on failure (fail-closed)
 *      - getAgencyShareModels surfaces RPC errors as serviceErr
 *      - importModelsFromAgencyShare normalises imports and reports skips
 *
 *   3. Multi-tenant safety:
 *      - All entry-points abort with `missing_organization_context` when the
 *        caller does not pass a valid org id (assertOrgContext guard).
 */

const mockRpc = jest.fn();
const mockInvoke = jest.fn();

jest.mock('../../../lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => mockRpc(...args),
    functions: {
      invoke: (...args: unknown[]) => mockInvoke(...args),
    },
  },
}));

import {
  createAgencyShareePackage,
  sendAgencyShareInviteEmail,
  getAgencyShareInbox,
  getAgencyShareModels,
  importModelsFromAgencyShare,
  buildAgencyShareUrl,
} from '../agencySharePackagesSupabase';

let errSpy: jest.SpyInstance;

beforeEach(() => {
  jest.resetAllMocks();
  errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  errSpy.mockRestore();
});

// ─── 1. createAgencyShareePackage ────────────────────────────────────────────

describe('createAgencyShareePackage', () => {
  it('returns missing_organization_context when org id is empty', async () => {
    const res = await createAgencyShareePackage({
      organizationId: '',
      recipientEmail: 'a@b.com',
      modelIds: ['m-1'],
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('missing_organization_context');
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('returns invalid_recipient_email for malformed email', async () => {
    const res = await createAgencyShareePackage({
      organizationId: 'org-1',
      recipientEmail: 'not-an-email',
      modelIds: ['m-1'],
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('invalid_recipient_email');
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('returns no_models_selected when modelIds is empty', async () => {
    const res = await createAgencyShareePackage({
      organizationId: 'org-1',
      recipientEmail: 'a@b.com',
      modelIds: [],
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('no_models_selected');
  });

  it('maps RPC array result into AgencyShareCreateResult', async () => {
    mockRpc.mockResolvedValue({
      data: [
        {
          link_id: 'link-1',
          target_agency_id: 'agency-2',
          target_agency_name: 'Other Agency',
        },
      ],
      error: null,
    });
    const res = await createAgencyShareePackage({
      organizationId: 'org-1',
      recipientEmail: 'a@b.com',
      modelIds: ['m-1', 'm-2'],
      label: 'Spring',
      expiresAt: '2026-12-31T00:00:00Z',
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data).toEqual({
        linkId: 'link-1',
        targetAgencyId: 'agency-2',
        targetAgencyName: 'Other Agency',
      });
    }
    expect(mockRpc).toHaveBeenCalledWith('create_agency_share_package', {
      p_organization_id: 'org-1',
      p_recipient_email: 'a@b.com',
      p_model_ids: ['m-1', 'm-2'],
      p_label: 'Spring',
      p_expires_at: '2026-12-31T00:00:00Z',
    });
  });

  it('maps RPC single-object result (PostgREST may unwrap single-row TABLE)', async () => {
    mockRpc.mockResolvedValue({
      data: { link_id: 'link-2', target_agency_id: 'agency-3', target_agency_name: 'X' },
      error: null,
    });
    const res = await createAgencyShareePackage({
      organizationId: 'org-1',
      recipientEmail: 'a@b.com',
      modelIds: ['m-1'],
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.linkId).toBe('link-2');
  });

  it('surfaces RPC error message as serviceErr', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { code: 'P0001', message: 'recipient_agency_not_found' },
    });
    const res = await createAgencyShareePackage({
      organizationId: 'org-1',
      recipientEmail: 'a@b.com',
      modelIds: ['m-1'],
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('recipient_agency_not_found');
  });

  it('returns malformed_rpc_response when link_id missing', async () => {
    mockRpc.mockResolvedValue({ data: { target_agency_id: 'a' }, error: null });
    const res = await createAgencyShareePackage({
      organizationId: 'org-1',
      recipientEmail: 'a@b.com',
      modelIds: ['m-1'],
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('malformed_rpc_response');
  });
});

// ─── 2. sendAgencyShareInviteEmail ───────────────────────────────────────────

describe('sendAgencyShareInviteEmail', () => {
  it('aborts without org context', async () => {
    const res = await sendAgencyShareInviteEmail({
      linkId: 'l',
      to: 'x@y.com',
      senderOrganizationId: '',
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('missing_organization_context');
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('rejects invalid email without invoking the edge function', async () => {
    const res = await sendAgencyShareInviteEmail({
      linkId: 'link-1',
      to: 'bad-email',
      senderOrganizationId: 'org-1',
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('invalid_email');
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('invokes send-agency-share-invite with correct body on success', async () => {
    mockInvoke.mockResolvedValue({
      data: { ok: true, email_id: 'email-123' },
      error: null,
    });
    const res = await sendAgencyShareInviteEmail({
      linkId: 'link-1',
      to: 'recipient@example.com',
      senderOrganizationId: 'org-1',
      senderAgencyName: 'Agency A',
      recipientAgencyName: 'Agency B',
      inviterName: 'Alice',
      modelCount: 3,
      label: 'Spring',
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.emailId).toBe('email-123');
    expect(mockInvoke).toHaveBeenCalledWith('send-agency-share-invite', {
      body: {
        link_id: 'link-1',
        to: 'recipient@example.com',
        sender_organization_id: 'org-1',
        sender_agency_name: 'Agency A',
        recipient_agency_name: 'Agency B',
        inviter_name: 'Alice',
        model_count: 3,
        label: 'Spring',
      },
    });
  });

  it('returns email_send_failed when edge function reports !ok', async () => {
    mockInvoke.mockResolvedValue({
      data: { ok: false, error: 'resend_500' },
      error: null,
    });
    const res = await sendAgencyShareInviteEmail({
      linkId: 'link-1',
      to: 'a@b.com',
      senderOrganizationId: 'org-1',
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('resend_500');
  });
});

// ─── 3. getAgencyShareInbox (Option A — fail-closed) ─────────────────────────

describe('getAgencyShareInbox', () => {
  it('returns [] without org context (no RPC call)', async () => {
    const out = await getAgencyShareInbox('');
    expect(out).toEqual([]);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('maps RPC rows to AgencyShareInboxEntry array', async () => {
    mockRpc.mockResolvedValue({
      data: [
        {
          link_id: 'link-1',
          sender_agency_id: 'agency-A',
          sender_agency_name: 'Agency A',
          model_count: 5,
          label: 'Spring',
          type: 'portfolio',
          expires_at: '2026-12-01T00:00:00Z',
          is_active: true,
          created_at: '2026-04-01T00:00:00Z',
          first_accessed_at: null,
        },
      ],
      error: null,
    });
    const out = await getAgencyShareInbox('org-1');
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({
      linkId: 'link-1',
      senderAgencyId: 'agency-A',
      senderAgencyName: 'Agency A',
      modelCount: 5,
      label: 'Spring',
      type: 'portfolio',
      expiresAt: '2026-12-01T00:00:00Z',
      isActive: true,
      createdAt: '2026-04-01T00:00:00Z',
      firstAccessedAt: null,
    });
    expect(mockRpc).toHaveBeenCalledWith('get_agency_share_inbox', {
      p_organization_id: 'org-1',
    });
  });

  it('returns [] on RPC error (fail-closed, no leak)', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'rls_denied' } });
    const out = await getAgencyShareInbox('org-1');
    expect(out).toEqual([]);
  });

  it('returns [] on exception', async () => {
    mockRpc.mockRejectedValue(new Error('network'));
    const out = await getAgencyShareInbox('org-1');
    expect(out).toEqual([]);
  });
});

// ─── 4. getAgencyShareModels ─────────────────────────────────────────────────

describe('getAgencyShareModels', () => {
  it('returns missing_link_id for empty input', async () => {
    const res = await getAgencyShareModels('  ');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('missing_link_id');
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('surfaces RPC error as serviceErr', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'access_denied' } });
    const res = await getAgencyShareModels('link-1');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('access_denied');
  });

  it('maps RPC rows when no portfolio paths require signing', async () => {
    mockRpc.mockResolvedValue({
      data: [
        {
          id: 'model-1',
          name: 'Alex',
          height: 178,
          bust: 88,
          waist: 60,
          hips: 90,
          city: 'Berlin',
          hair_color: 'brown',
          eye_color: 'blue',
          sex: 'female',
          portfolio_images: [],
          polaroids: [],
          effective_city: 'Berlin',
          user_id: 'user-1',
          has_account: true,
        },
      ],
      error: null,
    });
    const res = await getAgencyShareModels('link-1');
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data).toHaveLength(1);
      expect(res.data[0]).toMatchObject({
        id: 'model-1',
        name: 'Alex',
        bust: 88,
        hasAccount: true,
        userId: 'user-1',
        effectiveCity: 'Berlin',
      });
    }
    // Edge function for signing is NOT invoked when there are no storage paths
    expect(mockInvoke).not.toHaveBeenCalled();
  });
});

// ─── 5. importModelsFromAgencyShare ──────────────────────────────────────────

describe('importModelsFromAgencyShare', () => {
  it('aborts without org context', async () => {
    const res = await importModelsFromAgencyShare({
      organizationId: '',
      linkId: 'link-1',
      imports: [{ modelId: 'm-1', countryCodes: ['DE'] }],
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('missing_organization_context');
  });

  it('rejects when no usable imports remain after normalisation', async () => {
    const res = await importModelsFromAgencyShare({
      organizationId: 'org-1',
      linkId: 'link-1',
      imports: [
        { modelId: '   ', countryCodes: ['DE'] },
        { modelId: 'm-1', countryCodes: ['XYZ', 'A1'] }, // both invalid
      ],
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('no_imports');
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('uppercases ISO codes and forwards snake_case payload to RPC', async () => {
    mockRpc.mockResolvedValue({
      data: {
        imported: [{ model_id: 'm-1', country_code: 'DE' }],
        skipped: [],
      },
      error: null,
    });
    const res = await importModelsFromAgencyShare({
      organizationId: 'org-1',
      linkId: 'link-1',
      imports: [{ modelId: 'm-1', countryCodes: ['de', 'fr'] }],
    });
    expect(res.ok).toBe(true);
    expect(mockRpc).toHaveBeenCalledWith('import_models_from_agency_share', {
      p_organization_id: 'org-1',
      p_link_id: 'link-1',
      p_imports: [{ model_id: 'm-1', country_codes: ['DE', 'FR'] }],
    });
  });

  it('reports MAT conflicts via skipped[]', async () => {
    mockRpc.mockResolvedValue({
      data: {
        imported: [{ model_id: 'm-1', country_code: 'DE' }],
        skipped: [
          {
            model_id: 'm-2',
            country_code: 'GB',
            existing_agency_id: 'other-agency',
          },
        ],
      },
      error: null,
    });
    const res = await importModelsFromAgencyShare({
      organizationId: 'org-1',
      linkId: 'link-1',
      imports: [
        { modelId: 'm-1', countryCodes: ['DE'] },
        { modelId: 'm-2', countryCodes: ['GB'] },
      ],
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.imported).toEqual([{ modelId: 'm-1', countryCode: 'DE' }]);
      expect(res.data.skipped).toEqual([
        { modelId: 'm-2', countryCode: 'GB', existingAgencyId: 'other-agency' },
      ]);
    }
  });

  it('returns rpc_error message when RPC fails', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'not_recipient_agency' } });
    const res = await importModelsFromAgencyShare({
      organizationId: 'org-1',
      linkId: 'link-1',
      imports: [{ modelId: 'm-1', countryCodes: ['DE'] }],
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('not_recipient_agency');
  });
});

// ─── 6. buildAgencyShareUrl ──────────────────────────────────────────────────

describe('buildAgencyShareUrl', () => {
  it('returns canonical https URL with the agency_share query param', () => {
    const url = buildAgencyShareUrl('link-1');
    expect(url).toContain('agency_share=link-1');
    // Must not collide with ?guest= or ?shared= entry-points.
    expect(url).not.toContain('guest=');
    expect(url).not.toContain('shared=');
  });

  it('encodes link ids safely', () => {
    const url = buildAgencyShareUrl(' x y ');
    expect(url).toMatch(/agency_share=/);
  });
});
