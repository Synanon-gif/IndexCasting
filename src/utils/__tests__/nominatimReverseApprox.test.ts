import {
  NOMINATIM_INDEXCASTING_HEADERS,
  reverseGeocodeRoundedCoords,
} from '../nominatimReverseApprox';

describe('reverseGeocodeRoundedCoords', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('sends mandatory User-Agent and Accept-Language headers', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          address: { city: 'Hamburg', country_code: 'de' },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const r = await reverseGeocodeRoundedCoords(53.55, 9.98);
    expect(r).toEqual({ city: 'Hamburg', countryCodeIso2: 'DE' });
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('nominatim.openstreetmap.org/reverse'),
      expect.objectContaining({
        headers: NOMINATIM_INDEXCASTING_HEADERS,
      }),
    );
    fetchSpy.mockRestore();
  });

  it('returns null on non-OK HTTP status (blocked / rate limit)', async () => {
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response('', { status: 403 }));

    await expect(reverseGeocodeRoundedCoords(1, 2)).resolves.toBeNull();
    fetchSpy.mockRestore();
  });

  it('returns null when city cannot be resolved from payload', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ address: {} }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await expect(reverseGeocodeRoundedCoords(-33.85, 151.2)).resolves.toBeNull();
  });

  it('returns city when country_code is missing but city is present (caller may fallback country)', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ address: { town: 'Bern' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await expect(reverseGeocodeRoundedCoords(46.95, 7.45)).resolves.toEqual({
      city: 'Bern',
      countryCodeIso2: null,
    });
  });

  it('returns null for non-finite coordinates', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch');
    await expect(reverseGeocodeRoundedCoords(NaN, 10)).resolves.toBeNull();
    await expect(reverseGeocodeRoundedCoords(10, Infinity)).resolves.toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
