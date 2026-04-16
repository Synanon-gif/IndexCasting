/**
 * GDPR-aware client position for agency-side "Near me" roster filtering.
 * Mirrors Client Web: consent key `ic_geo_consent_v1`, rounded coords, Nominatim reverse for city label.
 */
import { useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { roundCoord } from '../services/modelLocationsSupabase';
import { showConfirmAlert } from '../utils/crossPlatformAlert';
import { uiCopy } from '../constants/uiCopy';

const GEO_CONSENT_KEY = 'ic_geo_consent_v1';

async function readGeoConsentFlag(): Promise<boolean> {
  try {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      return window.localStorage.getItem(GEO_CONSENT_KEY) === '1';
    }
    return (await AsyncStorage.getItem(GEO_CONSENT_KEY)) === '1';
  } catch {
    return false;
  }
}

async function persistGeoConsentFlag(): Promise<void> {
  try {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.localStorage.setItem(GEO_CONSENT_KEY, '1');
    } else {
      await AsyncStorage.setItem(GEO_CONSENT_KEY, '1');
    }
  } catch (e) {
    console.warn('[useNearMeClientLocation] persist consent failed', e);
  }
}

export function useNearMeClientLocation(
  nearbyActive: boolean,
  onConsentDeclineNearby: () => void,
): {
  userLat: number | null;
  userLng: number | null;
  userCity: string | null;
  geoConsentGiven: boolean;
} {
  const [userLat, setUserLat] = useState<number | null>(null);
  const [userLng, setUserLng] = useState<number | null>(null);
  const [userCity, setUserCity] = useState<string | null>(null);
  const [geoConsentGiven, setGeoConsentGiven] = useState(false);
  const [consentHydrated, setConsentHydrated] = useState(false);
  const consentPromptOpenRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const v = await readGeoConsentFlag();
      if (!cancelled) {
        setGeoConsentGiven(v);
        setConsentHydrated(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!nearbyActive) {
      consentPromptOpenRef.current = false;
      return;
    }
    if (!consentHydrated || geoConsentGiven || consentPromptOpenRef.current) return;
    consentPromptOpenRef.current = true;
    showConfirmAlert(
      uiCopy.modelRoster.nearMeGeoConsentTitle,
      uiCopy.modelRoster.nearMeGeoConsentBody,
      () => {
        void persistGeoConsentFlag();
        setGeoConsentGiven(true);
        consentPromptOpenRef.current = false;
      },
      uiCopy.common.confirm,
      () => {
        onConsentDeclineNearby();
        consentPromptOpenRef.current = false;
      },
    );
  }, [nearbyActive, consentHydrated, geoConsentGiven, onConsentDeclineNearby]);

  useEffect(() => {
    if (!nearbyActive || !geoConsentGiven) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const navGeo = typeof navigator !== 'undefined' ? (navigator as any).geolocation : undefined;
    if (!navGeo?.getCurrentPosition) return;
    if (userLat !== null && userLng !== null) return;

    navGeo.getCurrentPosition(
      async (pos: { coords: { latitude: number; longitude: number } }) => {
        try {
          const lat = roundCoord(pos.coords.latitude);
          const lng = roundCoord(pos.coords.longitude);
          setUserLat(lat);
          setUserLng(lng);
          const res = await fetch(
            `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`,
            { headers: { 'Accept-Language': 'en', 'User-Agent': 'IndexCasting/1.0' } },
          );
          const data = (await res.json()) as {
            address?: { city?: string; town?: string; village?: string };
          };
          const city = data.address?.city || data.address?.town || data.address?.village || null;
          if (city) setUserCity(city);
        } catch (e) {
          console.warn('[useNearMeClientLocation] reverse geocoding failed:', e);
        }
      },
      (err: { code?: number; message?: string }) => {
        console.warn('[useNearMeClientLocation] position error:', err?.code, err?.message);
      },
      { timeout: 10000 },
    );
  }, [nearbyActive, geoConsentGiven, userLat, userLng]);

  return { userLat, userLng, userCity, geoConsentGiven };
}
