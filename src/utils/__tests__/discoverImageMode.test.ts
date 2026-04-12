import { getHeroResizeMode } from '../discoverImageMode';

describe('getHeroResizeMode', () => {
  it('uses contain on desktop width', () => {
    expect(getHeroResizeMode(false)).toBe('contain');
  });

  it('uses cover on mobile width', () => {
    expect(getHeroResizeMode(true)).toBe('cover');
  });
});
