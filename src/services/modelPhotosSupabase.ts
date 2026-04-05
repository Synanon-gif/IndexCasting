import { supabase } from '../../lib/supabase';
import {
  validateFile,
  checkMagicBytes,
  checkExtensionConsistency,
  ALLOWED_MIME_TYPES,
  logSecurityEvent,
} from '../../lib/validation';
import { logImageUpload, hasRecentImageRightsConfirmation } from './gdprComplianceSupabase';
import { assertOrgContext } from '../utils/orgGuard';
import imageCompression from 'browser-image-compression';
import { convertHeicToJpegIfNeeded } from './imageUtils';
import { checkAndIncrementStorage, decrementStorage } from './agencyStorageSupabase';
import { uiCopy } from '../constants/uiCopy';
import {
  toStorageUri,
  resolveStorageUrl,
  invalidateStorageUrlCache,
} from '../storage/storageUrl';

/** Allowed MIME types for model photos (images only — no PDFs in portfolio). */
const PHOTO_ALLOWED_TYPES = ALLOWED_MIME_TYPES.filter((t) => t.startsWith('image/'));

/**
 * Strips EXIF metadata (including GPS coordinates) from an image by
 * re-encoding it through the Canvas API via browser-image-compression.
 * Works in browsers and Capacitor WKWebView (iOS/Android).
 * Returns the original file if compression fails (graceful degradation).
 */
async function stripExifAndCompress(file: File | Blob): Promise<File | Blob> {
  if (!(file instanceof File)) return file;
  try {
    const compressed = await imageCompression(file, {
      maxSizeMB: 15,
      useWebWorker: true,
      // Setting these ensures Canvas re-encoding, which strips EXIF
      maxWidthOrHeight: 4096,
      fileType: file.type as 'image/jpeg' | 'image/png' | 'image/webp',
    });
    return compressed;
  } catch (e) {
    console.warn('stripExifAndCompress: compression failed, using original', e);
    return file;
  }
}

/**
 * Model-Fotos (Portfolio, Polaroids, Private) – in Supabase gespeichert, pro model_id.
 * model_photos: url, sort_order, visible, photo_type; Bilder-URLs (Storage oder extern) pro Model.
 *
 * photo_type:
 *   'portfolio' — public portfolio images, visible to clients by default
 *   'polaroid'  — polaroid images, optional client visibility
 *   'private'   — internal agency-only files, NEVER visible to clients
 */
export type ModelPhotoType = 'portfolio' | 'polaroid' | 'private';

export type ModelPhoto = {
  id: string;
  model_id: string;
  agency_id?: string | null;
  url: string;
  sort_order: number;
  /** UI field: whether this photo should be visible to clients. Always false for 'private'. */
  visible: boolean;
  /** Stabilized column (backfilled from legacy `visible`). */
  is_visible_to_clients?: boolean;
  source: string | null;
  api_external_id: string | null;
  photo_type: ModelPhotoType;
  /** Actual file size in bytes stored at upload time. Used for reliable storage decrement. */
  file_size_bytes?: number;
};

/** Result type for upload functions — includes the actual size verified from storage.objects. */
export type UploadPhotoResult = {
  url: string;
  fileSizeBytes: number;
};

export async function getPhotosForModel(
  modelId: string,
  type?: ModelPhotoType,
): Promise<ModelPhoto[]> {
  try {
    let query = supabase
      .from('model_photos')
      .select('*')
      .eq('model_id', modelId)
      .order('sort_order', { ascending: true });

    if (type) {
      query = query.eq('photo_type', type);
    }

    const { data, error } = await query;
    if (error) {
      console.error('getPhotosForModel error:', error);
      return [];
    }

    // Keep legacy `visible` in sync with `is_visible_to_clients` for older UI code.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (data ?? []).map((row: any) => {
      const isVisibleToClients = Boolean(row.is_visible_to_clients ?? row.visible ?? true);
      return {
        ...(row as ModelPhoto),
        visible: isVisibleToClients,
        is_visible_to_clients: row.is_visible_to_clients ?? isVisibleToClients,
      };
    });
  } catch (e) {
    console.error('getPhotosForModel exception:', e);
    return [];
  }
}

export async function upsertPhotosForModel(
  modelId: string,
  photos: Array<Omit<ModelPhoto, 'id' | 'model_id'> & { id?: string }>,
): Promise<ModelPhoto[]> {
  try {
    const payload = photos.map((p, index) => ({
      id: p.id ?? undefined,
      model_id: modelId,
      url: p.url,
      sort_order: p.sort_order ?? index,
      visible: p.visible,
      is_visible_to_clients: p.is_visible_to_clients ?? p.visible,
      source: p.source ?? null,
      api_external_id: p.api_external_id ?? null,
      photo_type: p.photo_type,
    }));

    const { data, error } = await supabase
      .from('model_photos')
      .upsert(payload, { onConflict: 'id' })
      .select('*')
      .order('sort_order', { ascending: true });

    if (error) {
      console.error('upsertPhotosForModel error:', error);
      return [];
    }
    return (data ?? []) as ModelPhoto[];
  } catch (e) {
    console.error('upsertPhotosForModel exception:', e);
    return [];
  }
}

export async function addPhoto(
  modelId: string,
  url: string,
  type: ModelPhotoType,
  fileSizeBytes?: number,
): Promise<ModelPhoto | null> {
  const { data: maxSortData } = await supabase
    .from('model_photos')
    .select('sort_order')
    .eq('model_id', modelId)
    .eq('photo_type', type)
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle();

  const nextSort = (maxSortData?.sort_order ?? -1) + 1;

  // Private photos are ALWAYS hidden from clients — no override allowed.
  const isPrivate = type === 'private';

  try {
    const { data, error } = await supabase
      .from('model_photos')
      .insert({
        model_id: modelId,
        url,
        sort_order: nextSort,
        visible: !isPrivate,
        is_visible_to_clients: !isPrivate,
        source: null,
        api_external_id: null,
        photo_type: type,
        file_size_bytes: fileSizeBytes ?? 0,
      })
      .select('*')
      .single();

    if (error) {
      console.error('addPhoto error:', error);
      return null;
    }
    return data as ModelPhoto;
  } catch (e) {
    console.error('addPhoto exception:', e);
    return null;
  }
}

/**
 * Deletes a photo from both Supabase Storage and the model_photos table.
 * Bucket is inferred from the URL: 'documents' for private, 'documentspictures' for others.
 *
 * BUG 1 FIX: reads file_size_bytes from the DB row before deletion instead of
 * using a fragile storage.list() call. This guarantees the decrement always
 * fires with the correct value regardless of network conditions.
 */
export async function deletePhoto(photoId: string, url: string): Promise<boolean> {
  try {
    // Read the stored file size from DB — always reliable, no network guesswork.
    const { data: photoRow } = await supabase
      .from('model_photos')
      .select('file_size_bytes')
      .eq('id', photoId)
      .maybeSingle();
    const freedBytes: number = (photoRow as { file_size_bytes?: number } | null)?.file_size_bytes ?? 0;

    const storagePath = extractStoragePath(url);
    if (storagePath) {
      const bucket = url.includes('/documents/') && !url.includes('/documentspictures/')
        ? 'documents'
        : PUBLIC_IMAGES_BUCKET;
      const { error: storageError } = await supabase.storage.from(bucket).remove([storagePath]);
      if (storageError) {
        console.error('deletePhoto storage error:', storageError);
        // Continue to delete DB row even if storage deletion fails (avoids orphaned DB rows).
      }
    }

    const { error: dbError } = await supabase
      .from('model_photos')
      .delete()
      .eq('id', photoId);

    if (dbError) {
      console.error('deletePhoto db error:', dbError);
      return false;
    }

    // Evict the signed URL from cache so subsequent renders re-sign (avoid dangling URLs).
    invalidateStorageUrlCache(url);

    // Always decrement with the DB-stored size (may be 0 for legacy rows, which is safe).
    if (freedBytes > 0) {
      await decrementStorage(freedBytes);
    }

    return true;
  } catch (e) {
    console.error('deletePhoto exception:', e);
    return false;
  }
}

/**
 * Extracts the storage object path (relative to bucket root) from a Supabase public or signed URL.
 * Returns null if the URL does not appear to be a Supabase Storage URL.
 */
function extractStoragePath(url: string): string | null {
  try {
    // Public URL format:  .../storage/v1/object/public/<bucket>/<path>
    // Signed URL format:  .../storage/v1/object/sign/<bucket>/<path>?token=...
    const match = url.match(/\/storage\/v1\/object\/(?:public|sign)\/[^/]+\/(.+?)(?:\?|$)/);
    if (match?.[1]) return decodeURIComponent(match[1]);
    return null;
  } catch {
    return null;
  }
}

export async function updatePhoto(
  photoId: string,
  fields: Partial<
    Pick<
      ModelPhoto,
      | 'url'
      | 'visible'
      | 'is_visible_to_clients'
      | 'sort_order'
      | 'source'
      | 'api_external_id'
      | 'photo_type'
    >
  >,
): Promise<boolean> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const payload: any = { ...fields };
  if ('visible' in fields && fields.visible !== undefined && payload.is_visible_to_clients === undefined) {
    payload.is_visible_to_clients = fields.visible;
  }
  if ('is_visible_to_clients' in fields && fields.is_visible_to_clients !== undefined && payload.visible === undefined) {
    payload.visible = fields.is_visible_to_clients;
  }

  try {
    const { error } = await supabase
      .from('model_photos')
      .update(payload)
      .eq('id', photoId);

    if (error) {
      console.error('updatePhoto error:', error);
      return false;
    }
    return true;
  } catch (e) {
    console.error('updatePhoto exception:', e);
    return false;
  }
}

export async function reorderPhotos(
  modelId: string,
  orderedIds: string[],
): Promise<boolean> {
  if (!orderedIds.length) return true;
  try {
    const updates = orderedIds.map((id, index) => ({
      id,
      model_id: modelId,
      sort_order: index,
    }));

    const { error } = await supabase
      .from('model_photos')
      .upsert(updates, { onConflict: 'id' });

    if (error) {
      console.error('reorderPhotos error:', error);
      return false;
    }
    return true;
  } catch (e) {
    console.error('reorderPhotos exception:', e);
    return false;
  }
}

/**
 * Bucket for portfolio / polaroid images.
 * M-3 (Security Audit 2026-04): this bucket is set to PRIVATE. All stored URLs
 * use the supabase-storage:// URI scheme and are resolved to short-lived signed
 * URLs at render time via resolveStorageUrl (storageUrl.ts).
 */
const PUBLIC_IMAGES_BUCKET = 'documentspictures';
const MODEL_PHOTOS_PREFIX = 'model-photos';

/** Private bucket for agency-only files (internal documents, private photos). */
const PRIVATE_BUCKET = 'documents';
const PRIVATE_PHOTOS_PREFIX = 'model-private-photos';

/**
 * Reads the actual file size from storage.objects metadata immediately after upload.
 * This is the server-side truth — independent of the frontend-provided file.size.
 * Returns null if the lookup fails (caller should fall back to claimed size).
 */
async function getActualStorageSize(bucket: string, path: string): Promise<number | null> {
  try {
    const folder = path.substring(0, path.lastIndexOf('/'));
    const filename = path.substring(path.lastIndexOf('/') + 1);
    const { data, error } = await supabase.storage.from(bucket).list(folder, { search: filename });
    if (error || !data?.length) return null;
    const size = data[0]?.metadata?.size;
    return typeof size === 'number' ? size : null;
  } catch {
    return null;
  }
}

/**
 * Uploads a portfolio or polaroid photo for a model.
 * Returns { url, fileSizeBytes } on success or null on failure.
 *
 * fileSizeBytes is the ACTUAL size verified from storage.objects after upload
 * (not the frontend-provided file.size). This value should be passed to addPhoto()
 * so it is stored in model_photos.file_size_bytes for reliable delete-decrement.
 * Any drift between the pre-increment (file.size) and the actual size is reconciled.
 */
export async function uploadModelPhoto(
  modelId: string,
  file: Blob | File,
): Promise<UploadPhotoResult | null> {
  // Enforce image rights confirmation before any upload (GDPR / workspace rule §14).
  // confirmImageRights() must have been called in the UI before triggering this function.
  const { data: { user: uploadUser } } = await supabase.auth.getUser();
  if (!uploadUser) {
    console.warn('uploadModelPhoto: unauthenticated call rejected');
    return null;
  }
  const hasConsent = await hasRecentImageRightsConfirmation(uploadUser.id, modelId);
  if (!hasConsent) {
    console.warn('uploadModelPhoto: image rights not confirmed for model', modelId);
    void logSecurityEvent({ type: 'file_rejected', metadata: { service: 'modelPhotosSupabase', fn: 'uploadModelPhoto', reason: 'image_rights_not_confirmed', model_id: modelId } });
    return null;
  }

  // Convert HEIC/HEIF to JPEG before validation (browser-image-compression doesn't support HEIC)
  file = await convertHeicToJpegIfNeeded(file);
  // MIME whitelist + size check (images only for portfolio)
  const mimeCheck = validateFile(file, PHOTO_ALLOWED_TYPES);
  if (!mimeCheck.ok) {
    console.warn('uploadModelPhoto: file validation failed', mimeCheck.error);
    void logSecurityEvent({ type: 'file_rejected', metadata: { service: 'modelPhotosSupabase', fn: 'uploadModelPhoto', reason: 'mime' } });
    return null;
  }
  // Magic byte check — prevents renamed executables
  const magicCheck = await checkMagicBytes(file);
  if (!magicCheck.ok) {
    console.warn('uploadModelPhoto: magic bytes check failed', magicCheck.error);
    void logSecurityEvent({ type: 'magic_bytes_fail', metadata: { service: 'modelPhotosSupabase', fn: 'uploadModelPhoto' } });
    return null;
  }
  // Extension consistency check
  const extCheck = checkExtensionConsistency(file);
  if (!extCheck.ok) {
    console.warn('uploadModelPhoto: extension consistency check failed', extCheck.error);
    void logSecurityEvent({ type: 'extension_mismatch', metadata: { service: 'modelPhotosSupabase', fn: 'uploadModelPhoto' } });
    return null;
  }
  // Strip EXIF metadata (GPS, camera info) via Canvas re-encoding
  const safeFile = await stripExifAndCompress(file);
  const claimedSize = safeFile instanceof File ? safeFile.size : (safeFile as Blob).size;

  // Agency storage limit check (uses frontend-reported size for pre-check).
  const storageCheck = await checkAndIncrementStorage(claimedSize);
  if (!storageCheck.allowed) {
    console.warn('uploadModelPhoto: storage limit reached', storageCheck);
    return null;
  }

  const ext = safeFile instanceof File ? (safeFile.name.split('.').pop() || 'jpg') : 'jpg';
  const path = `${MODEL_PHOTOS_PREFIX}/${modelId}/${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${ext}`;
  try {
    const { error } = await supabase.storage.from(PUBLIC_IMAGES_BUCKET).upload(path, safeFile, {
      contentType: safeFile.type || 'image/jpeg',
      upsert: false,
    });
    if (error) {
      console.error('uploadModelPhoto error:', error);
      await decrementStorage(claimedSize);
      return null;
    }

    // BUG 3 FIX: read actual file size from storage.objects metadata post-upload.
    // This corrects any drift between the frontend-provided size and what was stored.
    const actualSize = await getActualStorageSize(PUBLIC_IMAGES_BUCKET, path) ?? claimedSize;
    if (actualSize !== claimedSize) {
      if (actualSize > claimedSize) {
        const driftResult = await checkAndIncrementStorage(actualSize - claimedSize);
        if (!driftResult.allowed) {
          console.warn('[storage] uploadModelPhoto: post-upload size drift exceeded limit — counter undercounted', { actualSize, claimedSize });
        }
      } else {
        await decrementStorage(claimedSize - actualSize);
      }
    }

    // M-3 fix: store the canonical supabase-storage:// URI instead of a public URL.
    // The bucket is private; all reads go through resolveStorageUrl → signed URL.
    const storageUri = toStorageUri(PUBLIC_IMAGES_BUCKET, path);

    // Fire-and-forget audit log: resolve org from model record.
    void (async () => {
      const { data: modelRow } = await supabase
        .from('models')
        .select('organization_id')
        .eq('id', modelId)
        .maybeSingle();
      const orgId = (modelRow as { organization_id?: string } | null)?.organization_id;
      if (assertOrgContext(orgId, 'uploadModelPhoto')) {
        void logImageUpload(orgId, modelId, { bucket: PUBLIC_IMAGES_BUCKET, path, fileSizeBytes: actualSize });
      }
    })();

    return { url: storageUri, fileSizeBytes: actualSize };
  } catch (e) {
    console.error('uploadModelPhoto exception:', e);
    await decrementStorage(claimedSize);
    return null;
  }
}

/** Error thrown when the agency storage limit is exceeded. */
export class StorageLimitError extends Error {
  constructor() {
    super(uiCopy.storage.limitReached);
    this.name = 'StorageLimitError';
  }
}

/**
 * Uploads a private (agency-only) photo to the private 'documents' bucket.
 * Returns { url, fileSizeBytes } on success, or null on failure.
 * The url is a supabase-private:// scheme string — never a public URL.
 */
export async function uploadPrivateModelPhoto(
  modelId: string,
  file: Blob | File,
): Promise<UploadPhotoResult | null> {
  // Enforce image rights confirmation before any upload (GDPR / workspace rule §14).
  const { data: { user: uploadUser } } = await supabase.auth.getUser();
  if (!uploadUser) {
    console.warn('uploadPrivateModelPhoto: unauthenticated call rejected');
    return null;
  }
  const hasConsent = await hasRecentImageRightsConfirmation(uploadUser.id, modelId);
  if (!hasConsent) {
    console.warn('uploadPrivateModelPhoto: image rights not confirmed for model', modelId);
    void logSecurityEvent({ type: 'file_rejected', metadata: { service: 'modelPhotosSupabase', fn: 'uploadPrivateModelPhoto', reason: 'image_rights_not_confirmed', model_id: modelId } });
    return null;
  }

  // Convert HEIC/HEIF to JPEG before validation
  file = await convertHeicToJpegIfNeeded(file);
  // MIME whitelist + size check (images only)
  const mimeCheck = validateFile(file, PHOTO_ALLOWED_TYPES);
  if (!mimeCheck.ok) {
    console.warn('uploadPrivateModelPhoto: file validation failed', mimeCheck.error);
    void logSecurityEvent({ type: 'file_rejected', metadata: { service: 'modelPhotosSupabase', fn: 'uploadPrivateModelPhoto', reason: 'mime' } });
    return null;
  }
  // Magic byte check — prevents renamed executables
  const magicCheck = await checkMagicBytes(file);
  if (!magicCheck.ok) {
    console.warn('uploadPrivateModelPhoto: magic bytes check failed', magicCheck.error);
    void logSecurityEvent({ type: 'magic_bytes_fail', metadata: { service: 'modelPhotosSupabase', fn: 'uploadPrivateModelPhoto' } });
    return null;
  }
  // Extension consistency check
  const extCheck = checkExtensionConsistency(file);
  if (!extCheck.ok) {
    console.warn('uploadPrivateModelPhoto: extension consistency check failed', extCheck.error);
    void logSecurityEvent({ type: 'extension_mismatch', metadata: { service: 'modelPhotosSupabase', fn: 'uploadPrivateModelPhoto' } });
    return null;
  }
  // Strip EXIF metadata (GPS, camera info) via Canvas re-encoding
  const safeFile = await stripExifAndCompress(file);
  const claimedSize = safeFile instanceof File ? safeFile.size : (safeFile as Blob).size;

  const storageCheck = await checkAndIncrementStorage(claimedSize);
  if (!storageCheck.allowed) {
    console.warn('uploadPrivateModelPhoto: storage limit reached', storageCheck);
    return null;
  }

  const ext = safeFile instanceof File ? (safeFile.name.split('.').pop() || 'jpg') : 'jpg';
  const path = `${PRIVATE_PHOTOS_PREFIX}/${modelId}/${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${ext}`;
  try {
    const { error: uploadError } = await supabase.storage.from(PRIVATE_BUCKET).upload(path, safeFile, {
      contentType: safeFile.type || 'image/jpeg',
      upsert: false,
    });
    if (uploadError) {
      console.error('uploadPrivateModelPhoto upload error:', uploadError);
      await decrementStorage(claimedSize);
      return null;
    }

    // BUG 3 FIX: read actual size from storage.objects and reconcile.
    const actualSize = await getActualStorageSize(PRIVATE_BUCKET, path) ?? claimedSize;
    if (actualSize !== claimedSize) {
      if (actualSize > claimedSize) {
        const driftResult = await checkAndIncrementStorage(actualSize - claimedSize);
        if (!driftResult.allowed) {
          console.warn('[storage] uploadPrivateModelPhoto: post-upload size drift exceeded limit — counter undercounted', { actualSize, claimedSize });
        }
      } else {
        await decrementStorage(claimedSize - actualSize);
      }
    }

    // Store path as the URL — resolved to a signed URL at render time.
    const privateUri = `supabase-private://${PRIVATE_BUCKET}/${path}`;

    // Fire-and-forget audit log.
    void (async () => {
      const { data: modelRow } = await supabase
        .from('models')
        .select('organization_id')
        .eq('id', modelId)
        .maybeSingle();
      const orgId = (modelRow as { organization_id?: string } | null)?.organization_id;
      if (assertOrgContext(orgId, 'uploadPrivateModelPhoto')) {
        void logImageUpload(orgId, modelId, { bucket: PRIVATE_BUCKET, path, fileSizeBytes: actualSize, private: true });
      }
    })();

    return { url: privateUri, fileSizeBytes: actualSize };
  } catch (e) {
    console.error('uploadPrivateModelPhoto exception:', e);
    await decrementStorage(claimedSize);
    return null;
  }
}

/**
 * Resolves any storage URL / URI (supabase-private://, supabase-storage://, or
 * legacy public URL) to a short-lived signed URL (1 hour).
 * Plain https:// URLs that are not Supabase Storage URLs are returned as-is.
 *
 * Delegates to resolveStorageUrl (storageUrl.ts) which caches results.
 */
export async function getSignedPrivatePhotoUrl(url: string): Promise<string | null> {
  if (!url) return null;
  const resolved = await resolveStorageUrl(url, 3_600);
  return resolved || null;
}

/** Update models.portfolio_images from ordered URLs (first = cover for client swipe). */
export async function syncPortfolioToModel(modelId: string, urls: string[]): Promise<boolean> {
  const { error } = await supabase.rpc('agency_update_model_full', {
    p_model_id: modelId,
    p_portfolio_images: urls,
  });
  if (error) {
    console.error('syncPortfolioToModel error:', error);
    return false;
  }
  return true;
}

/** Legacy `models.polaroids` array — keep in sync with visible polaroid rows for clients / swipe. */
export async function syncPolaroidsToModel(modelId: string, urls: string[]): Promise<boolean> {
  const { error } = await supabase.rpc('agency_update_model_full', {
    p_model_id: modelId,
    p_polaroids: urls,
  });
  if (error) {
    console.error('syncPolaroidsToModel error:', error);
    return false;
  }
  return true;
}

