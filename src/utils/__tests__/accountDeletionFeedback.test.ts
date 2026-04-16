import { messageForDissolveOrganizationError } from '../accountDeletionFeedback';

describe('messageForDissolveOrganizationError', () => {
  it('returns default when error empty', () => {
    const msg = messageForDissolveOrganizationError('');
    expect(msg.length).toBeGreaterThan(0);
  });

  it('maps forbidden_not_owner', () => {
    expect(messageForDissolveOrganizationError('forbidden_not_owner')).toContain('owner');
  });

  it('maps FK-style failures without leaking SQL', () => {
    const msg = messageForDissolveOrganizationError(
      'update or delete on table "organizations" violates foreign key constraint',
    );
    expect(msg.toLowerCase()).toMatch(/related records|support/);
    expect(msg).not.toContain('organizations');
  });
});
