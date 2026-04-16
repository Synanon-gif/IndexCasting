# Location canonical hardening — manual QA (2026)

Use after deploy of migration `20260825_get_models_by_location_effective_city_filter.sql` and app build with roster Near Me + discovery pagination fixes.

## Model account

- [ ] GPS on: approximate location shared; roster / discovery Near Me shows nearby models when coords exist.
- [ ] GPS off or share denied: no coords in `model_locations` for live; Near Me excludes model (expected).
- [ ] Manual current city set and geocoded; display city follows priority (live > current > agency > `models.city`).
- [ ] Clear manual current: falls back to agency row or profile city as documented.
- [ ] Agency-only fallback city: visible when model has no higher-priority city.

## Client Web

- [ ] Country + city filter: first page and **load more** (scroll) keep the same city filter (no page-2 drift).
- [ ] `p_client_city` boost: home-city models still rank reasonably on page 2+.
- [ ] Near Me: allow geolocation → list filters by radius; deny → graceful fallback / message.
- [ ] When Near Me + country filter active, UI shows `nearbyOverridesCountry` (or equivalent) if applicable.

## Agency — My Models

- [ ] Filters: country, city substring match **effective** display city (not stale `models.city` alone).
- [ ] Near Me with consent: user position resolved; models with shared approx coords inside radius appear; city-only models excluded from radius path unless product fallback applies.
- [ ] Package builder (Guest links): same filter behavior as roster when Near Me / city used.

## Guest link + package

- [ ] City line on cards matches discovery semantics (`effective_city` / canonical display).
- [ ] Shared selection view: city line consistent with guest/package RPC data.

## Legacy hybrid RPC

- [ ] Flows still calling `get_models_by_location` with `p_city`: only models whose **winning** location city matches substring appear (no match via a lower-priority `model_locations` row alone).

## Reload / session

- [ ] Hard reload: filters and discovery cursor state remain consistent (no empty second page from wrong RPC args).
- [ ] Second browser / incognito: guest paths unchanged; auth paths require login as expected.
