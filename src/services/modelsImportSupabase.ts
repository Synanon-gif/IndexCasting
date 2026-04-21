import { supabase } from '../../lib/supabase';
import { agencyUpdateModelFullRpc } from './modelsSupabase';
import { upsertTerritoriesForModelCountryAgencyPairs } from './territoriesSupabase';

export type ModelMergeTerritoryInput = {
  country_code: string;
  agency_id: string;
};

/** Return shape for {@link importModelAndMerge} — backward compatible (optional fields). */
export type ImportModelAndMergeResult = {
  model_id: string;
  created: boolean;
  /**
   * When true, Mediaslide/Netwalk IDs were provided for an **existing** row but
   * `update_model_sync_ids` failed — merge succeeded without persisting external IDs.
   */
  externalSyncIdsPersistFailed?: boolean;
  /**
   * When true, `params.territories` were provided but `save_model_territories`
   * failed (RPC error, RLS deny, transient network issue). The model row itself
   * was created/updated successfully — only the MAT (model_agency_territories)
   * write failed. The caller MUST surface this to the user, otherwise the
   * model would be silently invisible in the agency's "My Models" roster
   * (the roster query is fail-closed on MAT).
   */
  territoriesPersistFailed?: boolean;
  /** Optional human-readable detail for the territory failure — for UI / logs. */
  territoriesPersistFailureReason?: string;
};

export type ImportModelPayload = {
  mediaslide_sync_id?: string | null;
  /** Netwalk model ID — used as a lookup key before falling back to email. */
  netwalk_model_id?: string | null;
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
  /** ISO-3166-1 alpha-2 country code (e.g. "DE"). Used for territory-based discovery. */
  country_code?: string | null;
  hair_color?: string | null;
  eye_color?: string | null;
  ethnicity?: string | null;
  current_location?: string | null;
  sex?: 'male' | 'female' | null;
  categories?: string[] | null;
  is_visible_commercial?: boolean;
  is_visible_fashion?: boolean;
  /** Sports flags — set when adding a model manually. Not overwritten by API imports when undefined. */
  is_sports_winter?: boolean | null;
  is_sports_summer?: boolean | null;
  portfolio_images?: string[] | null;
  polaroids?: string[] | null;
  territories?: ModelMergeTerritoryInput[] | null;
  /**
   * When true and the model is matched via mediaslide_sync_id, measurement fields
   * (height, bust, waist, hips, chest, legs_inseam, shoe_size) are always overwritten
   * with the incoming values instead of only filling missing ones.
   * Use this when Mediaslide is the authoritative source of truth for measurements.
   */
  forceUpdateMeasurements?: boolean;
  /**
   * When true and the model is matched via mediaslide_sync_id / netwalk_model_id,
   * the appearance fields `hair_color` and `eye_color` are always overwritten
   * with the incoming raw strings instead of only filling missing ones.
   * Without this flag, an existing colour is never touched (`consider`-rule).
   * Use this when the package is the authoritative source for appearance, e.g.
   * after the agency edited the colour in MediaSlide and wants the local copy
   * to follow. Symmetric semantics to `forceUpdateMeasurements`.
   */
  forceUpdateAppearance?: boolean;
  /**
   * Quelle der Bilder/Profildaten. Bei INSERT direkt in die Spalte gesetzt; bei
   * UPDATE eines bestehenden Models mit `photo_source='own'` wird sie zusätzlich
   * via `set_model_photo_source`-RPC nachgezogen, damit Package-Importe nicht
   * still als "own" verbleiben.
   */
  photo_source?: 'own' | 'mediaslide' | 'netwalk';
  /** @internal Set by 23505 defense-in-depth to prevent infinite recursion. */
  _mergeRetry?: boolean;
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

export async function importModelAndMerge(
  params: ImportModelPayload,
): Promise<ImportModelAndMergeResult | null> {
  try {
    const externalId = params.mediaslide_sync_id?.trim() || null;
    const netwalkId = params.netwalk_model_id?.trim() || null;
    const email = params.email?.trim() || null;
    const birthday = params.birthday?.trim() || null;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

    if (!existing && netwalkId) {
      const { data, error } = await supabase
        .from('models')
        .select('*')
        .eq('netwalk_model_id', netwalkId)
        .maybeSingle();
      if (error) console.error('importModelAndMerge: netwalkId lookup error:', error);
      else existing = data ?? null;
    }

    if (!existing && email) {
      // Agency-scoped RPC: server-side email lookup (Gefahr 2 / Risiko D compliant).
      // agency_find_model_by_email() uses org_members/bookers guard + admin bypass +
      // row_security=off. Returns model only if same agency or unowned.
      // Uses array handling instead of .maybeSingle() because the RPC is RETURNS SETOF —
      // .maybeSingle() sends Accept: vnd.pgrst.object+json which causes 406 on 0 rows.
      const { data: emailRows, error } = await supabase.rpc('agency_find_model_by_email', {
        p_email: email.toLowerCase().trim(),
      });
      if (error) console.error('importModelAndMerge: email lookup error:', error);
      else
        existing = (
          Array.isArray(emailRows) ? (emailRows[0] ?? null) : (emailRows ?? null)
        ) as typeof existing;
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const updates: any = {};
      const forceMs =
        params.forceUpdateMeasurements === true && (Boolean(externalId) || Boolean(netwalkId));
      const forceApp =
        params.forceUpdateAppearance === true && (Boolean(externalId) || Boolean(netwalkId));

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

      // forceSet: always write the incoming value regardless of existing data.
      const forceSet = (key: string, value: unknown) => {
        if (value === undefined) return;
        updates[key] = value ?? null;
      };

      // Only fill missing scalar fields; never overwrite existing values.
      // Sync-IDs (mediaslide_sync_id, netwalk_model_id) sind REVOKED für direkte Updates
      // → werden separat über update_model_sync_ids RPC gesetzt (nach dem Profile-Update).
      consider('email', email);
      consider('birthday', birthday);
      consider('name', params.name, false);

      // Measurements: force-overwrite when Mediaslide is authoritative, otherwise fill missing.
      const measurementFields: Array<[string, unknown]> = [
        ['bust', params.bust ?? null],
        ['waist', params.waist ?? null],
        ['hips', params.hips ?? null],
        ['chest', params.chest ?? null],
        ['legs_inseam', params.legs_inseam ?? null],
        ['shoe_size', params.shoe_size ?? null],
        ['height', params.height],
      ];
      for (const [field, val] of measurementFields) {
        if (forceMs) forceSet(field, val);
        else consider(field, val);
      }

      consider('city', params.city ?? null);
      consider('country_code', params.country_code ?? null);
      // Appearance: force-overwrite when the package is authoritative, otherwise
      // fill missing only. Symmetric to the measurement branch above.
      if (forceApp) {
        forceSet('hair_color', params.hair_color ?? null);
        forceSet('eye_color', params.eye_color ?? null);
      } else {
        consider('hair_color', params.hair_color ?? null);
        consider('eye_color', params.eye_color ?? null);
      }
      consider('ethnicity', params.ethnicity ?? null);
      consider('current_location', params.current_location ?? null);
      consider('sex', params.sex ?? null);
      consider('categories', params.categories ?? null);
      if (params.is_sports_winter != null) consider('is_sports_winter', params.is_sports_winter);
      if (params.is_sports_summer != null) consider('is_sports_summer', params.is_sports_summer);

      // Merge arrays (avoid duplicates) if incoming arrays are provided.
      const incomingPortfolio = params.portfolio_images ?? null;
      if (incomingPortfolio) {
        updates.portfolio_images = mergeUniquePreserveOrder(
          existing.portfolio_images ?? [],
          incomingPortfolio,
        );
      }

      const incomingPolaroids = params.polaroids ?? null;
      if (incomingPolaroids) {
        updates.polaroids = mergeUniquePreserveOrder(existing.polaroids ?? [], incomingPolaroids);
      }

      if (Object.keys(updates).length > 0) {
        const { error } = await agencyUpdateModelFullRpc({
          p_model_id: existing.id,
          p_name: updates.name ?? null,
          p_email: updates.email ?? null,
          p_city: updates.city ?? null,
          p_country_code: updates.country_code ?? null,
          p_hair_color: updates.hair_color ?? null,
          p_eye_color: updates.eye_color ?? null,
          p_ethnicity: updates.ethnicity ?? null,
          p_current_location: updates.current_location ?? null,
          p_sex: updates.sex ?? null,
          p_categories: updates.categories ?? null,
          p_height: updates.height ?? null,
          p_bust: updates.bust ?? null,
          p_waist: updates.waist ?? null,
          p_hips: updates.hips ?? null,
          p_chest: updates.chest ?? null,
          p_legs_inseam: updates.legs_inseam ?? null,
          p_shoe_size: updates.shoe_size ?? null,
          p_portfolio_images: updates.portfolio_images ?? null,
          p_polaroids: updates.polaroids ?? null,
        });
        if (error) {
          console.error('importModelAndMerge: update error:', error);
          return null;
        }
      }

      // Sync-IDs separat über SECURITY DEFINER RPC setzen (REVOKED für direkte Updates)
      let externalSyncIdsPersistFailed = false;
      if (externalId || netwalkId) {
        const { error: syncError } = await supabase.rpc('update_model_sync_ids', {
          p_model_id: existing.id,
          p_mediaslide_id: externalId ?? undefined,
          p_netwalk_model_id: netwalkId ?? undefined,
        });
        if (syncError) {
          console.error('importModelAndMerge: sync_ids update error:', syncError);
          externalSyncIdsPersistFailed = true;
        }
      }

      // photo_source angleichen, wenn der Import von einem externen Provider kommt
      // und das bestehende Model noch als 'own' markiert ist. Fehler hier dürfen den
      // Import NICHT scheitern lassen — wir loggen und gehen weiter.
      if (
        params.photo_source &&
        params.photo_source !== 'own' &&
        (existing.photo_source === 'own' || existing.photo_source == null)
      ) {
        try {
          const { error: psError } = await supabase.rpc('set_model_photo_source', {
            p_model_id: existing.id,
            p_source: params.photo_source,
          });
          if (psError) {
            console.warn('importModelAndMerge: set_model_photo_source failed:', psError);
          }
        } catch (psEx) {
          console.warn('importModelAndMerge: set_model_photo_source threw:', psEx);
        }
      }

      // Territory-Claims separat & robust schreiben. WICHTIG: Fehler hier dürfen
      // den (bereits erfolgreichen) Merge nicht in einen `null`-Return kippen,
      // sonst gibt es State-Divergence: Model wurde aktualisiert, aber Caller
      // glaubt es ist gescheitert. Stattdessen flaggen wir den Fehler und
      // surfacen ihn im `commitPreview`-Outcome als Warning.
      let territoriesPersistFailed = false;
      let territoriesPersistFailureReason: string | undefined;
      if (params.territories?.length) {
        try {
          await upsertTerritoriesForModelCountryAgencyPairs(existing.id, params.territories);
        } catch (terrErr) {
          territoriesPersistFailed = true;
          territoriesPersistFailureReason =
            terrErr instanceof Error ? terrErr.message : 'unknown_territory_error';
          console.error('importModelAndMerge: territory write failed (merge path):', terrErr);
        }
      }

      return {
        model_id: existing.id,
        created: false,
        ...(externalSyncIdsPersistFailed ? { externalSyncIdsPersistFailed: true } : {}),
        ...(territoriesPersistFailed
          ? {
              territoriesPersistFailed: true,
              territoriesPersistFailureReason,
            }
          : {}),
      };
    }

    // Create new model
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const payload: any = {
      agency_id: params.agency_id ?? null,
      mediaslide_sync_id: externalId ?? null,
      netwalk_model_id: netwalkId ?? null,
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
      country_code: params.country_code ?? null,
      hair_color: params.hair_color ?? null,
      eye_color: params.eye_color ?? null,
      ethnicity: params.ethnicity ?? null,
      current_location: params.current_location ?? null,
      sex: params.sex ?? null,
      categories: params.categories ?? null,
      is_visible_commercial: params.is_visible_commercial ?? true,
      is_visible_fashion: params.is_visible_fashion ?? false,
      // Sports flags: only set when explicitly provided (manual add). API imports leave as DB default (false).
      ...(params.is_sports_winter != null ? { is_sports_winter: params.is_sports_winter } : {}),
      ...(params.is_sports_summer != null ? { is_sports_summer: params.is_sports_summer } : {}),
      portfolio_images: params.portfolio_images ?? [],
      polaroids: params.polaroids ?? [],
      birthday: birthday ?? null,
      ...(params.photo_source ? { photo_source: params.photo_source } : {}),
    };

    const { data, error } = await supabase
      .from('models')
      .insert(payload)
      .select('id')
      .maybeSingle();

    if (error) {
      // 23505 = unique constraint violation (e.g. email already exists).
      // Defense-in-depth: if the normal email lookup missed the row (RPC error,
      // race condition, cross-agency model), retry as merge instead of dead-ending.
      if (error.code === '23505' && email && !params._mergeRetry) {
        console.warn('importModelAndMerge: 23505 on INSERT — retrying as merge');
        const { data: conflictRows } = await supabase.rpc('agency_find_model_by_email', {
          p_email: email.toLowerCase().trim(),
        });
        const conflictModel = Array.isArray(conflictRows)
          ? (conflictRows[0] ?? null)
          : (conflictRows ?? null);
        if (conflictModel) {
          return importModelAndMerge({ ...params, _mergeRetry: true } as ImportModelPayload);
        }
      }
      console.error('importModelAndMerge: insert error:', error);
      return null;
    }

    if (!data?.id) {
      console.error(
        'importModelAndMerge: INSERT succeeded but row not returned by RLS — cannot proceed',
      );
      return null;
    }

    // Same robust pattern for the INSERT path: do not let a territory failure
    // wipe out the freshly created model row from the result. The caller
    // surfaces this as a warning so the agency can retry the territory step.
    let territoriesPersistFailed = false;
    let territoriesPersistFailureReason: string | undefined;
    if (params.territories?.length) {
      try {
        await upsertTerritoriesForModelCountryAgencyPairs(data.id, params.territories);
      } catch (terrErr) {
        territoriesPersistFailed = true;
        territoriesPersistFailureReason =
          terrErr instanceof Error ? terrErr.message : 'unknown_territory_error';
        console.error('importModelAndMerge: territory write failed (insert path):', terrErr);
      }
    }

    return {
      model_id: data.id,
      created: true,
      ...(territoriesPersistFailed
        ? {
            territoriesPersistFailed: true,
            territoriesPersistFailureReason,
          }
        : {}),
    };
  } catch (e) {
    console.error('importModelAndMerge exception:', e);
    return null;
  }
}
