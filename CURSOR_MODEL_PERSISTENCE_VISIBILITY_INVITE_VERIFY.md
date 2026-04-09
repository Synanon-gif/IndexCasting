# Verify checklist — model persistence / visibility / invite

## Automated (run locally)

- [x] `npm run typecheck` — green
- [x] `npm run lint` — green
- [x] `npm test -- --passWithNoTests --ci` — green

## Manual — Agency

- [ ] Add model with portfolio files + rights checkbox → save → roster shows thumbnail after opening media panel once (reconcile) or refresh
- [ ] Completeness banner: no false “no visible portfolio” when client-visible portfolio rows exist
- [ ] Toggle client visibility on a portfolio photo → completeness updates without switching models incorrectly
- [ ] Save model with city + country → reload → city/current location consistent; without country, confirm city still on profile but map hint matches behaviour
- [ ] Add model with email → if email fails, feedback includes **reason** and **claim URL** when token generated

## Manual — Client web

- [ ] Model detail → portfolio images load (no `ERR_UNKNOWN_URL_SCHEME`)
- [ ] Measurements show **Chest**, not “Bust” as label
- [ ] Standard discovery: portfolio only; packages: polaroids only when agency package type is polaroid

## Manual — Ops

- [ ] Supabase secret `RESEND_API_KEY` set for production `send-invite`
- [ ] Multi-org agency user: `inviteOrganizationId` passed (existing prop) — confirm invite not 403 `not_member_of_organization`
