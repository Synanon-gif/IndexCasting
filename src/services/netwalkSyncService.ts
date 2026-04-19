/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * NetwalkSyncService
 *
 * Mirrors mediaslideSyncService.ts exactly for Netwalk.
 *
 * - Webhook (single model) or Cron (batch).
 * - Syncs measurements + base data from Netwalk into the `models` table.
 * - Conflict resolution: uses `updated_at` timestamps — local wins on tie or
 *   missing remote timestamp.
 * - Errors are logged to `mediaslide_sync_logs` (shared table; `operation`
 *   field distinguishes Mediaslide vs Netwalk entries).
 *
 * IMPORTANT: Run `supabase/migration_mediaslide_sync_logs.sql` in Supabase
 * before using this service in production.
 */
import { supabase } from '../../lib/supabase';
import type { SupabaseModel } from './modelsSupabase';
import { agencyUpdateModelFullRpc, getModelByIdFromSupabase } from './modelsSupabase';
import {
  getCalendarFromNetwalk,
  getModelFromNetwalk,
  getPortfolioFromNetwalk,
  syncModelData,
} from './netwalkConnector';
import { fetchAllSupabasePages } from './supabaseFetchAll';
import { logMediaslideError, type ExternalCalendarBlockoutRemote } from './mediaslideSyncService';
import { upsertTerritoriesForModelCountryAgencyPairs } from './territoriesSupabase';

// Re-export the shared log helper under a Netwalk-specific alias for clarity.
export const logNetwalkError = logMediaslideError;

// ---------------------------------------------------------------------------
// Concurrency limiter (shared pattern from mediaslideSyncService)
// ---------------------------------------------------------------------------

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
// Typen
// ---------------------------------------------------------------------------

type NetwalkMeasurements = {
  height?: number | null;
  bust?: number | null;
  waist?: number | null;
  hips?: number | null;
  chest?: number | null;
  legs_inseam?: number | null;
  shoe_size?: number | null;
};

type NetwalkModelPayload = {
  id: string;
  updated_at?: string | null;
  netwalk_model_id?: string | null;
  name?: string | null;
  measurements?: NetwalkMeasurements;
  city?: string | null;
  country?: string | null;
  country_code?: string | null;
  hair_color?: string | null;
  eye_color?: string | null;
  sex?: 'male' | 'female' | null;
  ethnicity?: string | null;
  categories?: string[] | null;
  /** ISO-3166-1 alpha-2 territory codes to upsert after sync. */
  territory_codes?: string[] | null;
  visibility?: {
    isVisibleCommercial?: boolean;
    isVisibleFashion?: boolean;
  };
  /**
   * Optional portfolio mirror — only consumed when models.photo_source = 'netwalk'.
   * URLs are stored as-is (no local storage mirror); UI renders them directly.
   */
  portfolio?: {
    images?: string[] | null;
    polaroids?: string[] | null;
  };
};

// ---------------------------------------------------------------------------
// Conflict resolution (identical logic to mediaslideSyncService)
// ---------------------------------------------------------------------------

function toTimestamp(value?: string | null): number | null {
  if (!value) return null;
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : t;
}

function resolveMeasurementsConflict(args: {
  local: SupabaseModel;
  remote: NetwalkMeasurements;
  localUpdatedAt?: string | null;
  remoteUpdatedAt?: string | null;
}): Partial<SupabaseModel> {
  const { local, remote, localUpdatedAt, remoteUpdatedAt } = args;
  const localTs = toTimestamp(localUpdatedAt ?? local.updated_at);
  const remoteTs = toTimestamp(remoteUpdatedAt);

  const result: Partial<SupabaseModel> = {};
  const remoteIsNewer = remoteTs !== null && (localTs === null || remoteTs > localTs);

  const fields: (keyof NetwalkMeasurements & keyof SupabaseModel)[] = [
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
    if (remoteVal === undefined) continue;
    if (remoteIsNewer) {
      (result as any)[f] = remoteVal;
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Core sync function
// ---------------------------------------------------------------------------

export async function syncSingleModelFromNetwalk(args: {
  localModelId: string;
  netwalkId: string;
  apiKey?: string;
}): Promise<{ ok: boolean; conflict?: boolean }> {
  const { localModelId, netwalkId, apiKey } = args;

  const local = await getModelByIdFromSupabase(localModelId);
  if (!local) {
    await logNetwalkError({
      operation: 'syncSingleModelFromNetwalk',
      modelId: localModelId,
      mediaslideId: netwalkId,
      message: 'Local model not found',
    });
    return { ok: false };
  }

  let remote: NetwalkModelPayload | null = null;
  try {
    remote = (await getModelFromNetwalk(netwalkId, apiKey)) as NetwalkModelPayload | null;
  } catch (e: any) {
    await logNetwalkError({
      operation: 'getModelFromNetwalk',
      modelId: localModelId,
      mediaslideId: netwalkId,
      message: e?.message || 'Failed to fetch model from Netwalk',
      details: e,
    });
    return { ok: false };
  }

  if (!remote) {
    await logNetwalkError({
      operation: 'getModelFromNetwalk',
      modelId: localModelId,
      mediaslideId: netwalkId,
      message: 'Remote model not found in Netwalk',
    });
    return { ok: false };
  }

  const updates: Partial<SupabaseModel> = {};

  // Timestamp resolution: only overwrite scalar fields if Remote is strictly newer.
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

  if (remote.visibility) {
    const v = remote.visibility;
    if (typeof v.isVisibleCommercial === 'boolean') {
      updates.is_visible_commercial = v.isVisibleCommercial;
    }
    if (typeof v.isVisibleFashion === 'boolean') {
      updates.is_visible_fashion = v.isVisibleFashion;
    }
  }

  // Photo-source branching: only mirror remote portfolio URLs when the agency
  // explicitly opted into 'netwalk' as the source-of-truth for this model.
  // Default 'own' → never overwrite portfolio_images / polaroids from remote
  // (model_photos pipeline drives the mirror columns; see system-invariants §27.1).
  let photoSource: 'own' | 'mediaslide' | 'netwalk' = 'own';
  try {
    const { data: ps } = await supabase
      .from('models')
      .select('photo_source')
      .eq('id', local.id)
      .maybeSingle();
    if (ps && (ps as { photo_source?: string }).photo_source) {
      const v = (ps as { photo_source: string }).photo_source;
      if (v === 'own' || v === 'mediaslide' || v === 'netwalk') photoSource = v;
    }
  } catch {
    /* default to 'own' */
  }

  if (photoSource === 'netwalk' && remote.portfolio) {
    if (Array.isArray(remote.portfolio.images)) {
      (updates as any).portfolio_images = remote.portfolio.images;
    }
    if (Array.isArray(remote.portfolio.polaroids)) {
      (updates as any).polaroids = remote.portfolio.polaroids;
    }
  }

  if (Object.keys(updates).length === 0) {
    return { ok: true };
  }

  // Alle direkten Updates laufen über agency_update_model_full (SECURITY DEFINER).
  // REVOKED-Spalten (netwalk_model_id) werden separat via update_model_sync_ids gesetzt.
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
    p_portfolio_images: u.portfolio_images ?? null,
    p_polaroids: u.polaroids ?? null,
  });

  if (error) {
    await logNetwalkError({
      operation: 'updateLocalModelFromNetwalk',
      modelId: localModelId,
      mediaslideId: netwalkId,
      message: 'Failed to update local model from Netwalk',
      details: error,
    });
    return { ok: false };
  }

  // netwalk_model_id is REVOKED for authenticated users (security hardening).
  // Use the SECURITY DEFINER RPC that validates agency membership before writing.
  const { error: rpcError } = await supabase.rpc('update_model_sync_ids', {
    p_model_id: local.id,
    p_netwalk_model_id: netwalkId,
  });
  if (rpcError) {
    await logNetwalkError({
      operation: 'update_model_sync_ids',
      modelId: localModelId,
      mediaslideId: netwalkId,
      message: 'Failed to set netwalk_model_id via RPC',
      details: rpcError,
    });
    // Non-fatal — model data was updated; only the external ID stamp failed.
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
      await logNetwalkError({
        operation: 'syncTerritories',
        modelId: localModelId,
        mediaslideId: netwalkId,
        message: 'Failed to sync territories from Netwalk',
        details: e,
      });
    }
  }

  // After a successful sync, log a completeness_warning if any mandatory
  // fields are missing. All agency members can see this via the sync log.
  const freshModel = await getModelByIdFromSupabase(localModelId);
  if (freshModel) {
    const missingRequired: string[] = [];
    if (!freshModel.name?.trim()) missingRequired.push('name');
    if ((freshModel.portfolio_images ?? []).length === 0) missingRequired.push('portfolio_images');
    const { data: terr } = await supabase
      .from('model_assignments')
      .select('id')
      .eq('model_id', localModelId)
      .limit(1);
    if (!terr || terr.length === 0) missingRequired.push('territory');

    if (missingRequired.length > 0) {
      await logNetwalkError({
        operation: 'completeness_warning',
        modelId: localModelId,
        mediaslideId: netwalkId,
        message: `Model synced but missing required fields — will not appear to clients: ${missingRequired.join(', ')}`,
        details: { missing_required_fields: missingRequired },
      });
    }
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------
// Inbound calendar sync (Netwalk → calendar_entries)
// ---------------------------------------------------------------------------

/**
 * Pull calendar block-outs for a model from Netwalk and reconcile them with
 * `calendar_entries`. Mirrors syncCalendarFromMediaslide exactly — see that
 * function's docblock for the conflict-resolution invariants (system-invariants
 * §G — Calendar as Projection):
 *
 *   1. Canonical rows (option_request_id IS NOT NULL) ALWAYS win.
 *   2. External rows are visual-only block-outs; never enter Smart Attention.
 *   3. Idempotent: matched on (external_source, external_event_id);
 *      only updates rows whose remote `updated_at` is strictly newer.
 *   4. Removed-on-remote: external rows missing from the payload are marked
 *      status='cancelled' (never deleted).
 */
export async function syncCalendarFromNetwalk(args: {
  localModelId: string;
  netwalkId: string;
  apiKey?: string;
}): Promise<{ ok: boolean; upserted: number; cancelled: number }> {
  const { localModelId, netwalkId, apiKey } = args;

  let remote: ExternalCalendarBlockoutRemote[] = [];
  try {
    const raw = await getCalendarFromNetwalk(netwalkId, apiKey);
    remote = (Array.isArray(raw) ? raw : []) as ExternalCalendarBlockoutRemote[];
  } catch (e: any) {
    await logNetwalkError({
      operation: 'getCalendarFromNetwalk',
      modelId: localModelId,
      mediaslideId: netwalkId,
      message: e?.message || 'Failed to fetch calendar from Netwalk',
      details: e,
    });
    return { ok: false, upserted: 0, cancelled: 0 };
  }

  const remoteIds = new Set(
    remote.map((e) => e.external_event_id).filter((id): id is string => Boolean(id)),
  );

  const { data: existingRows, error: existingErr } = await supabase
    .from('calendar_entries')
    .select('id, external_event_id, external_updated_at, status, date')
    .eq('model_id', localModelId)
    .eq('external_source', 'netwalk');

  if (existingErr) {
    await logNetwalkError({
      operation: 'syncCalendarFromNetwalk:loadExisting',
      modelId: localModelId,
      mediaslideId: netwalkId,
      message: existingErr.message,
      details: existingErr,
    });
    return { ok: false, upserted: 0, cancelled: 0 };
  }

  const existingByExtId = new Map<
    string,
    { id: string; external_updated_at: string | null; status: string | null; date: string | null }
  >();
  for (const r of existingRows ?? []) {
    if (r.external_event_id) {
      existingByExtId.set(r.external_event_id, {
        id: r.id,
        external_updated_at: r.external_updated_at,
        status: r.status,
        date: r.date,
      });
    }
  }

  const { data: canonicalRows } = await supabase
    .from('calendar_entries')
    .select('date')
    .eq('model_id', localModelId)
    .not('option_request_id', 'is', null)
    .neq('status', 'cancelled');

  const canonicalDates = new Set((canonicalRows ?? []).map((r: any) => r.date as string));

  let upserted = 0;
  let cancelled = 0;

  for (const ev of remote) {
    if (!ev.external_event_id || !ev.date) continue;
    if (canonicalDates.has(ev.date)) continue; // canonical wins

    const existing = existingByExtId.get(ev.external_event_id);
    const remoteTs = toTimestamp(ev.updated_at ?? null);
    const existingTs = toTimestamp(existing?.external_updated_at ?? null);

    const remoteIsNewer =
      !existing || (remoteTs !== null && (existingTs === null || remoteTs > existingTs));

    if (!remoteIsNewer) continue;

    const payload = {
      model_id: localModelId,
      date: ev.date,
      start_time: ev.start_time ?? null,
      end_time: ev.end_time ?? null,
      status: ev.status ?? 'unavailable',
      title: ev.title ?? 'Netwalk block-out',
      external_source: 'netwalk' as const,
      external_event_id: ev.external_event_id,
      external_updated_at: ev.updated_at ?? new Date().toISOString(),
    };

    if (existing) {
      const { error: updErr } = await supabase
        .from('calendar_entries')
        .update(payload)
        .eq('id', existing.id);
      if (updErr) {
        await logNetwalkError({
          operation: 'syncCalendarFromNetwalk:update',
          modelId: localModelId,
          mediaslideId: netwalkId,
          message: updErr.message,
          details: { event: ev, error: updErr },
        });
        continue;
      }
    } else {
      const { error: insErr } = await supabase.from('calendar_entries').insert(payload);
      if (insErr) {
        await logNetwalkError({
          operation: 'syncCalendarFromNetwalk:insert',
          modelId: localModelId,
          mediaslideId: netwalkId,
          message: insErr.message,
          details: { event: ev, error: insErr },
        });
        continue;
      }
    }
    upserted += 1;
  }

  for (const [extId, row] of existingByExtId) {
    if (remoteIds.has(extId)) continue;
    if (row.status === 'cancelled') continue;
    const { error: cancelErr } = await supabase
      .from('calendar_entries')
      .update({ status: 'cancelled', external_updated_at: new Date().toISOString() })
      .eq('id', row.id);
    if (cancelErr) {
      await logNetwalkError({
        operation: 'syncCalendarFromNetwalk:cancel',
        modelId: localModelId,
        mediaslideId: netwalkId,
        message: cancelErr.message,
        details: { rowId: row.id, error: cancelErr },
      });
      continue;
    }
    cancelled += 1;
  }

  return { ok: true, upserted, cancelled };
}

// Touch-stub to keep getPortfolioFromNetwalk in the import graph for downstream
// services that may want raw portfolio reads outside the sync flow.
export { getPortfolioFromNetwalk };

// ---------------------------------------------------------------------------
// Webhook entry point
// ---------------------------------------------------------------------------

export async function handleNetwalkWebhook(payload: {
  localModelId: string;
  netwalkId: string;
  apiKey?: string;
  /** When true, also pull calendar block-outs after the profile sync. */
  syncCalendar?: boolean;
}): Promise<{ ok: boolean }> {
  const result = await syncSingleModelFromNetwalk(payload);
  if (!result.ok) {
    await logNetwalkError({
      operation: 'handleNetwalkWebhook',
      modelId: payload.localModelId,
      mediaslideId: payload.netwalkId,
      message: 'Webhook sync failed',
    });
  }
  if (payload.syncCalendar) {
    try {
      await syncCalendarFromNetwalk({
        localModelId: payload.localModelId,
        netwalkId: payload.netwalkId,
        apiKey: payload.apiKey,
      });
    } catch (e) {
      await logNetwalkError({
        operation: 'handleNetwalkWebhook:calendar',
        modelId: payload.localModelId,
        mediaslideId: payload.netwalkId,
        message: 'Calendar sync failed in webhook',
        details: e,
      });
    }
  }
  return { ok: result.ok };
}

// ---------------------------------------------------------------------------
// Cron entry point
// ---------------------------------------------------------------------------

export async function runNetwalkCronSync(apiKey?: string): Promise<void> {
  let allRows: { id: string; netwalk_model_id: string }[];

  try {
    allRows = (
      await fetchAllSupabasePages(async (from, to) => {
        const { data, error } = await supabase
          .from('models')
          .select('id, netwalk_model_id')
          .not('netwalk_model_id', 'is', null)
          .range(from, to);
        return {
          data: data as { id: string; netwalk_model_id: string }[] | null,
          error,
        };
      })
    ).filter((r) => Boolean(r.netwalk_model_id));
  } catch (e: any) {
    await logNetwalkError({
      operation: 'runNetwalkCronSync',
      message: 'Failed to load models with netwalk_model_id',
      details: e,
    });
    return;
  }

  if (allRows.length === 0) return;

  const tasks = allRows.map((row) => async () => {
    try {
      await syncModelData(row.netwalk_model_id, apiKey);
      await syncSingleModelFromNetwalk({
        localModelId: row.id,
        netwalkId: row.netwalk_model_id,
        apiKey,
      });
      // Pull calendar block-outs (idempotent; canonical option_request rows win).
      await syncCalendarFromNetwalk({
        localModelId: row.id,
        netwalkId: row.netwalk_model_id,
        apiKey,
      });
    } catch (e: any) {
      await logNetwalkError({
        operation: 'runNetwalkCronSync:task',
        modelId: row.id,
        mediaslideId: row.netwalk_model_id,
        message: e?.message || 'Error while cron-syncing single model from Netwalk',
        details: e,
      });
    }
  });

  await runWithConcurrency(tasks, 5);
}
