import { modelEligibleForAgencyRoster } from '../../utils/modelRosterEligibility';

describe('modelEligibleForAgencyRoster', () => {
  const mat = new Set(['m1', 'm2']);

  it('includes models with a linked user_id even without MAT', () => {
    expect(modelEligibleForAgencyRoster({ id: 'x', user_id: 'u1' }, mat)).toBe(true);
  });

  it('includes unlinked models that have MAT for this agency', () => {
    expect(modelEligibleForAgencyRoster({ id: 'm1', user_id: null }, mat)).toBe(true);
  });

  it('excludes unlinked models with no MAT for this agency', () => {
    expect(modelEligibleForAgencyRoster({ id: 'ghost', user_id: null }, mat)).toBe(false);
  });
});
