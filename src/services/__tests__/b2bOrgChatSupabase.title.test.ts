import { getB2BConversationTitleForViewer } from '../b2bOrgChatSupabase';
import type { Conversation } from '../messengerSupabase';
import { uiCopy } from '../../constants/uiCopy';

const rpc = jest.fn();
const maybeSingle = jest.fn();

jest.mock('../../../lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => maybeSingle(),
        }),
      }),
    }),
  },
}));

describe('getB2BConversationTitleForViewer', () => {
  beforeEach(() => {
    rpc.mockReset();
    maybeSingle.mockReset();
  });

  it('uses get_b2b_counterparty_org_name RPC result when present', async () => {
    rpc.mockResolvedValue({ data: 'Studio North', error: null });
    const c = {
      client_organization_id: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
      agency_organization_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      title: 'Client ↔ Agency',
    } as unknown as Conversation;

    const t = await getB2BConversationTitleForViewer({
      conversation: c,
      viewerOrganizationId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
    });
    expect(t).toBe('Studio North');
    expect(rpc).toHaveBeenCalledWith('get_b2b_counterparty_org_name', {
      p_viewer_org_id: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
      p_client_org_id: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
      p_agency_org_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    });
  });

  it('falls back when RPC returns empty and direct org select has a name', async () => {
    rpc.mockResolvedValue({ data: '', error: null });
    maybeSingle.mockResolvedValue({
      data: { name: 'Direct Org' },
      error: null,
    });
    const c = {
      client_organization_id: 'c1',
      agency_organization_id: 'a1',
      title: 'Client ↔ Agency',
    } as unknown as Conversation;

    const t = await getB2BConversationTitleForViewer({
      conversation: c,
      viewerOrganizationId: 'c1',
    });
    expect(t).toBe('Direct Org');
  });

  it('uses chatPartnerFallback when nothing else is available', async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    maybeSingle.mockResolvedValue({ data: null, error: null });
    const c = {
      client_organization_id: 'c1',
      agency_organization_id: 'a1',
      title: 'Client ↔ Agency',
    } as unknown as Conversation;

    const t = await getB2BConversationTitleForViewer({
      conversation: c,
      viewerOrganizationId: 'c1',
    });
    expect(t).toBe(uiCopy.b2bChat.chatPartnerFallback);
  });
});
