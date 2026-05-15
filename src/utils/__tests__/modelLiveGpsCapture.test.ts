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

  beforeEach(() => {
    jest.clearAllMocks();
    mockPlatformOs = 'web';
  });

  afterEach(() => {
    Object.defineProperty(global, 'navigator', {
      configurable: true,
      value: origNavigator,
    });
  });

  it('web: rejects when navigator.geolocation is unavailable', async () => {
    const { captureDeviceLatLngRawForModelShare, MODEL_GPS_ERROR } =
      await import('../modelLiveGpsCapture');

    Object.defineProperty(global, 'navigator', {
      configurable: true,
      value: { geolocation: undefined },
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
});

describe('isModelGpsErrorCode helper', () => {
  beforeEach(() => {
    mockPlatformOs = 'web';
  });

  it('flags known MODEL_GPS_* messages', async () => {
    const { isModelGpsErrorCode, MODEL_GPS_ERROR } = await import('../modelLiveGpsCapture');
    expect(isModelGpsErrorCode(MODEL_GPS_ERROR.TIMEOUT)).toBe(true);
    expect(isModelGpsErrorCode('random')).toBe(false);
  });
});
