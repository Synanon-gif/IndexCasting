import { supabase } from '../../lib/supabase';

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
};

export async function getPhotosForModel(
  modelId: string,
  type?: ModelPhotoType,
): Promise<ModelPhoto[]> {
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
  return (data ?? []).map((row: any) => {
    const isVisibleToClients = Boolean(row.is_visible_to_clients ?? row.visible ?? true);
    return {
      ...(row as ModelPhoto),
      visible: isVisibleToClients,
      is_visible_to_clients: row.is_visible_to_clients ?? isVisibleToClients,
    };
  });
}

export async function upsertPhotosForModel(
  modelId: string,
  photos: Array<Omit<ModelPhoto, 'id' | 'model_id'> & { id?: string }>,
): Promise<ModelPhoto[]> {
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
}

export async function addPhoto(
  modelId: string,
  url: string,
  type: ModelPhotoType,
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
 */
export async function deletePhoto(photoId: string, url: string): Promise<boolean> {
  try {
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
  const payload: any = { ...fields };
  if ('visible' in fields && fields.visible !== undefined && payload.is_visible_to_clients === undefined) {
    payload.is_visible_to_clients = fields.visible;
  }
  if ('is_visible_to_clients' in fields && fields.is_visible_to_clients !== undefined && payload.visible === undefined) {
    payload.visible = fields.is_visible_to_clients;
  }

  const { error } = await supabase
    .from('model_photos')
    .update(payload)
    .eq('id', photoId);

  if (error) {
    console.error('updatePhoto error:', error);
    return false;
  }
  return true;
}

export async function reorderPhotos(
  modelId: string,
  orderedIds: string[],
): Promise<boolean> {
  if (!orderedIds.length) return true;

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
}

/** Public bucket for images that everyone may see (model portfolio, etc.). Keep "documents" private. */
const PUBLIC_IMAGES_BUCKET = 'documentspictures';
const MODEL_PHOTOS_PREFIX = 'model-photos';

/** Private bucket for agency-only files (internal documents, private photos). */
const PRIVATE_BUCKET = 'documents';
const PRIVATE_PHOTOS_PREFIX = 'model-private-photos';

/** Upload a portfolio or polaroid photo for a model; returns public URL or null. */
export async function uploadModelPhoto(modelId: string, file: Blob | File): Promise<string | null> {
  const ext = file instanceof File ? (file.name.split('.').pop() || 'jpg') : 'jpg';
  const path = `${MODEL_PHOTOS_PREFIX}/${modelId}/${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${ext}`;
  try {
    const { error } = await supabase.storage.from(PUBLIC_IMAGES_BUCKET).upload(path, file, {
      contentType: file.type || 'image/jpeg',
      upsert: false,
    });
    if (error) {
      console.error('uploadModelPhoto error:', error);
      return null;
    }
    const { data } = supabase.storage.from(PUBLIC_IMAGES_BUCKET).getPublicUrl(path);
    return data?.publicUrl ?? null;
  } catch (e) {
    console.error('uploadModelPhoto exception:', e);
    return null;
  }
}

/**
 * Uploads a private (agency-only) photo to the private 'documents' bucket.
 * Returns a signed URL valid for 1 hour, or null on failure.
 * Private photos are NEVER accessible via public URLs.
 */
export async function uploadPrivateModelPhoto(
  modelId: string,
  file: Blob | File,
): Promise<string | null> {
  const ext = file instanceof File ? (file.name.split('.').pop() || 'jpg') : 'jpg';
  const path = `${PRIVATE_PHOTOS_PREFIX}/${modelId}/${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${ext}`;
  try {
    const { error: uploadError } = await supabase.storage.from(PRIVATE_BUCKET).upload(path, file, {
      contentType: file.type || 'image/jpeg',
      upsert: false,
    });
    if (uploadError) {
      console.error('uploadPrivateModelPhoto upload error:', uploadError);
      return null;
    }
    // Store the storage path as the URL so we can derive signed URLs on demand.
    // Format: supabase-private://<bucket>/<path>  — resolved at render time.
    return `supabase-private://${PRIVATE_BUCKET}/${path}`;
  } catch (e) {
    console.error('uploadPrivateModelPhoto exception:', e);
    return null;
  }
}

/**
 * Resolves a private photo URL to a short-lived signed URL (1 hour).
 * If the url is already a regular http(s) URL, it is returned as-is.
 */
export async function getSignedPrivatePhotoUrl(url: string): Promise<string | null> {
  if (!url.startsWith('supabase-private://')) return url;
  try {
    const withoutScheme = url.replace('supabase-private://', '');
    const slashIdx = withoutScheme.indexOf('/');
    const bucket = withoutScheme.slice(0, slashIdx);
    const path = withoutScheme.slice(slashIdx + 1);
    const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 3600);
    if (error) {
      console.error('getSignedPrivatePhotoUrl error:', error);
      return null;
    }
    return data?.signedUrl ?? null;
  } catch (e) {
    console.error('getSignedPrivatePhotoUrl exception:', e);
    return null;
  }
}

/** Update models.portfolio_images from ordered URLs (first = cover for client swipe). */
export async function syncPortfolioToModel(modelId: string, urls: string[]): Promise<boolean> {
  const { error } = await supabase
    .from('models')
    .update({ portfolio_images: urls })
    .eq('id', modelId);
  if (error) {
    console.error('syncPortfolioToModel error:', error);
    return false;
  }
  return true;
}

/** Legacy `models.polaroids` array — keep in sync with visible polaroid rows for clients / swipe. */
export async function syncPolaroidsToModel(modelId: string, urls: string[]): Promise<boolean> {
  const { error } = await supabase
    .from('models')
    .update({ polaroids: urls })
    .eq('id', modelId);
  if (error) {
    console.error('syncPolaroidsToModel error:', error);
    return false;
  }
  return true;
}

