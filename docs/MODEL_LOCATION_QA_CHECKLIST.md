# Model location QA checklist (manual)

Canonical priority: **live (GPS)** > **current (manual city)** > **agency** fallback > `models.city` where RPCs use `COALESCE(effective_city, m.city)`.

## Model with account

1. Turn on GPS / share location: `model_locations` row `source=live` updates; discovery and Near Me prefer it over agency row.
2. Turn off GPS and set manual current city (geocoded): `source=current` wins over agency when live is absent.
3. Remove live/current rows: agency fallback city appears in roster/discovery when only `source=agency` exists.

## Model without account

4. Agency sets city + optional geocode on agency profile: Near Me and filters use agency row; model has no live/current rows.

## Client

5. Client discovery: hard city filter matches `effective_city` (substring); boost uses client city vs `effective_city`.
6. Near Me: radius uses highest-priority row with `share_approximate_location` and lat/lng.

## Agency roster / packages

7. My Models and Guest package picker: city filter and subtitles align with batched effective city (live > current > agency).

## Regression / security

8. Model cannot PATCH `models` directly for revoked columns; `model_update_own_profile_safe` only touches `city`, `country`, `current_location`.
9. Agency still edits roster via `agency_update_model_full` + `upsert_model_location` `source=agency`.

## RPC

10. `model_update_own_profile_safe` with `p_current_location` succeeds for agency-linked models (legacy mirror); failure on `upsert_model_location` still blocks success in GPS UI.
