import { supabase } from '../../lib/supabase';

/**
 * Model-Fotos (Portfolio, Polaroids) – in Supabase gespeichert, pro model_id.
 * model_photos: url, sort_order, visible, photo_type; Bilder-URLs (Storage oder extern) pro Model.
 */
export type ModelPhotoType = 'portfolio' | 'polaroid';

export type ModelPhoto = {
  id: string;
  model_id: string;
  url: string;
  sort_order: number;
  visible: boolean;
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
  return (data ?? []) as ModelPhoto[];
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
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle();

  const nextSort = (maxSortData?.sort_order ?? 0) + 1;

  const { data, error } = await supabase
    .from('model_photos')
    .insert({
      model_id: modelId,
      url,
      sort_order: nextSort,
      visible: true,
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
}

export async function updatePhoto(
  photoId: string,
  fields: Partial<Pick<ModelPhoto, 'url' | 'visible' | 'sort_order' | 'source' | 'api_external_id' | 'photo_type'>>,
): Promise<boolean> {
  const { error } = await supabase
    .from('model_photos')
    .update(fields)
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

