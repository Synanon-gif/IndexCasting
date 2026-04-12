import {
  normalizeDocumentspicturesModelImageRef,
} from '../normalizeModelPortfolioUrl';

describe('normalizeDocumentspicturesModelImageRef', () => {
  const mid = '11111111-1111-1111-1111-111111111111';

  it('returns https URLs unchanged', () => {
    const u = 'https://cdn.example.com/a.jpg';
    expect(normalizeDocumentspicturesModelImageRef(u, mid)).toBe(u);
  });

  it('returns supabase-storage URIs unchanged', () => {
    const u = 'supabase-storage://documentspictures/model-photos/x/y.jpg';
    expect(normalizeDocumentspicturesModelImageRef(u, mid)).toBe(u);
  });

  it('prefixes bare legacy filename with model-photos/{modelId}/', () => {
    const out = normalizeDocumentspicturesModelImageRef('1775722024203-qb@yh9zy.jpg', mid);
    expect(out).toBe(
      `supabase-storage://documentspictures/model-photos/${mid}/1775722024203-qb@yh9zy.jpg`,
    );
  });

  it('wraps model-photos/... path without scheme', () => {
    const out = normalizeDocumentspicturesModelImageRef(
      `model-photos/${mid}/file.webp`,
      mid,
    );
    expect(out).toBe(
      `supabase-storage://documentspictures/model-photos/${mid}/file.webp`,
    );
  });

  it('returns empty string when raw empty', () => {
    expect(normalizeDocumentspicturesModelImageRef('', mid)).toBe('');
  });

  it('does not treat non-uuid paths with slashes as relative model-photos', () => {
    const weird = 'foo/bar.jpg';
    expect(normalizeDocumentspicturesModelImageRef(weird, mid)).toBe(weird);
  });

  it('wraps model-applications/... path', () => {
    const out = normalizeDocumentspicturesModelImageRef(
      'model-applications/1234-closeUp-abc.jpg',
      mid,
    );
    expect(out).toBe(
      'supabase-storage://documentspictures/model-applications/1234-closeUp-abc.jpg',
    );
  });

  it('wraps relative path with uuid sub-directory', () => {
    const out = normalizeDocumentspicturesModelImageRef(
      `${mid}/file.webp`,
      mid,
    );
    expect(out).toBe(
      `supabase-storage://documentspictures/model-photos/${mid}/file.webp`,
    );
  });

  it('returns supabase-private URIs unchanged', () => {
    const u = 'supabase-private://documents/model-private-photos/x/y.jpg';
    expect(normalizeDocumentspicturesModelImageRef(u, mid)).toBe(u);
  });

  it('handles heic and heif extensions', () => {
    const out = normalizeDocumentspicturesModelImageRef('photo.heic', mid);
    expect(out).toBe(
      `supabase-storage://documentspictures/model-photos/${mid}/photo.heic`,
    );
  });
});
