import {
  defaultDisplayModeForPackage,
  getPackageCoverRawRef,
  getPackageDisplayImages,
  normalizePackageType,
  packageHasBothBuckets,
} from '../packageDisplayMedia';

describe('normalizePackageType', () => {
  it('maps polaroid variants to polaroid', () => {
    expect(normalizePackageType('polaroid')).toBe('polaroid');
    expect(normalizePackageType('POLAROID')).toBe('polaroid');
    expect(normalizePackageType(' Polaroid ')).toBe('polaroid');
  });

  it('maps mixed variants to mixed', () => {
    expect(normalizePackageType('mixed')).toBe('mixed');
    expect(normalizePackageType('MIXED')).toBe('mixed');
    expect(normalizePackageType(' Mixed ')).toBe('mixed');
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

describe('defaultDisplayModeForPackage', () => {
  it('matches the package type for non-mixed', () => {
    expect(defaultDisplayModeForPackage('portfolio')).toBe('portfolio');
    expect(defaultDisplayModeForPackage('polaroid')).toBe('polaroid');
  });

  it('defaults mixed to portfolio', () => {
    expect(defaultDisplayModeForPackage('mixed')).toBe('portfolio');
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

  it('mixed: defaults to portfolio when no displayMode given', () => {
    expect(getPackageDisplayImages(m, 'mixed')).toEqual(['p1', 'p2']);
  });

  it('mixed: respects displayMode', () => {
    expect(getPackageDisplayImages(m, 'mixed', 'portfolio')).toEqual(['p1', 'p2']);
    expect(getPackageDisplayImages(m, 'mixed', 'polaroid')).toEqual(['z1']);
  });
});

describe('packageHasBothBuckets', () => {
  it('returns false for non-mixed packages', () => {
    expect(packageHasBothBuckets({ portfolio_images: ['a'], polaroids: ['b'] }, 'portfolio')).toBe(
      false,
    );
    expect(packageHasBothBuckets({ portfolio_images: ['a'], polaroids: ['b'] }, 'polaroid')).toBe(
      false,
    );
  });

  it('returns true only when both buckets have non-empty content', () => {
    expect(packageHasBothBuckets({ portfolio_images: ['a'], polaroids: ['b'] }, 'mixed')).toBe(
      true,
    );
    expect(packageHasBothBuckets({ portfolio_images: ['a'], polaroids: [] }, 'mixed')).toBe(false);
    expect(packageHasBothBuckets({ portfolio_images: [], polaroids: ['b'] }, 'mixed')).toBe(false);
    expect(packageHasBothBuckets({ portfolio_images: [' '], polaroids: ['b'] }, 'mixed')).toBe(
      false,
    );
    expect(packageHasBothBuckets(null, 'mixed')).toBe(false);
  });
});

describe('getPackageCoverRawRef', () => {
  it('returns first image of the package-typed array', () => {
    expect(getPackageCoverRawRef({ portfolio_images: ['a'], polaroids: ['b'] }, 'polaroid')).toBe(
      'b',
    );
    expect(getPackageCoverRawRef({ portfolio_images: ['a'], polaroids: ['b'] }, 'portfolio')).toBe(
      'a',
    );
  });

  it('mixed: prefers requested mode then falls back to other bucket', () => {
    expect(getPackageCoverRawRef({ portfolio_images: ['a'], polaroids: ['b'] }, 'mixed')).toBe('a');
    expect(
      getPackageCoverRawRef({ portfolio_images: [], polaroids: ['b'] }, 'mixed', 'portfolio'),
    ).toBe('b');
    expect(
      getPackageCoverRawRef({ portfolio_images: ['a'], polaroids: [] }, 'mixed', 'polaroid'),
    ).toBe('a');
  });
});
