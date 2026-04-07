# Mediaslide & Netwalk sync — engineering notes

## What the code does today

- **Connectors:** [`src/services/mediaslideConnector.js`](src/services/mediaslideConnector.js) and [`src/services/netwalkConnector.js`](src/services/netwalkConnector.js) call external HTTP APIs when `EXPO_PUBLIC_MEDIASLIDE_API_URL` / the Netwalk equivalent is set; otherwise they run in **mock mode** (local DB reads only for Mediaslide mock).
- **Sync services:** [`src/services/mediaslideSyncService.ts`](src/services/mediaslideSyncService.ts) and [`src/services/netwalkSyncService.ts`](src/services/netwalkSyncService.ts) map remote **measurements and profile fields** into `public.models`, then persist external IDs via the SECURITY DEFINER RPC **`update_model_sync_ids`** (columns `mediaslide_sync_id`, `netwalk_model_id` are revoked for direct client `UPDATE`).
- **Territories:** After a successful model update, sync may call territory RPCs so `model_agency_territories` stays aligned with the integration.

## Images / portfolio — no automatic mirror into Supabase Storage

- Sync updates **`models.portfolio_images`** and **`models.polaroids`** (and related visibility flags) from whatever the remote API returns — typically **URLs pointing at Mediaslide/Netwalk or CDN**, not files uploaded to our `documentspictures` bucket.
- **First-party portfolio uploads** (agency/model UI) use [`src/services/modelPhotosSupabase.ts`](src/services/modelPhotosSupabase.ts) and store objects in **`documentspictures`** with `model_photos` rows.
- Therefore: **integrations do not, by themselves, eliminate “double maintenance”** if product requires all pixels to live in our bucket. That would need an explicit **import/mirror** job (fetch URL → `uploadModelPhoto` / internal pipeline) with consent, rate limits, and deduplication — out of scope of the current connector layer.

## Operational checklist

1. **API base URL + keys** configured for production; mock mode is dev-only.
2. **Cron / webhook** (`runMediaslideCronSync`, `runNetwalkCronSync`, webhooks) must match expected load; failures go to `mediaslide_sync_logs`.
3. **DB guards:** `update_model_sync_ids` requires caller in agency via `organization_members` + `organizations.type = 'agency'` or legacy `bookers` (see migration `20260407_fix_update_model_sync_ids_no_owner_user_id.sql`).

## Related rules

- Upload consent matrix: [.cursor/rules/upload-consent-matrix.mdc](../.cursor/rules/upload-consent-matrix.mdc).
- Model creation entry points: [`src/services/modelCreationFacade.ts`](../src/services/modelCreationFacade.ts).
