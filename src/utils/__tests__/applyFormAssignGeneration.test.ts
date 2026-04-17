import { isStaleSlotGeneration } from '../applyFormAssignGeneration';

describe('applyFormAssignGeneration', () => {
  it('isStaleSlotGeneration is false when generations match', () => {
    expect(isStaleSlotGeneration(3, 3)).toBe(false);
  });
  it('isStaleSlotGeneration is true when a newer assign started (same slot)', () => {
    expect(isStaleSlotGeneration(1, 2)).toBe(true);
  });
  it('treats different numbers as stale', () => {
    expect(isStaleSlotGeneration(5, 4)).toBe(true);
  });
});
