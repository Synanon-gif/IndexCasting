let mockPlatformOs: 'web' | 'ios' = 'web';

jest.mock('react-native', () => ({
  Platform: {
    get OS() {
      return mockPlatformOs;
    },
  },
}));

const mockRequestForegroundPermissionsAsync = jest.fn();
const mockGetForegroundPermissionsAsync = jest.fn();
const mockGetCurrentPositionAsync = jest.fn();

jest.mock('expo-location', () => ({
  __esModule: true,
  getForegroundPermissionsAsync: () => mockGetForegroundPermissionsAsync(),
  requestForegroundPermissionsAsync: () => mockRequestForegroundPermissionsAsync(),
  getCurrentPositionAsync: (opts: unknown) => mockGetCurrentPositionAsync(opts),
  PermissionStatus: { GRANTED: 'granted', DENIED: 'denied', UNDETERMINED: 'undetermined' },
  Accuracy: { Balanced: 'balanced' },
}));

describe('captureDeviceLatLngRawForModelShare', () => {
  const origNavigator = global.navigator;
  const origSecure = Reflect.get(globalThis, 'isSecureContext');

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
    mockPlatformOs = 'web';
  });

  afterEach(() => {
    Object.defineProperty(global, 'navigator', {
      configurable: true,
      value: origNavigator,
    });
    try {
      if (typeof origSecure === 'boolean') Reflect.set(globalThis, 'isSecureContext', origSecure);
      else Reflect.deleteProperty(globalThis, 'isSecureContext');
    } catch {
      Reflect.deleteProperty(globalThis, 'isSecureContext');
    }
  });

  it('web: rejects insecure context explicitly', async () => {
    const { captureDeviceLatLngRawForModelShare, MODEL_GPS_ERROR } =
      await import('../modelLiveGpsCapture');

    Reflect.set(globalThis, 'isSecureContext', false);

    Object.defineProperty(global, 'navigator', {
      configurable: true,
      value: {
        userAgent:
          'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
        geolocation: { getCurrentPosition: jest.fn() },
      },
    });

    await expect(captureDeviceLatLngRawForModelShare()).rejects.toThrow(
      MODEL_GPS_ERROR.INSECURE_CONTEXT,
    );
  });

  it('web: prefetch permissions denied avoids getCurrentPosition', async () => {
    const geoSpy = jest.fn();
    const { captureDeviceLatLngRawForModelShare, MODEL_GPS_ERROR } =
      await import('../modelLiveGpsCapture');

    Object.defineProperty(global, 'navigator', {
      configurable: true,
      value: {
        userAgent: 'Mozilla/5.0',
        permissions: {
          query: jest.fn(() =>
            Promise.resolve({
              state: 'denied',
            } as unknown as PermissionStatus),
          ),
        },
        geolocation: { getCurrentPosition: geoSpy },
      },
    });

    await expect(captureDeviceLatLngRawForModelShare()).rejects.toThrow(
      MODEL_GPS_ERROR.PERMISSION_DENIED,
    );
    expect(geoSpy).not.toHaveBeenCalled();
  });

  it('web: retries once after TIMEOUT then succeeds', async () => {
    const { captureDeviceLatLngRawForModelShare } = await import('../modelLiveGpsCapture');

    let calls = 0;
    Object.defineProperty(global, 'navigator', {
      configurable: true,
      value: {
        userAgent:
          'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko)',
        permissions: undefined,
        geolocation: {
          getCurrentPosition: (
            ok: (p: unknown) => void,
            fail: (e: unknown) => void,
            _opts?: unknown,
          ) => {
            calls += 1;
            if (calls === 1) fail({ code: 3 });
            else ok({ coords: { latitude: 52.52, longitude: 13.405 } });
          },
        },
      },
    });

    const p = await captureDeviceLatLngRawForModelShare();
    expect(calls).toBe(2);
    expect(p).toEqual({ latitude: 52.52, longitude: 13.405 });
  });

  it('web: rejects when navigator.geolocation is unavailable', async () => {
    const { captureDeviceLatLngRawForModelShare, MODEL_GPS_ERROR } =
      await import('../modelLiveGpsCapture');

    Object.defineProperty(global, 'navigator', {
      configurable: true,
      value: { userAgent: 'Mozilla/5.0', geolocation: undefined },
    });

    await expect(captureDeviceLatLngRawForModelShare()).rejects.toThrow(
      MODEL_GPS_ERROR.NOT_SUPPORTED,
    );
  });

  it('web: resolves with latitude/longitude on success', async () => {
    const { captureDeviceLatLngRawForModelShare } = await import('../modelLiveGpsCapture');

    Object.defineProperty(global, 'navigator', {
      configurable: true,
      value: {
        userAgent: 'Mozilla/5.0',
        permissions: undefined,
        geolocation: {
          getCurrentPosition: (ok: (p: unknown) => void) =>
            ok({ coords: { latitude: -33.865, longitude: 151.2094 } }),
        },
      },
    });

    const p = await captureDeviceLatLngRawForModelShare();
    expect(p.latitude).toBeCloseTo(-33.865);
    expect(p.longitude).toBeCloseTo(151.2094);
  });

  it('web: maps geolocation denial to PERMISSION_DENIED', async () => {
    const { captureDeviceLatLngRawForModelShare, MODEL_GPS_ERROR } =
      await import('../modelLiveGpsCapture');

    Object.defineProperty(global, 'navigator', {
      configurable: true,
      value: {
        userAgent: 'Mozilla/5.0',
        geolocation: {
          getCurrentPosition: (_ok: unknown, fail: (e: unknown) => void) =>
            fail({ code: 1, PERMISSION_DENIED: 1 }),
        },
      },
    });

    await expect(captureDeviceLatLngRawForModelShare()).rejects.toThrow(
      MODEL_GPS_ERROR.PERMISSION_DENIED,
    );
  });

  it('native: throws PERMISSION_DENIED when permission not granted', async () => {
    mockPlatformOs = 'ios';
    const { captureDeviceLatLngRawForModelShare, MODEL_GPS_ERROR } =
      await import('../modelLiveGpsCapture');

    mockGetForegroundPermissionsAsync.mockResolvedValue({ status: 'denied' });
    mockRequestForegroundPermissionsAsync.mockResolvedValue({ status: 'denied' });

    await expect(captureDeviceLatLngRawForModelShare()).rejects.toThrow(
      MODEL_GPS_ERROR.PERMISSION_DENIED,
    );
  });

  it('native: returns coords from expo-location after grant', async () => {
    mockPlatformOs = 'ios';
    const { captureDeviceLatLngRawForModelShare } = await import('../modelLiveGpsCapture');

    mockGetForegroundPermissionsAsync.mockResolvedValue({ status: 'granted' });
    mockGetCurrentPositionAsync.mockResolvedValue({
      coords: { latitude: 52.52, longitude: 13.405 },
    });

    const p = await captureDeviceLatLngRawForModelShare();
    expect(p).toEqual({ latitude: 52.52, longitude: 13.405 });
    expect(mockRequestForegroundPermissionsAsync).not.toHaveBeenCalled();
  });

  it('native: times out when position never resolves', async () => {
    jest.useFakeTimers();
    mockPlatformOs = 'ios';
    const { captureDeviceLatLngRawForModelShare, MODEL_GPS_ERROR } =
      await import('../modelLiveGpsCapture');

    mockGetForegroundPermissionsAsync.mockResolvedValue({ status: 'granted' });
    mockGetCurrentPositionAsync.mockImplementation(() => new Promise(() => {}));

    const settled = captureDeviceLatLngRawForModelShare().then(
      () => new Error('expected reject'),
      (e: unknown) => e,
    );
    await jest.advanceTimersByTimeAsync(28500);
    const outcome = await settled;
    expect(outcome instanceof Error ? outcome.message : '').toBe(MODEL_GPS_ERROR.TIMEOUT);
    jest.useRealTimers();
  });
});

describe('isModelGpsErrorCode helper', () => {
  beforeEach(() => {
    mockPlatformOs = 'web';
  });

  it('flags known MODEL_GPS_* messages', async () => {
    const { isModelGpsErrorCode, MODEL_GPS_ERROR } = await import('../modelLiveGpsCapture');
    expect(isModelGpsErrorCode(MODEL_GPS_ERROR.TIMEOUT)).toBe(true);
    expect(isModelGpsErrorCode(MODEL_GPS_ERROR.INSECURE_CONTEXT)).toBe(true);
    expect(isModelGpsErrorCode('random')).toBe(false);
  });
});
