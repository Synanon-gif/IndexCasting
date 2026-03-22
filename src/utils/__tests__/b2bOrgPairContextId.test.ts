import { b2bOrgPairContextId } from '../b2bOrgPairContextId';

describe('b2bOrgPairContextId', () => {
  it('orders UUIDs lexicographically for a stable key', () => {
    const b = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
    const a = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    const forward = b2bOrgPairContextId(b, a);
    const reverse = b2bOrgPairContextId(a, b);
    expect(forward).toBe(reverse);
    expect(forward).toBe(`b2b:${a}:${b}`);
  });
});
