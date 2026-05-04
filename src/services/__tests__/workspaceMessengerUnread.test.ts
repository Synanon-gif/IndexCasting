import { messageRowCountsAsWorkspaceUnread } from '../messengerSupabase';

/**
 * Parity: `get_dashboard_summary` (migration `20261307_get_dashboard_summary_workspace_unread_parity.sql`)
 * excludes the same terminal booking-card rows from unread as the Messages list (`conversationHasUnreadForViewer`).
 */
describe('messageRowCountsAsWorkspaceUnread', () => {
  it('treats non-booking rows as countable', () => {
    expect(messageRowCountsAsWorkspaceUnread({ message_type: 'text', metadata: {} })).toBe(true);
  });

  it('excludes booking rows with metadata.status deleted', () => {
    expect(
      messageRowCountsAsWorkspaceUnread({
        message_type: 'booking',
        metadata: { status: 'deleted' },
      }),
    ).toBe(false);
  });

  it('excludes booking rows with metadata.status rejected', () => {
    expect(
      messageRowCountsAsWorkspaceUnread({
        message_type: 'booking',
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
