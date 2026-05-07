/**
 * StorageImage — React Native Image wrapper for Supabase Storage assets.
 *
 * Transparently resolves supabase-storage://, supabase-private://, and legacy
 * public-bucket URLs to short-lived signed URLs before rendering. Safe to use
 * in list views — resolution is async and non-blocking.
 *
 * M-3 full fix (Security Audit 2026-04).
 * HARDENING (2026-04-12): uses isKnownBrokenUrl for instant placeholder on
 * broken refs; tracks resolution failure to avoid infinite retry.
 * UX (2026-05): visible loading/skeleton while signing; delayed copy; per-tile Retry.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Text,
  TouchableOpacity,
  View,
  type ImageStyle,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { uiCopy } from '../constants/uiCopy';
import {
  getCachedUrl,
  invalidateStorageUrlCache,
  isKnownBrokenUrl,
  needsResolution,
  resolveStorageUrl,
} from '../storage/storageUrl';

/** Stable broken-image placeholder: neutral grey with a subtle icon hint. */
const BROKEN_PLACEHOLDER_COLOR = '#e0e0e0';

/** After this many ms resolving a storage URI, show "Photos are still loading…". */
const LONG_RESOLVE_HINT_MS = 2_600;

interface StorageImageProps {
  uri: string | null | undefined;
  style?: StyleProp<ImageStyle>;
  resizeMode?: 'cover' | 'contain' | 'stretch' | 'center' | 'repeat';
  /**
   * Signed-URL lifetime in seconds. Defaults to 3 600 (1 hour) for
   * authenticated app users. Use a shorter value (e.g. 900) for guest links.
   */
  ttlSeconds?: number;
  /**
   * Element rendered while the URL is being resolved or if resolution fails.
   * Defaults to a neutral grey placeholder.
   */
  fallback?: React.ReactElement | null;
  onLoad?: () => void;
  onError?: () => void;
}

/**
 * Drop-in replacement for `<Image source={{ uri }}>` that handles Supabase
 * Storage URI schemes and private-bucket URLs:
 *
 *   - supabase-storage://documentspictures/path  → signed URL
 *   - supabase-private://documents/path          → signed URL
 *   - https://…/object/public/documentspictures/ → signed URL (bucket private)
 *   - Any other https:// URL                     → rendered directly
 *
 * Signed URLs are cached in-memory via resolveStorageUrl (storageUrl.ts).
 * Broken URLs (object not found) are negatively cached — Retry clears cache for that ref.
 */
export function StorageImage({
  uri,
  style,
  resizeMode = 'contain',
  ttlSeconds = 3_600,
  fallback,
  onLoad,
  onError,
}: StorageImageProps): React.ReactElement | null {
  const flatViewStyle = style as StyleProp<ViewStyle>;

  const defaultPlaceholder = (
    <View style={[{ backgroundColor: BROKEN_PLACEHOLDER_COLOR }, flatViewStyle]} />
  );

  const [resolvedUri, setResolvedUri] = useState<string | null>(() => {
    if (!uri) return null;
    if (isKnownBrokenUrl(uri)) return null;
    if (!needsResolution(uri)) return uri;
    return getCachedUrl(uri);
  });

  const [resolutionFailed, setResolutionFailed] = useState<boolean>(() => {
    return !!uri && isKnownBrokenUrl(uri);
  });

  const [bitmapFailed, setBitmapFailed] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);
  const [showLongResolveHint, setShowLongResolveHint] = useState(false);

  const mountedRef = useRef(true);
  const requestIdRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    setBitmapFailed(false);
  }, [uri]);

  const needsResolve = !!(uri && needsResolution(uri));
  const isResolving = needsResolve && !resolvedUri && !resolutionFailed;

  useEffect(() => {
    if (!isResolving) {
      setShowLongResolveHint(false);
      return;
    }
    const t = setTimeout(() => {
      if (mountedRef.current) setShowLongResolveHint(true);
    }, LONG_RESOLVE_HINT_MS);
    return () => clearTimeout(t);
  }, [isResolving, uri, retryNonce]);

  useEffect(() => {
    const myRequest = ++requestIdRef.current;

    if (!uri) {
      setResolvedUri(null);
      setResolutionFailed(false);
      return;
    }

    if (isKnownBrokenUrl(uri)) {
      setResolvedUri(null);
      setResolutionFailed(true);
      return;
    }

    if (!needsResolution(uri)) {
      setResolvedUri(uri);
      setResolutionFailed(false);
      return;
    }

    const cached = getCachedUrl(uri);
    if (cached) {
      setResolvedUri(cached);
      setResolutionFailed(false);
      return;
    }

    setResolutionFailed(false);
    setResolvedUri(null);

    void resolveStorageUrl(uri, ttlSeconds).then((resolved) => {
      if (!mountedRef.current || requestIdRef.current !== myRequest) return;
      setResolvedUri(resolved);
      if (!resolved) setResolutionFailed(true);
    });
  }, [uri, ttlSeconds, retryNonce]);

  const handleRetry = useCallback(() => {
    if (uri) invalidateStorageUrlCache(uri);
    setBitmapFailed(false);
    setResolutionFailed(false);
    setRetryNonce((n) => n + 1);
  }, [uri]);

  const handleImageError = useCallback(() => {
    console.warn('[StorageImage] image load error', { uri, resolvedUri });
    setBitmapFailed(true);
    onError?.();
  }, [uri, resolvedUri, onError]);

  const loadingShell = (
    <View
      style={[
        {
          backgroundColor: BROKEN_PLACEHOLDER_COLOR,
          alignItems: 'center',
          justifyContent: 'center',
          paddingVertical: 6,
          paddingHorizontal: 4,
          gap: 8,
        },
        flatViewStyle,
      ]}
    >
      <ActivityIndicator color="#757575" />
      {showLongResolveHint ? (
        <Text style={{ fontSize: 10, color: '#616161', textAlign: 'center' }}>
          {uiCopy.common.mediaPhotosStillLoading}
        </Text>
      ) : null}
    </View>
  );

  const failedShell = (
    <View
      style={[
        {
          backgroundColor: BROKEN_PLACEHOLDER_COLOR,
          alignItems: 'center',
          justifyContent: 'center',
          paddingVertical: 8,
          gap: 8,
        },
        flatViewStyle,
      ]}
    >
      {fallback !== undefined ? (fallback ?? null) : <View style={{ height: 4 }} />}
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel={uiCopy.common.mediaImageRetry}
        onPress={handleRetry}
        style={{
          paddingHorizontal: 12,
          paddingVertical: 6,
          backgroundColor: '#9e9e9e',
          borderRadius: 6,
        }}
      >
        <Text style={{ fontSize: 11, color: '#fff', fontWeight: '600' }}>
          {uiCopy.common.mediaImageRetry}
        </Text>
      </TouchableOpacity>
    </View>
  );

  if (!uri) {
    return fallback !== undefined ? (fallback ?? null) : defaultPlaceholder;
  }

  if (!resolvedUri) {
    if (resolutionFailed) {
      return failedShell;
    }
    if (needsResolve) {
      return fallback !== undefined ? (fallback ?? loadingShell) : loadingShell;
    }
    return fallback !== undefined ? (fallback ?? null) : defaultPlaceholder;
  }

  if (bitmapFailed) {
    return failedShell;
  }

  return (
    <Image
      source={{ uri: resolvedUri }}
      style={style}
      resizeMode={resizeMode}
      onLoad={onLoad}
      onError={handleImageError}
    />
  );
}
