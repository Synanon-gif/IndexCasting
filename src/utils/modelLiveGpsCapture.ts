/**
 * Capture device GPS once for Model "Share GPS" (Settings).
 * Privacy: returns raw coordinates from the OS; callers must round with roundCoord before network/DB.
 *
 * Mobile web (esp. Safari) often fails with tight `maximumAge: 0` + short timeouts; we use stale-friendly
 * cache and retry once after TIMEOUT only (no redesign of precision/RLS).
 */
import { Platform } from 'react-native';
import * as Location from 'expo-location';

/** Native one-shot GPS — keeps Balanced accuracy but avoids indefinite hang. */
const NATIVE_SHARE_GPS_TIMEOUT_MS = 28000;

export const MODEL_GPS_ERROR = {
  NOT_SUPPORTED: 'MODEL_GPS_NOT_SUPPORTED',
  PERMISSION_DENIED: 'MODEL_GPS_PERMISSION_DENIED',
  TIMEOUT: 'MODEL_GPS_TIMEOUT',
  UNAVAILABLE: 'MODEL_GPS_UNAVAILABLE',
  /** Web only: http / non-secure browsing context blocks geolocation. */
  INSECURE_CONTEXT: 'MODEL_GPS_INSECURE_CONTEXT',
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

/** Heuristic mobile browser — tune timeouts/maximumAge (desktop unchanged). */
function isLikelyMobileWebNavigator(): boolean {
  if (typeof navigator === 'undefined' || !navigator.userAgent) return false;
  return /iPhone|iPad|iPod|Android|Mobi/i.test(navigator.userAgent);
}

function webGeolocationBlockedByInsecureContext(): boolean {
  if (typeof globalThis === 'undefined') return false;
  return typeof globalThis.isSecureContext === 'boolean' && globalThis.isSecureContext === false;
}

/** Optional permissions pre-check — does not trigger the OS prompt (best-effort; Safari often omits API). */
async function prefetchWebGeoPermissionDenied(): Promise<void> {
  try {
    const perms = (
      navigator as Navigator & {
        permissions?: {
          query: (desc: PermissionDescriptor) => Promise<PermissionStatus>;
        };
      }
    ).permissions;
    if (!perms?.query) return;
    const status = await perms.query({ name: 'geolocation' as PermissionName });
    if (status.state === 'denied') {
      throw new Error(MODEL_GPS_ERROR.PERMISSION_DENIED);
    }
  } catch (e) {
    if (e instanceof Error && e.message === MODEL_GPS_ERROR.PERMISSION_DENIED) throw e;
    // Unsupported or transient — proceed to getCurrentPosition
  }
}

function webGeoOptionsForAttempt(attempt: 1 | 2, mobileHint: boolean): PositionOptions {
  if (attempt === 1) {
    return {
      enableHighAccuracy: false,
      timeout: mobileHint ? 22000 : 16000,
      // Mobile Safari: accepting a recent cached fix dramatically improves reliability.
      maximumAge: mobileHint ? 60000 : 45000,
    };
  }
  return {
    enableHighAccuracy: false,
    timeout: mobileHint ? 30000 : 25000,
    maximumAge: 300000,
  };
}

function getWebCoordsOnce(
  navGeo: Geolocation,
  opts: PositionOptions,
): Promise<{
  latitude: number;
  longitude: number;
}> {
  return new Promise((resolve, reject) => {
    navGeo.getCurrentPosition(
      (position) =>
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        }),
      (error) => reject(new Error(classifyWebGeolocationError(error))),
      opts,
    );
  });
}

async function getWebCoords(): Promise<{ latitude: number; longitude: number }> {
  if (webGeolocationBlockedByInsecureContext()) {
    throw new Error(MODEL_GPS_ERROR.INSECURE_CONTEXT);
  }

  const navGeo =
    typeof navigator !== 'undefined'
      ? (navigator as unknown as { geolocation?: Geolocation }).geolocation
      : undefined;

  if (!navGeo?.getCurrentPosition) {
    throw new Error(MODEL_GPS_ERROR.NOT_SUPPORTED);
  }

  await prefetchWebGeoPermissionDenied();

  const mobile = isLikelyMobileWebNavigator();

  try {
    return await getWebCoordsOnce(navGeo, webGeoOptionsForAttempt(1, mobile));
  } catch (first) {
    const code = first instanceof Error ? first.message : '';
    if (code !== MODEL_GPS_ERROR.TIMEOUT) throw first;

    try {
      return await getWebCoordsOnce(navGeo, webGeoOptionsForAttempt(2, mobile));
    } catch (second) {
      throw second;
    }
  }
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
    const pos = await new Promise<Location.LocationObject>((resolve, reject) => {
      let settled = false;
      const tid = setTimeout(() => {
        if (!settled) {
          settled = true;
          reject(new Error(MODEL_GPS_ERROR.TIMEOUT));
        }
      }, NATIVE_SHARE_GPS_TIMEOUT_MS);
      Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      })
        .then((p) => {
          if (!settled) {
            settled = true;
            clearTimeout(tid);
            resolve(p);
          }
        })
        .catch((e) => {
          if (!settled) {
            settled = true;
            clearTimeout(tid);
            reject(e instanceof Error ? e : new Error(MODEL_GPS_ERROR.UNAVAILABLE));
          }
        });
    });
    return {
      latitude: pos.coords.latitude,
      longitude: pos.coords.longitude,
    };
  } catch (e) {
    if (e instanceof Error && e.message === MODEL_GPS_ERROR.TIMEOUT) throw e;
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
