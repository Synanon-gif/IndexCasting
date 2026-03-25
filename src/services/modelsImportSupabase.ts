import { supabase } from '../../lib/supabase';
import { upsertTerritoriesForModelCountryAgencyPairs } from './territoriesSupabase';

export type ModelMergeTerritoryInput = {
  country_code: string;
  agency_id: string;
};

export type ImportModelPayload = {
  mediaslide_sync_id?: string | null;
  email?: string | null;
  name: string;
  birthday?: string | null; // optional; used only if column exists in DB
  agency_id?: string | null;
  height: number;
  bust?: number | null;
  waist?: number | null;
  hips?: number | null;
  chest?: number | null;
  legs_inseam?: number | null;
  shoe_size?: number | null;
  city?: string | null;
  hair_color?: string | null;
  eye_color?: string | null;
  current_location?: string | null;
  sex?: 'male' | 'female' | null;
  is_visible_commercial?: boolean;
  is_visible_fashion?: boolean;
  portfolio_images?: string[] | null;
  polaroids?: string[] | null;
  territories?: ModelMergeTerritoryInput[] | null;
};

function mergeUniquePreserveOrder(existing: string[], incoming: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of [...existing, ...incoming]) {
    const s = (v ?? '').trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

function isMissing(v: unknown): boolean {
  return v === null || v === undefined;
}

export async function importModelAndMerge(params: ImportModelPayload): Promise<{ model_id: string; created: boolean } | null> {
  try {
    const externalId = params.mediaslide_sync_id?.trim() || null;
    const email = params.email?.trim() || null;
    const birthday = params.birthday?.trim() || null;

    let existing: any | null = null;

    if (externalId) {
      const { data, error } = await supabase
        .from('models')
        .select('*')
        .eq('mediaslide_sync_id', externalId)
        .maybeSingle();
      if (error) console.error('importModelAndMerge: externalId lookup error:', error);
      else existing = data ?? null;
    }

    if (!existing && email) {
      const emailNorm = email.toLowerCase();
      const { data, error } = await supabase
        .from('models')
        .select('*')
        .eq('email', emailNorm)
        .maybeSingle();
      if (error) console.error('importModelAndMerge: email lookup error:', error);
      else existing = data ?? null;
    }

    if (!existing && birthday) {
      // Optional match (column may not exist yet); if it fails we fall back to create.
      const { data, error } = await supabase
        .from('models')
        .select('*')
        .eq('name', params.name)
        .eq('birthday', birthday)
        .maybeSingle();
      if (error) console.error('importModelAndMerge: birthday lookup error:', error);
      else existing = data ?? null;
    }

    if (existing) {
      const updates: any = {};

      const consider = (key: string, value: unknown, allowEmptyString = false) => {
        if (value === undefined || value === null) return;
        const localVal = existing[key];
        if (!isMissing(localVal)) return;
        if (typeof value === 'string') {
          if (!allowEmptyString && value.trim().length === 0) return;
          updates[key] = value;
        } else {
          updates[key] = value;
        }
      };

      // Only fill missing scalar fields; never overwrite existing values.
      consider('mediaslide_sync_id', externalId);
      consider('email', email);
      consider('birthday', birthday);
      consider('name', params.name, false);
      consider('bust', params.bust ?? null);
      consider('waist', params.waist ?? null);
      consider('hips', params.hips ?? null);
      consider('chest', params.chest ?? null);
      consider('legs_inseam', params.legs_inseam ?? null);
      consider('shoe_size', params.shoe_size ?? null);
      consider('city', params.city ?? null);
      consider('hair_color', params.hair_color ?? null);
      consider('eye_color', params.eye_color ?? null);
      consider('current_location', params.current_location ?? null);
      consider('sex', params.sex ?? null);

      // Merge arrays (avoid duplicates) if incoming arrays are provided.
      const incomingPortfolio = params.portfolio_images ?? null;
      if (incomingPortfolio) {
        updates.portfolio_images = mergeUniquePreserveOrder(existing.portfolio_images ?? [], incomingPortfolio);
      }

      const incomingPolaroids = params.polaroids ?? null;
      if (incomingPolaroids) {
        updates.polaroids = mergeUniquePreserveOrder(existing.polaroids ?? [], incomingPolaroids);
      }

      if (Object.keys(updates).length > 0) {
        const { error } = await supabase
          .from('models')
          .update(updates)
          .eq('id', existing.id);
        if (error) console.error('importModelAndMerge: update error:', error);
      }

      if (params.territories?.length) {
        await upsertTerritoriesForModelCountryAgencyPairs(existing.id, params.territories);
      }

      return { model_id: existing.id, created: false };
    }

    // Create new model
    const payload: any = {
      agency_id: params.agency_id ?? null,
      mediaslide_sync_id: externalId ?? null,
      email: email ? email.toLowerCase() : null,
      name: params.name,
      height: params.height,
      bust: params.bust ?? null,
      waist: params.waist ?? null,
      hips: params.hips ?? null,
      chest: params.chest ?? null,
      legs_inseam: params.legs_inseam ?? null,
      shoe_size: params.shoe_size ?? null,
      city: params.city ?? null,
      hair_color: params.hair_color ?? null,
      eye_color: params.eye_color ?? null,
      current_location: params.current_location ?? null,
      sex: params.sex ?? null,
      is_visible_commercial: params.is_visible_commercial ?? true,
      is_visible_fashion: params.is_visible_fashion ?? false,
      // is_sports_winter / is_sports_summer intentionally omitted → DB default false.
      // Sports assignments are managed manually by the agency, never overwritten by API imports.
      portfolio_images: params.portfolio_images ?? [],
      polaroids: params.polaroids ?? [],
      birthday: birthday ?? null,
    };

    const { data, error } = await supabase
      .from('models')
      .insert(payload)
      .select('*')
      .single();

    if (error) {
      console.error('importModelAndMerge: insert error:', error);
      return null;
    }

    if (params.territories?.length) {
      await upsertTerritoriesForModelCountryAgencyPairs(data.id, params.territories);
    }

    return { model_id: data.id, created: true };
  } catch (e) {
    console.error('importModelAndMerge exception:', e);
    return null;
  }
}

