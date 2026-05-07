import { assertLocalIndexCastingPhotoUrlOrPath } from '../assertLocalIndexCastingPhotoUrlOrPath';

describe('assertLocalIndexCastingPhotoUrlOrPath', () => {
  it('accepts canonical IndexCasting storage URI under model-photos', () => {
    expect(() =>
      assertLocalIndexCastingPhotoUrlOrPath(
        'supabase-storage://documentspictures/model-photos/550e8400-e29b-41d4-a716-446655440000/cover.jpg',
      ),
    ).not.toThrow();
  });

  it('rejects empty', () => {
    expect(() => assertLocalIndexCastingPhotoUrlOrPath('')).toThrow(/empty/);
    expect(() => assertLocalIndexCastingPhotoUrlOrPath(null as unknown as string)).toThrow(/empty/);
  });

  it('rejects external https package/CDN URLs', () => {
    expect(() =>
      assertLocalIndexCastingPhotoUrlOrPath('https://cdn.mediaslide.com/foo.jpg'),
    ).toThrow(/expected supabase-storage/);
    expect(() =>
      assertLocalIndexCastingPhotoUrlOrPath('https://example.com/model-photos/x/y.jpg'),
    ).toThrow(/expected supabase-storage/);
  });

  it('rejects storage URI without model-photos segment', () => {
    expect(() =>
      assertLocalIndexCastingPhotoUrlOrPath('supabase-storage://documentspictures/other/x.jpg'),
    ).toThrow(/model-photos/);
  });

  it('rejects leaked provider hosts inside string', () => {
    expect(() =>
      assertLocalIndexCastingPhotoUrlOrPath(
        'supabase-storage://documentspictures/model-photos/x/mediaslide.com-evil.jpg',
      ),
    ).toThrow(/external provider host/);
  });
});
