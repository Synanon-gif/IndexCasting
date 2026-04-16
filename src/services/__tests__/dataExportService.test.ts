jest.mock('../../../lib/supabase', () => ({
  supabase: { rpc: jest.fn() },
}));

import { supabase } from '../../../lib/supabase';
import { formatExportPayload, downloadUserData } from '../dataExportService';

const rpc = supabase.rpc as jest.Mock;

describe('formatExportPayload', () => {
  it('maps snake_case RPC keys to camelCase and builds domains', () => {
    const raw = {
      export_version: 2,
      exported_at: '2026-01-01T00:00:00Z',
      user_id: 'u1',
      profile: { id: 'u1', email: 'a@b.de' },
      consent_log: [{ consent_type: 'privacy' }],
      legal_acceptances: [{ document_type: 'terms' }],
      organizations: [{ org_id: 'o1' }],
      messages_sent: [{ id: 'm1' }],
      messages_received: [{ id: 'm2' }],
      conversations: [{ id: 'c1' }],
      recruiting_chat_threads: [{ id: 't1' }],
      recruiting_chat_messages: [{ id: 'cm1' }],
      option_requests: [{ id: 'or1' }],
      calendar_events: [{ id: 'e1' }],
      calendar_entries: [{ id: 'ce1' }],
      notifications: [{ id: 'n1' }],
      activity_logs: [{ id: 'al1' }],
      audit_trail: [{ action_type: 'login' }],
      image_rights_confirmations: [{ model_id: 'mod1' }],
      push_tokens: [{ platform: 'ios' }],
    };

    const out = formatExportPayload(raw);

    expect(out.exportVersion).toBe(2);
    expect(out.userId).toBe('u1');
    expect(out.consentLog).toHaveLength(1);
    expect(out.legalAcceptances).toHaveLength(1);
    expect(out.messagesReceived).toHaveLength(1);
    expect(out.domains.messaging.messagesSent).toHaveLength(1);
    expect(out.domains.consent.legalAcceptances).toHaveLength(1);
    expect(out.domains.devices.pushTokens).toHaveLength(1);
    expect(out.domains.business.optionRequests).toHaveLength(1);
    expect(out.domains.business.optionRequestMessages).toEqual([]);
    expect(out.domains.model.profileRows).toEqual([]);
    expect(out.invitations).toEqual([]);
  });

  it('maps export v4 collections and domain buckets', () => {
    const raw = {
      export_version: 4,
      exported_at: '2026-04-16T00:00:00Z',
      user_id: 'subj-1',
      profile: { id: 'subj-1' },
      organizations: [
        { org_id: 'o1', org_name: 'Acme' },
        { org_id: 'o2', org_name: 'Beta' },
      ],
      option_request_messages: [{ id: 'orm1' }],
      option_documents: [{ id: 'od1' }],
      model_profile: [{ id: 'm1', user_id: 'subj-1' }],
      model_photos: [{ id: 'ph1' }],
      client_projects: [{ id: 'cp1', owner_ref: 'self' }],
      invitations: [{ id: 'inv1', email: 'x@y.com' }],
      booking_events: [{ id: 'be1' }],
      push_tokens: [{ id: 'pt1', platform: 'ios', has_token: true }],
    };
    const out = formatExportPayload(raw);
    expect(out.exportVersion).toBe(4);
    expect(out.optionRequestMessages).toHaveLength(1);
    expect(out.modelProfile).toHaveLength(1);
    expect(out.modelPhotos).toHaveLength(1);
    expect(out.clientProjects).toHaveLength(1);
    expect(out.invitations).toHaveLength(1);
    expect(out.bookingEvents).toHaveLength(1);
    expect(out.organizations).toHaveLength(2);
    expect(out.domains.memberships).toHaveLength(2);
    expect(out.domains.business.optionRequestMessages).toHaveLength(1);
    expect(out.domains.model.photos).toHaveLength(1);
    expect(out.pushTokens).toHaveLength(1);
    expect(out.domains.devices.pushTokens[0]).toEqual(expect.objectContaining({ has_token: true }));
  });

  it('returns empty arrays for missing collections', () => {
    const out = formatExportPayload({ export_version: 1, exported_at: '', user_id: 'x' });
    expect(out.activityLogs).toEqual([]);
    expect(out.domains.activityLogs).toEqual([]);
    expect(out.optionRequestMessages).toEqual([]);
    expect(out.domains.business.clientProjects).toEqual([]);
  });
});

describe('downloadUserData', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('calls export_user_data with p_user_id', async () => {
    rpc.mockResolvedValue({
      data: { export_version: 1, exported_at: 't', user_id: 'u-export' },
      error: null,
    });
    const result = await downloadUserData('user-abc');
    expect(rpc).toHaveBeenCalledWith('export_user_data', { p_user_id: 'user-abc' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.userId).toBe('u-export');
  });

  it('returns ok:false with reason when RPC errors (not swallowed)', async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { message: 'permission_denied' },
    });
    const result = await downloadUserData('u1');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('permission_denied');
  });

  it('returns ok:false on exception', async () => {
    rpc.mockRejectedValue(new Error('network'));
    const result = await downloadUserData('u1');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('exception');
  });
});
