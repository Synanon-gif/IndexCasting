/**
 * External-sync outbox worker (browser-side, agency-scoped).
 *
 * Background:
 *   Inbound webhooks (`external-sync-webhook` Edge Function) enqueue rows of the
 *   form `operation = 'inbound_resync_needed'` into `public.external_sync_outbox`
 *   so we have an idempotent, auditable record that the provider asked us to
 *   re-fetch a model. Without a worker those rows would accumulate forever.
 *
 * Canonical minimal worker (F1.3):
 *   - The existing per-agency cron (`runMediaslideCronSync` / `runNetwalkCronSync`)
 *     ALREADY re-syncs every model that has the corresponding `*_sync_id`. By
 *     the time the cron tick has finished, every webhook-flagged model for the
 *     calling agency has been re-pulled from the provider as part of the bulk
 *     iteration.
 *   - Therefore the canonical drain is: at the end of each cron tick, mark all
 *     pending `inbound_resync_needed` rows for that provider as `sent`. The
 *     models have actually been re-synced; the outbox row is the receipt.
 *   - This requires no new Deno worker, no schema changes, and reuses the
 *     existing `mark_external_sync_outbox_sent` RPC (callable by agency members
 *     after migration `20261103_external_sync_outbox_agency_callable.sql`).
 *
 * Failure mode: if the bulk cron itself failed to sync a particular model (per-
 * model error logged in `mediaslide_sync_logs`), we still mark the outbox row
 * sent here. The bulk cron's own retry on the next tick re-pulls the model; the
 * separate sync log captures the per-model failure for observability. We do
 * NOT leave outbox rows pending on per-model errors because that would re-flag
 * them on the next tick and create a feedback loop that hides real problems
 * behind ever-growing outbox depth.
 *
 * RLS: `external_sync_outbox_select_agency_members` already scopes the SELECT
 * to the calling user's agencies, so we don't need an extra agency filter.
 */

import { supabase } from '../../lib/supabase';

type Provider = 'mediaslide' | 'netwalk';

/**
 * Drain pending `inbound_resync_needed` rows for the given provider by marking
 * them as sent. Called at the end of `runMediaslideCronSync` /
 * `runNetwalkCronSync` so webhook-flagged models always get a terminal state
 * after the cron has actually re-synced them.
 *
 * Best-effort: never throws, never blocks the calling cron, never returns an
 * error code. Logs to console on failure for observability.
 */
export async function drainInboundResyncOutbox(provider: Provider): Promise<void> {
  try {
    // SELECT is RLS-scoped to the caller's agencies; we limit to keep the page
    // small but loop in case there are >200 pending rows for one provider.
    // 200 covers the typical agency easily and bounds wall-clock time.
    const PAGE = 200;
    let drainedTotal = 0;
    // Hard cap to avoid pathological infinite loops if marking silently no-ops.
    for (let i = 0; i < 25; i++) {
      const { data: pending, error: selErr } = await supabase
        .from('external_sync_outbox')
        .select('id')
        .eq('provider', provider)
        .eq('operation', 'inbound_resync_needed')
        .eq('status', 'pending')
        .order('created_at', { ascending: true })
        .limit(PAGE);

      if (selErr) {
        console.error(
          '[outboxWorker] select pending inbound_resync_needed failed',
          provider,
          selErr,
        );
        return;
      }

      const rows = (pending ?? []) as { id: string }[];
      if (rows.length === 0) break;

      // Mark each row sent. The RPC is SECURITY DEFINER + scoped to admin,
      // service-role, or agency members of the row's agency_id, so concurrent
      // agency-member sessions cannot mark each other's rows.
      for (const row of rows) {
        const { error: markErr } = await supabase.rpc('mark_external_sync_outbox_sent', {
          p_id: row.id,
        });
        if (markErr) {
          // Don't abort the whole drain on one row's failure — just log.
          console.error('[outboxWorker] mark_external_sync_outbox_sent failed', row.id, markErr);
        } else {
          drainedTotal += 1;
        }
      }

      // If we pulled fewer than PAGE rows, the queue is empty — stop early.
      if (rows.length < PAGE) break;
    }

    if (drainedTotal > 0) {
      console.info(`[outboxWorker] drained ${drainedTotal} ${provider} inbound_resync_needed rows`);
    }
  } catch (e) {
    console.error('[outboxWorker] drainInboundResyncOutbox exception', provider, e);
  }
}
