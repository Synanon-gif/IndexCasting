import {
  getProviderForUrl,
  listProviderIds,
  listProviders,
  resetProvidersForTest,
  setProvidersForTest,
} from '../providerRegistry';
import { createMediaslidePackageProvider } from '../mediaslidePackageProvider';
import { createNetwalkPackageProvider } from '../netwalkPackageProvider';
import type { PackageProvider } from '../packageImportTypes';

afterEach(() => {
  resetProvidersForTest();
});

describe('providerRegistry — defaults', () => {
  it('registers mediaslide and netwalk providers in order', () => {
    const ids = listProviderIds();
    expect(ids).toEqual(['mediaslide', 'netwalk']);
  });

  it('listProviders returns a defensive copy', () => {
    const a = listProviders();
    a.pop();
    expect(listProviders()).toHaveLength(2);
  });
});

describe('providerRegistry — getProviderForUrl', () => {
  it('returns mediaslide for mediaslide URLs', () => {
    const p = getProviderForUrl(
      'https://hausofhay.mediaslide.com/package/view/123/abcdef/456/abcdef',
    );
    expect(p?.id).toBe('mediaslide');
  });

  it('returns netwalk for netwalk URLs', () => {
    expect(getProviderForUrl('https://demo.netwalk.eu/p/123')?.id).toBe('netwalk');
    expect(getProviderForUrl('https://x.netwalk.app/y')?.id).toBe('netwalk');
    expect(getProviderForUrl('https://something.netwalkapp.com/z')?.id).toBe('netwalk');
  });

  it('returns null for unknown providers', () => {
    expect(getProviderForUrl('https://example.com/x')).toBeNull();
    expect(getProviderForUrl('https://random.io/p')).toBeNull();
  });

  it('returns null for empty / whitespace input', () => {
    expect(getProviderForUrl('')).toBeNull();
    expect(getProviderForUrl('   ')).toBeNull();
  });

  it('does not throw if a provider.detect throws — falls through', () => {
    const explosive: PackageProvider = {
      id: 'mediaslide',
      detect: () => {
        throw new Error('boom');
      },
      analyze: async () => [],
    };
    const fallback = createNetwalkPackageProvider();
    setProvidersForTest([explosive, fallback]);
    expect(() => getProviderForUrl('https://x.netwalk.eu/y')).not.toThrow();
    expect(getProviderForUrl('https://x.netwalk.eu/y')?.id).toBe('netwalk');
  });
});

describe('PackageProvider contract — every registered provider', () => {
  for (const provider of [createMediaslidePackageProvider(), createNetwalkPackageProvider()]) {
    describe(provider.id, () => {
      it('has a stable id string', () => {
        expect(typeof provider.id).toBe('string');
        expect(provider.id.length).toBeGreaterThan(0);
      });

      it('detect() is deterministic', () => {
        const url = 'https://demo.netwalk.eu/p/123';
        const a = provider.detect({ url });
        const b = provider.detect({ url });
        expect(a).toBe(b);
      });

      it('detect() returns false for empty / invalid URL', () => {
        expect(provider.detect({ url: '' })).toBe(false);
        expect(provider.detect({ url: 'not-a-url' })).toBe(false);
      });
    });
  }
});

describe('netwalkPackageProvider — stub behaviour', () => {
  const provider = createNetwalkPackageProvider();

  it('detect() matches expected hosts', () => {
    expect(provider.detect({ url: 'https://demo.netwalk.eu/x' })).toBe(true);
    expect(provider.detect({ url: 'https://x.netwalk.app/y' })).toBe(true);
    expect(provider.detect({ url: 'https://x.netwalkapp.com/y' })).toBe(true);
  });

  it('detect() does NOT match foreign hosts', () => {
    expect(provider.detect({ url: 'https://mediaslide.com/x' })).toBe(false);
    expect(provider.detect({ url: 'https://example.com/x' })).toBe(false);
  });

  it('analyze() throws netwalk_provider_not_implemented', async () => {
    await expect(provider.analyze({ url: 'https://demo.netwalk.eu/x' })).rejects.toThrow(
      'netwalk_provider_not_implemented',
    );
  });
});
