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
 */

import React, { useEffect, useRef, useState } from 'react';
import { Image, View, type ImageStyle, type StyleProp, type ViewStyle } from 'react-native';
import { isKnownBrokenUrl, needsResolution, resolveStorageUrl } from '../storage/storageUrl';

/** Stable broken-image placeholder: neutral grey with a subtle icon hint. */
const BROKEN_PLACEHOLDER_COLOR = '#e0e0e0';

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
 * Broken URLs (object not found) are negatively cached — the placeholder is
 * shown instantly on subsequent renders without another API call.
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
  const defaultPlaceholder = (
    <View style={[{ backgroundColor: BROKEN_PLACEHOLDER_COLOR }, style as StyleProp<ViewStyle>]} />
  );

  const [resolvedUri, setResolvedUri] = useState<string | null>(() => {
    if (!uri) return null;
    if (isKnownBrokenUrl(uri)) return null;
    if (!needsResolution(uri)) return uri;
    return null;
  });

  // Track whether resolution explicitly failed (distinct from "still loading").
  const [resolutionFailed, setResolutionFailed] = useState<boolean>(() => {
    return !!uri && isKnownBrokenUrl(uri);
  });

  const mountedRef = useRef(true);
  const lastUriRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (uri === lastUriRef.current) return;
    lastUriRef.current = uri;

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

    setResolutionFailed(false);
    resolveStorageUrl(uri, ttlSeconds).then((resolved) => {
      if (mountedRef.current && lastUriRef.current === uri) {
        setResolvedUri(resolved);
        if (!resolved) setResolutionFailed(true);
      }
    });
  }, [uri, ttlSeconds]);

  if (!resolvedUri) {
    if (resolutionFailed || !uri) {
      return fallback !== undefined ? (fallback ?? null) : defaultPlaceholder;
    }
    return fallback !== undefined ? (fallback ?? null) : defaultPlaceholder;
  }

  return (
    <Image
      source={{ uri: resolvedUri }}
      style={style}
      resizeMode={resizeMode}
      onLoad={onLoad}
      onError={onError}
    />
  );
}
