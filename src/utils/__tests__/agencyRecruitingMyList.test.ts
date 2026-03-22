import { mergeAgencyRecruitingMyListIds } from '../agencyRecruitingMyList';

describe('mergeAgencyRecruitingMyListIds', () => {
  it('deduplicates shortlist and chat threads, shortlist order first', () => {
    expect(mergeAgencyRecruitingMyListIds(['a', 'b'], ['b', 'c'])).toEqual(['a', 'b', 'c']);
  });

  it('handles empty shortlist', () => {
    expect(mergeAgencyRecruitingMyListIds([], ['x'])).toEqual(['x']);
  });

  it('handles no chat ids', () => {
    expect(mergeAgencyRecruitingMyListIds(['a'], [])).toEqual(['a']);
  });
});
