/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * MediaslideSyncService
 *
 * - Kann per Webhook (einzelnes Model) oder per Cron (Batch) aufgerufen werden.
 * - Spiegelt Maße/Grunddaten eines Models aus Mediaslide in unsere `models`-Tabelle.
 * - Konfliktlösung:
 *   - Wir gehen davon aus, dass beide Systeme einen `updated_at`-Zeitstempel haben.
 *   - Standard: Feldgruppen werden nach dem jeweils neueren Zeitstempel entschieden.
 *   - Konflikte werden ins Log geschrieben (Supabase-Tabelle `mediaslide_sync_logs`).
 *
 * WICHTIG: Für echte Nutzung sollte die Migration
 *   `supabase/migration_mediaslide_sync_logs.sql`
 * im Supabase-Dashboard ausgeführt werden.
 */
import { supabase } from '../../lib/supabase';
import type { SupabaseModel } from './modelsSupabase';
import { agencyUpdateModelFullRpc, getModelByIdFromSupabase } from './modelsSupabase';
import { getModelFromMediaslide, syncModelData } from './mediaslideConnector';
import { fetchAllSupabasePages } from './supabaseFetchAll';
import { upsertTerritoriesForModelCountryAgencyPairs } from './territoriesSupabase';

/**
 * Lightweight concurrency limiter — avoids external p-limit dependency.
 * Runs `tasks` with at most `concurrency` in-flight at any time.
 */
async function runWithConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  concurrency: number,
): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let nextIdx = 0;

  async function worker(): Promise<void> {
    while (nextIdx < tasks.length) {
      const i = nextIdx++;
      results[i] = await tasks[i]();
    }
  }

  const slots = Math.min(concurrency, tasks.length);
  await Promise.all(Array.from({ length: slots }, worker));
  return results;
}

// ---------------------------------------------------------------------------
// Typen – vereinfachtes Mediaslide-Model
// ---------------------------------------------------------------------------

type MediaslideMeasurements = {
  height?: number | null;
  bust?: number | null;
  waist?: number | null;
  hips?: number | null;
  chest?: number | null;
  legs_inseam?: number | null;
  shoe_size?: number | null;
};

type MediaslideModelPayload = {
  id: string;
  updated_at?: string | null;
  mediaslide_sync_id?: string | null;
  name?: string | null;
  measurements?: MediaslideMeasurements;
  city?: string | null;
  country?: string | null;
  /** ISO-3166-1 alpha-2 code (e.g. "DE"). Preferred over legacy country string. */
  country_code?: string | null;
  hair_color?: string | null;
  eye_color?: string | null;
  /** Biological sex: 'male' | 'female' | null */
  sex?: 'male' | 'female' | null;
  /** Ethnic background matching ETHNICITY_OPTIONS. */
  ethnicity?: string | null;
  /** Marketing categories, e.g. ['Fashion', 'Commercial']. */
  categories?: string[] | null;
  /**
   * ISO-3166-1 alpha-2 territory codes the model should be listed under.
   * When present, these are upserted into model_agency_territories after sync.
   */
  territory_codes?: string[] | null;
  visibility?: {
    isVisibleCommercial?: boolean;
    isVisibleFashion?: boolean;
  };
};

// ---------------------------------------------------------------------------
// Logging für fehlgeschlagene API-Calls
// ---------------------------------------------------------------------------

export async function logMediaslideError(params: {
  operation: string;
  modelId?: string | null;
  mediaslideId?: string | null;
  statusCode?: number | null;
  message: string;
  details?: unknown;
}) {
  const payload = {
    operation: params.operation,
    model_id: params.modelId ?? null,
    mediaslide_id: params.mediaslideId ?? null,
    status_code: params.statusCode ?? null,
    message: params.message,
    details: params.details ?? null,
  };

  const { error } = await supabase.from('mediaslide_sync_logs').insert(payload);
  if (error) {
    // Fallback: zumindest im Server-Log sichtbar machen
    console.error('logMediaslideError failed', error, payload);
  }
}

// ---------------------------------------------------------------------------
// Konfliktlösung
// ---------------------------------------------------------------------------

function toTimestamp(value?: string | null): number | null {
  if (!value) return null;
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : t;
}

/**
 * Entscheidet, welche Messwerte übernommen werden.
 * Strategie:
 * - Wenn einer der Zeitstempel fehlt → bevorzugt lokales Model (wir überschreiben nichts).
 * - Sonst gewinnt der jeweils neuere Zeitstempel pro Feldgruppe.
 */
function resolveMeasurementsConflict(args: {
  local: SupabaseModel;
  remote: MediaslideMeasurements;
  localUpdatedAt?: string | null;
  remoteUpdatedAt?: string | null;
}): Partial<SupabaseModel> {
  const { local, remote, localUpdatedAt, remoteUpdatedAt } = args;
  const localTs = toTimestamp(localUpdatedAt ?? local.updated_at);
  const remoteTs = toTimestamp(remoteUpdatedAt);

  const result: Partial<SupabaseModel> = {};

  const remoteIsNewer = remoteTs !== null && (localTs === null || remoteTs > localTs);

  const fields: (keyof MediaslideMeasurements & keyof SupabaseModel)[] = [
    'height',
    'bust',
    'waist',
    'hips',
    'chest',
    'legs_inseam',
    'shoe_size',
  ];

  for (const f of fields) {
    const remoteVal = remote[f];
    if (remoteVal === undefined) continue; // Remote hat für dieses Feld nichts geschickt
    if (remoteIsNewer) {
      (result as any)[f] = remoteVal;
    } else {
      // lokaler Wert bleibt, wir schreiben nichts
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Zentrale Sync-Funktion (für Webhook & Cron)
// ---------------------------------------------------------------------------

export async function syncSingleModelFromMediaslide(args: {
  localModelId: string;
  mediaslideId: string;
  apiKey?: string;
}): Promise<{ ok: boolean; conflict?: boolean }> {
  const { localModelId, mediaslideId, apiKey } = args;

  const local = await getModelByIdFromSupabase(localModelId);
  if (!local) {
    await logMediaslideError({
      operation: 'syncSingleModelFromMediaslide',
      modelId: localModelId,
      mediaslideId,
      message: 'Local model not found',
    });
    return { ok: false };
  }

  let remote: MediaslideModelPayload | null = null;
  try {
    remote = (await getModelFromMediaslide(mediaslideId, apiKey)) as MediaslideModelPayload | null;
  } catch (e: any) {
    await logMediaslideError({
      operation: 'getModelFromMediaslide',
      modelId: localModelId,
      mediaslideId,
      message: e?.message || 'Failed to fetch model from Mediaslide',
      details: e,
    });
    return { ok: false };
  }

  if (!remote) {
    await logMediaslideError({
      operation: 'getModelFromMediaslide',
      modelId: localModelId,
      mediaslideId,
      message: 'Remote model not found',
    });
    return { ok: false };
  }

  const updates: Partial<SupabaseModel> = {};

  // Timestamp resolution: only overwrite scalar fields if Remote is strictly newer
  // than the local record. This prevents Mediaslide cron-sync from silently
  // reverting manual corrections an agency made to Name, City, etc.
  const localTs = toTimestamp(local.updated_at);
  const remoteTs = toTimestamp(remote.updated_at);
  const remoteScalarIsNewer = remoteTs !== null && (localTs === null || remoteTs > localTs);

  if (remoteScalarIsNewer) {
    if (typeof remote.name === 'string' && remote.name.trim()) {
      updates.name = remote.name.trim();
    }
    if (remote.city !== undefined) updates.city = remote.city ?? null;
    if (remote.country !== undefined) updates.country = remote.country ?? null;
    if (remote.country_code !== undefined)
      (updates as any).country_code = remote.country_code ?? null;
    if (remote.hair_color !== undefined) updates.hair_color = remote.hair_color ?? null;
    if (remote.eye_color !== undefined) updates.eye_color = remote.eye_color ?? null;
    if (remote.sex !== undefined) (updates as any).sex = remote.sex ?? null;
    if (remote.ethnicity !== undefined) (updates as any).ethnicity = remote.ethnicity ?? null;
    if (remote.categories !== undefined) (updates as any).categories = remote.categories ?? null;
  }

  // Maße mit Konfliktlösung (eigene Zeitstempel-Logik bleibt)
  if (remote.measurements) {
    Object.assign(
      updates,
      resolveMeasurementsConflict({
        local,
        remote: remote.measurements,
        localUpdatedAt: local.updated_at,
        remoteUpdatedAt: remote.updated_at,
      }),
    );
  }

  // Sichtbarkeit
  if (remote.visibility) {
    const v = remote.visibility;
    if (typeof v.isVisibleCommercial === 'boolean') {
      updates.is_visible_commercial = v.isVisibleCommercial;
    }
    if (typeof v.isVisibleFashion === 'boolean') {
      updates.is_visible_fashion = v.isVisibleFashion;
    }
  }

  if (Object.keys(updates).length === 0) {
    return { ok: true };
  }

  // Alle direkten Updates laufen über agency_update_model_full (SECURITY DEFINER).
  // REVOKED-Spalten (mediaslide_sync_id) werden separat via update_model_sync_ids gesetzt.
  const u = updates as any;
  const { error } = await agencyUpdateModelFullRpc({
    p_model_id: local.id,
    p_name: u.name ?? null,
    p_city: u.city ?? null,
    p_country: u.country ?? null,
    p_country_code: u.country_code ?? null,
    p_hair_color: u.hair_color ?? null,
    p_eye_color: u.eye_color ?? null,
    p_sex: u.sex ?? null,
    p_ethnicity: u.ethnicity ?? null,
    p_categories: u.categories ?? null,
    p_height: u.height ?? null,
    p_bust: u.bust ?? null,
    p_waist: u.waist ?? null,
    p_hips: u.hips ?? null,
    p_chest: u.chest ?? null,
    p_legs_inseam: u.legs_inseam ?? null,
    p_shoe_size: u.shoe_size ?? null,
    p_is_visible_commercial: u.is_visible_commercial ?? null,
    p_is_visible_fashion: u.is_visible_fashion ?? null,
  });

  if (error) {
    await logMediaslideError({
      operation: 'updateLocalModelFromMediaslide',
      modelId: localModelId,
      mediaslideId,
      message: 'Failed to update local model from Mediaslide',
      details: error,
    });
    return { ok: false };
  }

  // mediaslide_sync_id is REVOKED for authenticated users (security hardening).
  // Use the SECURITY DEFINER RPC that validates agency membership before writing.
  const { error: rpcError } = await supabase.rpc('update_model_sync_ids', {
    p_model_id: local.id,
    p_mediaslide_id: mediaslideId,
  });
  if (rpcError) {
    await logMediaslideError({
      operation: 'update_model_sync_ids',
      modelId: localModelId,
      mediaslideId,
      message: 'Failed to set mediaslide_sync_id via RPC',
      details: rpcError,
    });
    // Non-fatal for data sync — log and continue; the model data itself was updated.
  }

  // Sync territories if provided in the remote payload.
  if (remote.territory_codes && remote.territory_codes.length > 0 && local.agency_id) {
    try {
      await upsertTerritoriesForModelCountryAgencyPairs(
        local.id,
        remote.territory_codes.map((cc: string) => ({
          country_code: cc,
          agency_id: local.agency_id as string,
        })),
      );
    } catch (e) {
      await logMediaslideError({
        operation: 'syncTerritories',
        modelId: localModelId,
        mediaslideId,
        message: 'Failed to sync territories from Mediaslide',
        details: e,
      });
    }
  }

  // After a successful sync, check critical completeness fields and log a
  // warning if any are missing. This makes the issue visible to all agency
  // members via the sync log, and is picked up by the My Models banner.
  const freshModel = await getModelByIdFromSupabase(localModelId);
  if (freshModel) {
    const missingRequired: string[] = [];
    if (!freshModel.name?.trim()) missingRequired.push('name');
    if ((freshModel.portfolio_images ?? []).length === 0) missingRequired.push('portfolio_images');
    // Territory presence is checked via a separate query for accuracy.
    const { data: terr } = await supabase
      .from('model_assignments')
      .select('id')
      .eq('model_id', localModelId)
      .limit(1);
    if (!terr || terr.length === 0) missingRequired.push('territory');

    if (missingRequired.length > 0) {
      await logMediaslideError({
        operation: 'completeness_warning',
        modelId: localModelId,
        mediaslideId,
        message: `Model synced but missing required fields — will not appear to clients: ${missingRequired.join(', ')}`,
        details: { missing_required_fields: missingRequired },
      });
    }
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------
// Webhook-Entry-Point
// ---------------------------------------------------------------------------

/**
 * Handler für einen Mediaslide-Webhook.
 * Erwartet minimal: lokales Model und Mediaslide-ID.
 * Kann z. B. in einer API-Route aufgerufen werden.
 */
export async function handleMediaslideWebhook(payload: {
  localModelId: string;
  mediaslideId: string;
  apiKey?: string;
}): Promise<{ ok: boolean }> {
  const result = await syncSingleModelFromMediaslide(payload);
  if (!result.ok) {
    await logMediaslideError({
      operation: 'handleMediaslideWebhook',
      modelId: payload.localModelId,
      mediaslideId: payload.mediaslideId,
      message: 'Webhook sync failed',
    });
  }
  return { ok: result.ok };
}

// ---------------------------------------------------------------------------
// Cron-Job-Entry-Point
// ---------------------------------------------------------------------------

/**
 * Kann in einem Cron-Job (Supabase Edge Function, externes Cron, etc.) aufgerufen werden.
 * Idee:
 * - `syncModelData` ruft die Mediaslide-API an und stößt einen Abgleich an (z. B. Push in unsere DB),
 *   oder liefert wenigstens eine Liste von IDs, die aktualisiert werden sollen.
 * - Hier zeigen wir exemplarisch, wie man alle Models mit `mediaslide_sync_id` synchronisiert.
 */
/**
 * Cron-Entry-Point.
 *
 * Fixes:
 *   1. fetchAllSupabasePages → loads ALL sync models, not just the first 1000.
 *      (idx_models_mediaslide_sync_id makes this fast.)
 *   2. runWithConcurrency(5) → 5 parallel syncs instead of strict serial await-loop.
 *      Reduces wall-clock time from O(n) to O(n/5) without hammering the Mediaslide API.
 */
export async function runMediaslideCronSync(apiKey?: string): Promise<void> {
  let allRows: { id: string; mediaslide_sync_id: string }[];

  try {
    allRows = (
      await fetchAllSupabasePages(async (from, to) => {
        const { data, error } = await supabase
          .from('models')
          .select('id, mediaslide_sync_id')
          .not('mediaslide_sync_id', 'is', null)
          .range(from, to);
        return {
          data: data as { id: string; mediaslide_sync_id: string }[] | null,
          error,
        };
      })
    ).filter((r) => Boolean(r.mediaslide_sync_id));
  } catch (e: any) {
    await logMediaslideError({
      operation: 'runMediaslideCronSync',
      message: 'Failed to load models with mediaslide_sync_id',
      details: e,
    });
    return;
  }

  if (allRows.length === 0) return;

  const tasks = allRows.map((row) => async () => {
    try {
      await syncModelData(row.mediaslide_sync_id, apiKey);
      await syncSingleModelFromMediaslide({
        localModelId: row.id,
        mediaslideId: row.mediaslide_sync_id,
        apiKey,
      });
    } catch (e: any) {
      await logMediaslideError({
        operation: 'runMediaslideCronSync:task',
        modelId: row.id,
        mediaslideId: row.mediaslide_sync_id,
        message: e?.message || 'Error while cron-syncing single model',
        details: e,
      });
    }
  });

  await runWithConcurrency(tasks, 5);
}
