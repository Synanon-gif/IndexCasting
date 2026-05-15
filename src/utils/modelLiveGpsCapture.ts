/**
 * Capture device GPS once for Model "Share GPS" (Settings).
 * Privacy: returns raw coordinates from the OS; callers must round with roundCoord before network/DB.
 */
import { Platform } from 'react-native';
import * as Location from 'expo-location';

export const MODEL_GPS_ERROR = {
  NOT_SUPPORTED: 'MODEL_GPS_NOT_SUPPORTED',
  PERMISSION_DENIED: 'MODEL_GPS_PERMISSION_DENIED',
  TIMEOUT: 'MODEL_GPS_TIMEOUT',
  UNAVAILABLE: 'MODEL_GPS_UNAVAILABLE',
} as const;

export type ModelGpsErrorCode = (typeof MODEL_GPS_ERROR)[keyof typeof MODEL_GPS_ERROR];

function classifyWebGeolocationError(err: unknown): ModelGpsErrorCode {
  if (err && typeof err === 'object' && 'code' in err) {
    const code = (err as { code?: number }).code;
    if (code === 1) return MODEL_GPS_ERROR.PERMISSION_DENIED;
    if (code === 2) return MODEL_GPS_ERROR.UNAVAILABLE;
    if (code === 3) return MODEL_GPS_ERROR.TIMEOUT;
  }
  return MODEL_GPS_ERROR.UNAVAILABLE;
}

function getWebCoords(): Promise<{ latitude: number; longitude: number }> {
  return new Promise((resolve, reject) => {
    const navGeo =
      typeof navigator !== 'undefined'
        ? (navigator as unknown as { geolocation?: Geolocation }).geolocation
        : undefined;

    if (!navGeo?.getCurrentPosition) {
      reject(new Error(MODEL_GPS_ERROR.NOT_SUPPORTED));
      return;
    }

    navGeo.getCurrentPosition(
      (position) =>
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        }),
      (error) => reject(new Error(classifyWebGeolocationError(error))),
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 0 },
    );
  });
}

async function getNativeCoords(): Promise<{ latitude: number; longitude: number }> {
  const svc = await Location.getForegroundPermissionsAsync();
  let status = svc.status;
  if (status !== Location.PermissionStatus.GRANTED) {
    const req = await Location.requestForegroundPermissionsAsync();
    status = req.status;
  }
  if (status !== Location.PermissionStatus.GRANTED) {
    throw new Error(MODEL_GPS_ERROR.PERMISSION_DENIED);
  }

  try {
    const pos = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });
    return {
      latitude: pos.coords.latitude,
      longitude: pos.coords.longitude,
    };
  } catch {
    throw new Error(MODEL_GPS_ERROR.UNAVAILABLE);
  }
}

/** One-shot position (raw). Throws Error with message = MODEL_GPS_ERROR.* */
export async function captureDeviceLatLngRawForModelShare(): Promise<{
  latitude: number;
  longitude: number;
}> {
  if (Platform.OS === 'web') {
    return await getWebCoords();
  }
  return await getNativeCoords();
}

/** Map captured error codes to localized copy keys — see ModelProfileScreen. */
export function isModelGpsErrorCode(message: string): message is ModelGpsErrorCode {
  return (Object.values(MODEL_GPS_ERROR) as string[]).includes(message);
}
