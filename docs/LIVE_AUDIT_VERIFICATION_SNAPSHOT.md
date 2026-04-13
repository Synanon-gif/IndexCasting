# Live-DB Verification Snapshot (audit follow-up)

Generated as implementation of the deep-audit verification todos. **Not** a product doc for end users.

## 1. `fn_validate_option_status_transition` vs `modelRejectOptionRequest`

**Method:** Supabase Management API `database/query` — `pg_get_functiondef` + `pg_trigger` on `option_requests`.

**Live definition (abridged):** The function raises when:

- `OLD.final_status = 'option_confirmed' AND NEW.final_status = 'option_pending'`

**Trigger:** `trg_validate_option_status` — `BEFORE UPDATE OF status, final_status` on `public.option_requests`.

**Implication:** [`modelRejectOptionRequest`](src/services/optionRequestsSupabase.ts) performs an `UPDATE` setting `final_status: 'option_pending'` while the row can have `final_status = 'option_confirmed'` (guarded by `.eq('final_status', 'option_confirmed')`). That transition is **explicitly rejected** by the live validator.

**`tr_reset_final_status_on_rejection`:** Runs `BEFORE UPDATE OF status` and only mutates `NEW.final_status` when `NEW.final_status = 'option_confirmed'`. The client path sends `option_pending` already, so this trigger does **not** fire its reset branch before validation — it does not resolve the conflict.

**Conclusion:** Live DB state is **incompatible** with the current TypeScript `modelRejectOptionRequest` update shape for the “agency confirmed availability, model rejects” scenario. **QA / product confirmation required** (this verification does not change code).

---

## 2. Duplicate `calendar_entries` per `option_request_id`

**Query:**

```sql
SELECT option_request_id, COUNT(*) AS n,
  COUNT(*) FILTER (WHERE status IS DISTINCT FROM 'cancelled') AS n_active
FROM calendar_entries
WHERE option_request_id IS NOT NULL
GROUP BY option_request_id
HAVING COUNT(*) > 1
ORDER BY n_active DESC NULLS LAST
LIMIT 25;
```

**Result (production):** **No rows** — no `option_request_id` currently has more than one `calendar_entries` row in the sampled result set.

**Note:** The [`appendSharedBookingNote`](src/services/calendarSupabase.ts) multi-row append behavior remains a **latent** integrity risk if duplicates ever appear.

---

## 3. `clientConfirmJobStore` — notification path vs follow-up read

**Code trace:** [`clientConfirmJobStore`](src/store/optionRequests.ts) calls `getOptionRequestById` twice after a successful `clientConfirmJobOnSupabase` (refresh ~846–848, notifications ~868).

**[`getOptionRequestById`](src/services/optionRequestsSupabase.ts):** On PostgREST `error`, logs `getOptionRequestById error:` and returns `null`. On success with no row, `maybeSingle()` yields `null` **without** a guaranteed console line.

**Notification block:** Runs only when `if (full)` from the second `getOptionRequestById`. If `full` is `null` (RLS empty read, or error logged earlier), **no** `console.error` is emitted inside `clientConfirmJobStore` for the skipped notifications — only the generic error from `getOptionRequestById` when `error` is set.

**Conclusion:** **Silent skip** of org/model notifications is possible when the follow-up select returns `null` without error; operational gap between persisted job confirmation and notification delivery remains **observationally valid** from code inspection.

---

## Commands used (reference)

- Project ref: `ispkfdqzjrfrilosoklu` (from workspace rules).
- Token: `.env.supabase` — do not commit.

---

## 4. Deep-audit — Foto-Sichtbarkeit, Upload/Download, Guest-Packages (2026-04-13)

### 4.1 Guest-Link-Pakete (`get_guest_link_models`)

**Issue (behoben):** Portfolio-Pakete nutzten nur `models.portfolio_images`. Discovery (`get_discovery_models`, `20260523`) und Polaroid-Guest (`20260532`) fielen bei leerem Spiegel auf `model_photos` zurück — Guest-Portfolio nicht, → mögliche leere Pakete trotz sichtbarer Portfolio-Zeilen in `model_photos`.

**Fix:** Migration [`20260714_get_guest_link_models_portfolio_model_photos_fallback.sql`](../supabase/migrations/20260714_get_guest_link_models_portfolio_model_photos_fallback.sql) — gleiche `array_agg`-Logik wie Discovery für `photo_type = 'portfolio'` + `is_visible_to_clients`. Deploy: Management-API push, Verify `get_guest_link_models` vorhanden.

**Client:** [`getGuestLinkModels`](../src/services/guestLinksSupabase.ts) — `signImageUrls` + `normalizeDocumentspicturesModelImageRef` pro Model; [`GuestView`](../src/views/GuestView.tsx) nutzt nach Signierung HTTPS-URLs in `<Image>` (OK). [`getPackageDisplayImages`](../src/utils/packageDisplayMedia.ts) trennt Portfolio/Polaroid strikt.

### 4.2 Client / Agency UI (Normalisierung + `StorageImage`)

Verifiziert per Code-Review: [`ClientWebApp.tsx`](../src/web/ClientWebApp.tsx), [`CustomerSwipeScreen`](../src/screens/CustomerSwipeScreen.tsx), [`mapSupabaseModelToClientProjectSummary`](../src/utils/clientProjectHydration.ts), [`AgencyControllerView`](../src/views/AgencyControllerView.tsx) — `normalizeDocumentspicturesModelImageRef` wo nötig; Karten/Detail über `StorageImage` wo private Bucket-URIs vorkommen.

### 4.3 Storage / RLS / Docs

- **Lesen `documentspictures`:** `public.can_view_model_photo_storage(p_object_name)` — siehe [`20260501_can_view_model_photo_storage_client_row_alignment.sql`](../supabase/migrations/20260501_can_view_model_photo_storage_client_row_alignment.sql); Produktregel [`docs/CLIENT_MODEL_PHOTO_VISIBILITY.md`](./CLIENT_MODEL_PHOTO_VISIBILITY.md).
- **`model_photos`:** Zeilen-Sichtbarkeit für Clients gekoppelt an Storage für dieselben Pfade; keine Änderung in diesem Audit nötig.

### 4.4 Weitere Buckets (Kurz-Matrix)

| Bereich | Bucket / Pfad | Upload-Service | Anzeige / Download |
|--------|----------------|----------------|---------------------|
| Bewerbung | `application-images` (o.ä. in Service-Konstante) | [`applicationsSupabase.uploadApplicationImage`](../src/services/applicationsSupabase.ts) | `resolveApplicationImageUrl` |
| B2B-Chat / Anhänge | `chat-files` | [`messengerSupabase.uploadChatFile`](../src/services/messengerSupabase.ts), Recruiting/Option parallel | Signed-URL-Helper in jeweiligen Views |
| Dokumente / Verifizierung | `documents` | [`documentsSupabase`](../src/services/documentsSupabase.ts), [`verificationSupabase`](../src/services/verificationSupabase.ts) | Private bucket → sign |
| Org-Galerie / Logo | Org-Gallery-Bucket / Logo-Bucket | [`organizationGallerySupabase`](../src/services/organizationGallerySupabase.ts), [`organizationLogoSupabase`](../src/services/organizationLogoSupabase.ts) | Public URL oder project pattern |

### 4.5 Manuelle QA-Matrix (Checkliste)

| Rolle | Szenario | Erwartung |
|-------|-----------|-----------|
| Guest (anon) | Portfolio-Link, Modell mit nur `model_photos`-Portfolio | Bilder sichtbar nach Fix 20260714 |
| Guest (anon) | Polaroid-Link, leerer `models.polaroids` | Wie bisher: Fallback aus `model_photos` |
| Client | Discover / Projekt / Package-Mode | `StorageImage` + kanonische City |
| Agency | Upload Portfolio/Polaroid/Privat | [`modelPhotosSupabase`](../src/services/modelPhotosSupabase.ts), Rechte-Confirm |
| Model | Self-Media | Gleiche Pipeline wie Agency-Policy erlaubt |

Regression-Tests: `src/utils/__tests__/normalizeModelPortfolioUrl.test.ts`, `src/services/__tests__/modelMedia.test.ts` nach Änderungen an URI-Logik ausführen.
