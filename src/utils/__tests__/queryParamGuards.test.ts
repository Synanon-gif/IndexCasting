import {
  clampInviteOrClaimToken,
  clampQueryId,
  INVITE_OR_CLAIM_TOKEN_MAX_LEN,
  parseSharedSelectionParams,
  SHARED_SELECTION_NAME_MAX_LEN,
} from '../queryParamGuards';

describe('queryParamGuards', () => {
  test('clampInviteOrClaimToken rejects oversized tokens', () => {
    const huge = 'a'.repeat(INVITE_OR_CLAIM_TOKEN_MAX_LEN + 1);
    expect(clampInviteOrClaimToken(huge)).toBeNull();
    expect(clampInviteOrClaimToken('a'.repeat(INVITE_OR_CLAIM_TOKEN_MAX_LEN))).toBeTruthy();
  });

  test('clampQueryId rejects empty and oversized', () => {
    expect(clampQueryId('')).toBeNull();
    expect(clampQueryId('   ')).toBeNull();
    expect(clampQueryId('a'.repeat(200))).toBeNull();
    expect(clampQueryId('550e8400-e29b-41d4-a716-446655440000')).toBe(
      '550e8400-e29b-41d4-a716-446655440000',
    );
  });

  test('parseSharedSelectionParams caps name and ids', () => {
    const longName = 'x'.repeat(SHARED_SELECTION_NAME_MAX_LEN + 50);
    const manyIds = Array.from({ length: 600 }, (_, i) => `id-${i}`).join(',');
    const p = new URLSearchParams({
      shared: '1',
      name: longName,
      ids: manyIds,
    });
    const out = parseSharedSelectionParams(p);
    expect(out).not.toBeNull();
    expect(out!.name.length).toBe(SHARED_SELECTION_NAME_MAX_LEN);
    expect(out!.ids.length).toBeLessThanOrEqual(500);
  });

  test('parseSharedSelectionParams returns null when shared is not 1', () => {
    expect(parseSharedSelectionParams(new URLSearchParams({ shared: '0' }))).toBeNull();
  });
});
