/**
 * StorageImage — React Native Image wrapper for Supabase Storage assets.
 *
 * Transparently resolves supabase-storage://, supabase-private://, and legacy
 * public-bucket URLs to short-lived signed URLs before rendering. Safe to use
 * in list views — resolution is async and non-blocking.
 *
 * M-3 full fix (Security Audit 2026-04).
 */

import React, { useEffect, useRef, useState } from 'react';
import { Image, type ImageStyle, type StyleProp } from 'react-native';
import { needsResolution, resolveStorageUrl } from '../storage/storageUrl';

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
   * Element rendered while the URL is being resolved.
   * Defaults to null (renders nothing until resolved).
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
 */
export function StorageImage({
  uri,
  style,
  resizeMode = 'cover',
  ttlSeconds = 3_600,
  fallback = null,
  onLoad,
  onError,
}: StorageImageProps): React.ReactElement | null {
  const [resolvedUri, setResolvedUri] = useState<string | null>(() => {
    // Synchronous fast path: if the URI is already renderable, use it directly.
    if (!uri) return null;
    if (!needsResolution(uri)) return uri;
    return null; // will be resolved asynchronously
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
      return;
    }

    if (!needsResolution(uri)) {
      setResolvedUri(uri);
      return;
    }

    // Async resolve — do NOT block render
    resolveStorageUrl(uri, ttlSeconds).then((resolved) => {
      if (mountedRef.current && lastUriRef.current === uri) {
        setResolvedUri(resolved);
      }
    });
  }, [uri, ttlSeconds]);

  if (!resolvedUri) return fallback ?? null;

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
