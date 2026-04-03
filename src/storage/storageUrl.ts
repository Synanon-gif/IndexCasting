/**
 * storageUrl.ts — Central Supabase Storage URL resolver
 *
 * M-3 full fix (Security Audit 2026-04): makes the documentspictures bucket
 * compatible with private access by providing a single resolution path for
 * ALL storage URL formats used in the app:
 *
 *   1. supabase-storage://documentspictures/model-photos/abc/img.jpg  (new canonical form)
 *   2. supabase-private://documents/path                               (existing private photos)
 *   3. https://<project>.supabase.co/storage/v1/object/public/…       (legacy full URL)
 *   4. https://<project>.supabase.co/storage/v1/object/sign/…         (already-signed URL)
 *   5. Any other https:// URL                                           (returned as-is)
 *
 * Resolution produces a short-lived signed URL from Supabase Storage.
 * Results are cached in-memory until near-expiry (CACHE_GRACE_SECONDS).
 */

import { supabase } from '../../lib/supabase';

// ─── Constants ────────────────────────────────────────────────────────────────

export const STORAGE_BUCKET_IMAGES  = 'documentspictures';
export const STORAGE_BUCKET_PRIVATE = 'documents';

/** Default signed-URL TTL for authenticated app users (1 hour). */
export const DEFAULT_SIGNED_TTL_SECONDS = 3_600;

/** Refresh the cached URL this many seconds before it actually expires. */
const CACHE_GRACE_SECONDS = 120;

// ─── In-memory signed URL cache ───────────────────────────────────────────────
// Key: canonical raw URI  →  Value: { signedUrl, expiresAt (unix seconds) }

const urlCache = new Map<string, { signedUrl: string; expiresAt: number }>();

// ─── URI helpers ──────────────────────────────────────────────────────────────

/**
 * Converts a relative storage path to the canonical URI scheme.
 *   toStorageUri('documentspictures', 'model-photos/abc/img.jpg')
 *   → 'supabase-storage://documentspictures/model-photos/abc/img.jpg'
 */
export function toStorageUri(bucket: string, path: string): string {
  return `supabase-storage://${bucket}/${path}`;
}

/**
 * Extracts { bucket, path } from any supported URL / URI format.
 * Returns null for non-storage URLs.
 */
export function extractBucketAndPath(
  url: string,
): { bucket: string; path: string } | null {
  if (!url) return null;

  // supabase-storage://bucket/path
  if (url.startsWith('supabase-storage://')) {
    const rest = url.slice('supabase-storage://'.length);
    const idx = rest.indexOf('/');
    if (idx === -1) return null;
    return { bucket: rest.slice(0, idx), path: rest.slice(idx + 1) };
  }

  // supabase-private://bucket/path  (legacy private photos)
  if (url.startsWith('supabase-private://')) {
    const rest = url.slice('supabase-private://'.length);
    const idx = rest.indexOf('/');
    if (idx === -1) return null;
    return { bucket: rest.slice(0, idx), path: rest.slice(idx + 1) };
  }

  // Full Supabase Storage URL — public or signed
  // Strips query string (?token=…) from signed URLs.
  const match = url.match(
    /\/storage\/v1\/object\/(?:public|sign)\/([^/]+)\/(.+?)(?:\?|$)/,
  );
  if (match?.[1] && match?.[2]) {
    return {
      bucket: match[1],
      path: decodeURIComponent(match[2]),
    };
  }

  return null;
}

/**
 * Returns true when the URL must be resolved server-side before it can be
 * rendered (i.e. it uses a custom scheme or points to a private bucket path).
 * Once documentspictures is private, this also returns true for legacy public URLs.
 */
export function needsResolution(url: string): boolean {
  if (!url) return false;
  if (url.startsWith('supabase-storage://')) return true;
  if (url.startsWith('supabase-private://')) return true;
  // Legacy full public URLs for both buckets need signed URL after bucket goes private.
  if (url.includes(`/storage/v1/object/public/${STORAGE_BUCKET_IMAGES}/`)) return true;
  if (url.includes(`/storage/v1/object/public/${STORAGE_BUCKET_PRIVATE}/`)) return true;
  return false;
}

/**
 * Converts a legacy full public URL to the canonical supabase-storage:// URI.
 * Used when normalising values before storing them in the DB.
 * No-ops for URIs that already use a custom scheme.
 */
export function publicUrlToStorageUri(url: string): string {
  const extracted = extractBucketAndPath(url);
  if (!extracted) return url;
  if (url.startsWith('supabase-storage://') || url.startsWith('supabase-private://')) return url;
  return toStorageUri(extracted.bucket, extracted.path);
}

// ─── Resolver ─────────────────────────────────────────────────────────────────

/**
 * Resolves any storage URL / URI to a short-lived Supabase signed URL.
 *
 * Non-storage URLs (external CDN, data: URIs, etc.) are returned unchanged.
 * On signing failure returns null — callers should hide the image rather
 * than falling back to a potentially-public URL (H5 security fix).
 *
 * Signed URLs are cached in-memory until CACHE_GRACE_SECONDS before expiry.
 *
 * @param url        - Raw storage URL, custom URI, or external URL.
 * @param ttlSeconds - Desired signed-URL lifetime (default: 1 h).
 */
export async function resolveStorageUrl(
  url: string,
  ttlSeconds: number = DEFAULT_SIGNED_TTL_SECONDS,
): Promise<string | null> {
  if (!url) return null;

  // Fast path: already a valid, non-expired signed URL in cache
  const cached = urlCache.get(url);
  if (cached && cached.expiresAt > Date.now() / 1_000 + CACHE_GRACE_SECONDS) {
    return cached.signedUrl;
  }

  const extracted = extractBucketAndPath(url);
  if (!extracted) {
    // Not a Supabase Storage URL — return as-is (external CDN, data: URI, etc.)
    return url;
  }

  try {
    const { data, error } = await supabase.storage
      .from(extracted.bucket)
      .createSignedUrl(extracted.path, ttlSeconds);

    if (error || !data?.signedUrl) {
      console.error('[storageUrl] resolveStorageUrl failed', error, { url });
      return null;
    }

    urlCache.set(url, {
      signedUrl: data.signedUrl,
      expiresAt: Date.now() / 1_000 + ttlSeconds,
    });

    return data.signedUrl;
  } catch (e) {
    console.error('[storageUrl] resolveStorageUrl exception', e);
    return null;
  }
}

/**
 * Resolves multiple storage URLs in parallel.
 * URLs that fail to sign are omitted from the result (null-safe).
 */
export async function resolveStorageUrls(
  urls: string[],
  ttlSeconds: number = DEFAULT_SIGNED_TTL_SECONDS,
): Promise<string[]> {
  const results = await Promise.all(urls.map((u) => resolveStorageUrl(u, ttlSeconds)));
  return results.filter((u): u is string => u !== null);
}

/**
 * Invalidates all cached entries for a given raw URL.
 * Call after deleting or replacing a file so the next render fetches a fresh URL.
 */
export function invalidateStorageUrlCache(url: string): void {
  urlCache.delete(url);
}
