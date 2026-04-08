jest.mock('../../../lib/supabase', () => ({
  supabase: { rpc: jest.fn() },
}));

import { formatExportPayload } from '../dataExportService';

describe('formatExportPayload', () => {
  it('maps snake_case RPC keys to camelCase and builds domains', () => {
    const raw = {
      export_version: 2,
      exported_at:    '2026-01-01T00:00:00Z',
      user_id:        'u1',
      profile:        { id: 'u1', email: 'a@b.de' },
      consent_log:    [{ consent_type: 'privacy' }],
      legal_acceptances: [{ document_type: 'terms' }],
      organizations:  [{ org_id: 'o1' }],
      messages_sent:  [{ id: 'm1' }],
      messages_received: [{ id: 'm2' }],
      conversations:  [{ id: 'c1' }],
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
  });

  it('returns empty arrays for missing collections', () => {
    const out = formatExportPayload({ export_version: 1, exported_at: '', user_id: 'x' });
    expect(out.activityLogs).toEqual([]);
    expect(out.domains.activityLogs).toEqual([]);
  });
});
