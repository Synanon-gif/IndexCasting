const mockCreateSignedUrl = jest.fn();

jest.mock('../../../lib/supabase', () => ({
  supabase: {
    storage: {
      from: jest.fn(() => ({
        createSignedUrl: (...args: unknown[]) => mockCreateSignedUrl(...args),
      })),
    },
  },
}));

jest.mock('../../utils/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    fatal: jest.fn(),
  },
}));

import { isRetryableStorageSignError } from '../storageUrl';

describe('storageUrl — isRetryableStorageSignError', () => {
  it('returns true for numeric gateway status codes', () => {
    expect(isRetryableStorageSignError({ statusCode: 502 })).toBe(true);
    expect(isRetryableStorageSignError({ statusCode: 503 })).toBe(true);
    expect(isRetryableStorageSignError({ statusCode: 504 })).toBe(true);
  });

  it('returns true for string status codes', () => {
    expect(isRetryableStorageSignError({ statusCode: '504' })).toBe(true);
  });

  it('detects timeout wording in message', () => {
    expect(isRetryableStorageSignError({ message: 'Gateway Timeout' })).toBe(true);
    expect(isRetryableStorageSignError({ message: '504 Gateway Timeout' })).toBe(true);
  });

  it('returns false for 404 and unrelated errors', () => {
    expect(isRetryableStorageSignError({ statusCode: 404 })).toBe(false);
    expect(isRetryableStorageSignError({ message: 'Object not found' })).toBe(false);
    expect(isRetryableStorageSignError(new Error('permission denied'))).toBe(false);
  });
});

describe('resolveStorageUrl (mocked supabase)', () => {
  beforeEach(() => {
    jest.resetModules();
    mockCreateSignedUrl.mockReset();
  });

  it('retries on 504 then succeeds', async () => {
    mockCreateSignedUrl
      .mockResolvedValueOnce({ data: null, error: { statusCode: 504, message: 'Gateway Timeout' } })
      .mockResolvedValue({ data: { signedUrl: 'https://signed-ok' }, error: null });

    const { resolveStorageUrl } = await import('../storageUrl');
    const uri = 'supabase-storage://documentspictures/model-photos/x/a.jpg';
    const out = await resolveStorageUrl(uri);
    expect(out).toBe('https://signed-ok');
    expect(mockCreateSignedUrl.mock.calls.length).toBeGreaterThanOrEqual(2);
  }, 15_000);

  it('dedupes concurrent sign for same uri (single createSignedUrl)', async () => {
    let settle!: (v: { data: { signedUrl: string } | null; error: unknown }) => void;
    const deferred = new Promise<{ data: { signedUrl: string } | null; error: unknown }>((r) => {
      settle = r;
    });
    mockCreateSignedUrl.mockReturnValue(deferred);

    const { resolveStorageUrl } = await import('../storageUrl');
    const uri = 'supabase-storage://documentspictures/model-photos/x/b.jpg';
    const p1 = resolveStorageUrl(uri);
    const p2 = resolveStorageUrl(uri);
    await Promise.resolve();
    expect(mockCreateSignedUrl).toHaveBeenCalledTimes(1);
    settle({ data: { signedUrl: 'https://signed' }, error: null });
    const [a, b] = await Promise.all([p1, p2]);
    expect(a).toBe('https://signed');
    expect(b).toBe('https://signed');
    expect(mockCreateSignedUrl).toHaveBeenCalledTimes(1);
  });

  it('dedupes public URL and supabase-storage URI for same object (one createSignedUrl)', async () => {
    mockCreateSignedUrl.mockResolvedValue({
      data: { signedUrl: 'https://signed-one' },
      error: null,
    });
    const { resolveStorageUrl } = await import('../storageUrl');
    const pub = 'https://abc.supabase.co/storage/v1/object/public/documentspictures/folder/img.jpg';
    const canon = 'supabase-storage://documentspictures/folder/img.jpg';
    const [a, b] = await Promise.all([resolveStorageUrl(pub), resolveStorageUrl(canon)]);
    expect(a).toBe('https://signed-one');
    expect(b).toBe('https://signed-one');
    expect(mockCreateSignedUrl).toHaveBeenCalledTimes(1);
  });

  it('never exceeds 5 concurrent createSignedUrl calls under burst', async () => {
    let inFlight = 0;
    let maxSeen = 0;
    mockCreateSignedUrl.mockImplementation(async () => {
      inFlight += 1;
      maxSeen = Math.max(maxSeen, inFlight);
      await new Promise((r) => setTimeout(r, 20));
      inFlight -= 1;
      return { data: { signedUrl: 'https://signed' }, error: null };
    });
    const { resolveStorageUrl } = await import('../storageUrl');
    const uris = Array.from(
      { length: 40 },
      (_, i) => `supabase-storage://documentspictures/burst/${i}.jpg`,
    );
    await Promise.all(uris.map((u) => resolveStorageUrl(u)));
    expect(maxSeen).toBeLessThanOrEqual(5);
    expect(mockCreateSignedUrl).toHaveBeenCalledTimes(40);
  }, 35_000);
});
