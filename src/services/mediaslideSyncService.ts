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
import {
  getCalendarFromMediaslide,
  getModelFromMediaslide,
  getPortfolioFromMediaslide,
  syncModelData,
} from './mediaslideConnector';
import { fetchAllSupabasePages } from './supabaseFetchAll';
import { upsertTerritoriesForModelCountryAgencyPairs } from './territoriesSupabase';
import { drainInboundResyncOutbox } from './externalSyncOutboxWorker';

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
  /**
   * Optional portfolio mirror — only consumed when models.photo_source = 'mediaslide'.
   * URLs are stored as-is (no local storage mirror); UI renders them directly.
   */
  portfolio?: {
    images?: string[] | null;
    polaroids?: string[] | null;
  };
};

export type ExternalCalendarBlockoutRemote = {
  external_event_id: string;
  date: string;
  start_time?: string | null;
  end_time?: string | null;
  status: 'tentative' | 'booked' | 'unavailable';
  title?: string | null;
  updated_at?: string | null;
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

  // Photo-source branching: only mirror remote portfolio URLs when the agency
  // explicitly opted into 'mediaslide' as the source-of-truth for this model.
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

  if (photoSource === 'mediaslide' && remote.portfolio) {
    if (Array.isArray(remote.portfolio.images)) {
      (updates as any).portfolio_images = remote.portfolio.images;
    }
    if (Array.isArray(remote.portfolio.polaroids)) {
      (updates as any).polaroids = remote.portfolio.polaroids;
    }
  } else if (remote.portfolio && photoSource !== 'mediaslide') {
    // F1.6 — Defense-in-depth observability: remote sent portfolio data but
    // local `photo_source` is not 'mediaslide', so we MUST NOT mirror it
    // (system-invariants §27.1 / EXTERNE PROFIL-SYNCS). Log so operators can
    // detect misconfigured agencies that expect remote photos to flow.
    console.warn(
      '[mediaslideSync] skipping remote portfolio write — photo_source is',
      photoSource,
      'for model',
      local.id,
    );
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
    p_portfolio_images: u.portfolio_images ?? null,
    p_polaroids: u.polaroids ?? null,
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
    // Territory presence is checked against the canonical source of truth
    // `model_agency_territories` (system-invariants — TERRITORIES — AUTORITATIVE
    // TABELLE). `model_assignments.territory` is not the source of truth and
    // must not be relied on for representation/territory queries.
    const { data: terr } = await supabase
      .from('model_agency_territories')
      .select('country_code')
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
// Inbound calendar sync (Mediaslide → calendar_entries)
// ---------------------------------------------------------------------------

/**
 * Pull calendar block-outs for a model from Mediaslide and reconcile them with
 * `calendar_entries`.
 *
 * Conflict resolution invariants (system-invariants §G — Calendar as Projection):
 *   1. Rows with option_request_id IS NOT NULL are canonical and ALWAYS win —
 *      this function never inserts/updates an external row that overlaps a
 *      canonical lifecycle row on the same (model_id, date).
 *   2. External rows are visual-only block-outs (status = 'tentative'/'booked'/
 *      'unavailable'). They MUST stay outside the Smart-Attention pipeline
 *      (no option_request_id, no model_approval, no negotiation fields).
 *   3. Idempotency: matched on (external_source, external_event_id). Re-running
 *      the sync only updates rows whose remote `updated_at` is strictly newer.
 *   4. Removed-on-remote: external rows whose external_event_id is no longer
 *      in the remote payload are marked status='cancelled' (never deleted),
 *      so the audit trail / shared-note history survives.
 */
export async function syncCalendarFromMediaslide(args: {
  localModelId: string;
  mediaslideId: string;
  apiKey?: string;
}): Promise<{ ok: boolean; upserted: number; cancelled: number }> {
  const { localModelId, mediaslideId, apiKey } = args;

  let remote: ExternalCalendarBlockoutRemote[] = [];
  try {
    const raw = await getCalendarFromMediaslide(mediaslideId, apiKey);
    remote = (Array.isArray(raw) ? raw : []) as ExternalCalendarBlockoutRemote[];
  } catch (e: any) {
    await logMediaslideError({
      operation: 'getCalendarFromMediaslide',
      modelId: localModelId,
      mediaslideId,
      message: e?.message || 'Failed to fetch calendar from Mediaslide',
      details: e,
    });
    return { ok: false, upserted: 0, cancelled: 0 };
  }

  const remoteIds = new Set(
    remote.map((e) => e.external_event_id).filter((id): id is string => Boolean(id)),
  );

  // Existing external rows for this model (mediaslide-source only).
  const { data: existingRows, error: existingErr } = await supabase
    .from('calendar_entries')
    .select('id, external_event_id, external_updated_at, status, date')
    .eq('model_id', localModelId)
    .eq('external_source', 'mediaslide');

  if (existingErr) {
    await logMediaslideError({
      operation: 'syncCalendarFromMediaslide:loadExisting',
      modelId: localModelId,
      mediaslideId,
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

  // Canonical rows (option_request_id IS NOT NULL) for the same model — used
  // to skip remote rows that would overlap a canonical lifecycle entry.
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
      title: ev.title ?? 'Mediaslide block-out',
      external_source: 'mediaslide' as const,
      external_event_id: ev.external_event_id,
      external_updated_at: ev.updated_at ?? new Date().toISOString(),
    };

    if (existing) {
      // F1.5 — DB-level guard against TOCTOU race: between our SELECT above and
      // this UPDATE another concurrent sync (or webhook handler) might have
      // already written a NEWER `external_updated_at`. Filtering on
      // `external_updated_at IS NULL OR external_updated_at < new_ts` makes
      // the UPDATE a no-op in that case so we never overwrite a fresher row
      // with stale remote data. The in-memory `remoteIsNewer` check above is
      // kept as the cheap fast-path; this is the authoritative serialization.
      const newTs = payload.external_updated_at;
      let upd = supabase.from('calendar_entries').update(payload).eq('id', existing.id);
      if (newTs) {
        upd = upd.or(`external_updated_at.is.null,external_updated_at.lt.${newTs}`);
      }
      const { error: updErr } = await upd;
      if (updErr) {
        await logMediaslideError({
          operation: 'syncCalendarFromMediaslide:update',
          modelId: localModelId,
          mediaslideId,
          message: updErr.message,
          details: { event: ev, error: updErr },
        });
        continue;
      }
    } else {
      const { error: insErr } = await supabase.from('calendar_entries').insert(payload);
      if (insErr) {
        await logMediaslideError({
          operation: 'syncCalendarFromMediaslide:insert',
          modelId: localModelId,
          mediaslideId,
          message: insErr.message,
          details: { event: ev, error: insErr },
        });
        continue;
      }
    }
    upserted += 1;
  }

  // Remote-removed: cancel local external rows that are no longer in the payload.
  for (const [extId, row] of existingByExtId) {
    if (remoteIds.has(extId)) continue;
    if (row.status === 'cancelled') continue;
    const { error: cancelErr } = await supabase
      .from('calendar_entries')
      .update({ status: 'cancelled', external_updated_at: new Date().toISOString() })
      .eq('id', row.id);
    if (cancelErr) {
      await logMediaslideError({
        operation: 'syncCalendarFromMediaslide:cancel',
        modelId: localModelId,
        mediaslideId,
        message: cancelErr.message,
        details: { rowId: row.id, error: cancelErr },
      });
      continue;
    }
    cancelled += 1;
  }

  return { ok: true, upserted, cancelled };
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
  /** When true, also pull calendar block-outs after the profile sync. */
  syncCalendar?: boolean;
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
  if (payload.syncCalendar) {
    try {
      await syncCalendarFromMediaslide({
        localModelId: payload.localModelId,
        mediaslideId: payload.mediaslideId,
        apiKey: payload.apiKey,
      });
    } catch (e) {
      await logMediaslideError({
        operation: 'handleMediaslideWebhook:calendar',
        modelId: payload.localModelId,
        mediaslideId: payload.mediaslideId,
        message: 'Calendar sync failed in webhook',
        details: e,
      });
    }
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
      // Pull calendar block-outs (idempotent; only updates rows whose remote
      // updated_at is strictly newer; never touches canonical option_request rows).
      await syncCalendarFromMediaslide({
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

  // F1.3 — drain inbound webhook receipts. The bulk loop above re-pulled every
  // model with `mediaslide_sync_id`, which by definition includes any model the
  // provider asked us to refresh via webhook. Marking the outbox rows `sent`
  // here closes the loop so the queue does not grow unbounded.
  await drainInboundResyncOutbox('mediaslide');
}
