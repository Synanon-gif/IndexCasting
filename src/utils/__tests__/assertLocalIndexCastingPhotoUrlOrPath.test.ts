import { assertLocalIndexCastingPhotoUrlOrPath } from '../assertLocalIndexCastingPhotoUrlOrPath';

describe('assertLocalIndexCastingPhotoUrlOrPath', () => {
  it('accepts canonical supabase-storage documentspictures model-photos paths', () => {
    expect(() =>
      assertLocalIndexCastingPhotoUrlOrPath(
        'supabase-storage://documentspictures/model-photos/uuid-1/file.jpg',
      ),
    ).not.toThrow();
  });

  it('rejects empty', () => {
    expect(() => assertLocalIndexCastingPhotoUrlOrPath('')).toThrow();
  });

  it('rejects http(s) Mediaslide hosts', () => {
    expect(() =>
      assertLocalIndexCastingPhotoUrlOrPath('https://cdn.mediaslide.com/ebook/abc.jpg'),
    ).toThrow();
  });

  it('rejects http(s) Netwalk hosts', () => {
    expect(() => assertLocalIndexCastingPhotoUrlOrPath('https://img.netwalk.eu/x.png')).toThrow();
  });

  it('rejects arbitrary external https URLs', () => {
    expect(() =>
      assertLocalIndexCastingPhotoUrlOrPath('https://images.example.com/pkg/1.jpg'),
    ).toThrow();
  });

  it('rejects supabase-storage without model-photos segment', () => {
    expect(() =>
      assertLocalIndexCastingPhotoUrlOrPath('supabase-storage://documentspictures/other/file.jpg'),
    ).toThrow();
  });
});
