import { getHeroResizeMode } from '../discoverImageMode';

describe('getHeroResizeMode', () => {
  it('uses contain on desktop width', () => {
    expect(getHeroResizeMode(false)).toBe('contain');
  });

  it('uses contain on mobile width (full image visible everywhere)', () => {
    expect(getHeroResizeMode(true)).toBe('contain');
  });
});
