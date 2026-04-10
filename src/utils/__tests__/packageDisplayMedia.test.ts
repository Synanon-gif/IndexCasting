import {
  getPackageCoverRawRef,
  getPackageDisplayImages,
  normalizePackageType,
} from '../packageDisplayMedia';

describe('normalizePackageType', () => {
  it('maps polaroid variants to polaroid', () => {
    expect(normalizePackageType('polaroid')).toBe('polaroid');
    expect(normalizePackageType('POLAROID')).toBe('polaroid');
    expect(normalizePackageType(' Polaroid ')).toBe('polaroid');
  });

  it('defaults unknown to portfolio', () => {
    expect(normalizePackageType('portfolio')).toBe('portfolio');
    expect(normalizePackageType('PORTFOLIO')).toBe('portfolio');
    expect(normalizePackageType(undefined)).toBe('portfolio');
    expect(normalizePackageType(null)).toBe('portfolio');
    expect(normalizePackageType('')).toBe('portfolio');
    expect(normalizePackageType('other')).toBe('portfolio');
  });
});

describe('getPackageDisplayImages', () => {
  const m = {
    portfolio_images: ['p1', 'p2'],
    polaroids: ['z1'],
  };

  it('returns portfolio_images only for portfolio package', () => {
    expect(getPackageDisplayImages(m, 'portfolio')).toEqual(['p1', 'p2']);
  });

  it('returns polaroids only for polaroid package', () => {
    expect(getPackageDisplayImages(m, 'polaroid')).toEqual(['z1']);
  });

  it('returns empty when model missing', () => {
    expect(getPackageDisplayImages(undefined, 'polaroid')).toEqual([]);
    expect(getPackageDisplayImages(null, 'portfolio')).toEqual([]);
  });

  it('returns empty arrays when fields missing', () => {
    expect(getPackageDisplayImages({}, 'polaroid')).toEqual([]);
    expect(getPackageDisplayImages({}, 'portfolio')).toEqual([]);
  });
});

describe('getPackageCoverRawRef', () => {
  it('returns first image of the package-typed array', () => {
    expect(
      getPackageCoverRawRef(
        { portfolio_images: ['a'], polaroids: ['b'] },
        'polaroid',
      ),
    ).toBe('b');
    expect(
      getPackageCoverRawRef(
        { portfolio_images: ['a'], polaroids: ['b'] },
        'portfolio',
      ),
    ).toBe('a');
  });
});
