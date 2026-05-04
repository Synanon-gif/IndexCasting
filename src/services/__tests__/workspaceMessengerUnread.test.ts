import { messageRowCountsAsWorkspaceUnread } from '../messengerSupabase';

/**
 * Parity: `get_dashboard_summary` (migration unread filters) + Messages list
 * (`conversationHasUnreadForViewer`) — terminal metadata.status rows do not count.
 */
describe('messageRowCountsAsWorkspaceUnread', () => {
  it('treats normal text rows as countable', () => {
    expect(messageRowCountsAsWorkspaceUnread({ message_type: 'text', metadata: {} })).toBe(true);
  });

  it('excludes any row with metadata.status deleted', () => {
    expect(
      messageRowCountsAsWorkspaceUnread({
        message_type: 'booking',
        metadata: { status: 'deleted' },
      }),
    ).toBe(false);
    expect(
      messageRowCountsAsWorkspaceUnread({
        message_type: 'text',
        metadata: { status: 'deleted' },
      }),
    ).toBe(false);
  });

  it('excludes any row with metadata.status rejected', () => {
    expect(
      messageRowCountsAsWorkspaceUnread({
        message_type: 'booking',
        metadata: { status: 'rejected' },
      }),
    ).toBe(false);
    expect(
      messageRowCountsAsWorkspaceUnread({
        message_type: 'package',
        metadata: { status: 'rejected' },
      }),
    ).toBe(false);
  });

  it('counts booking rows that are still pending', () => {
    expect(
      messageRowCountsAsWorkspaceUnread({
        message_type: 'booking',
        metadata: { status: 'pending' },
      }),
    ).toBe(true);
  });

  it('counts booking rows with no metadata status', () => {
    expect(messageRowCountsAsWorkspaceUnread({ message_type: 'booking', metadata: null })).toBe(
      true,
    );
  });
});
