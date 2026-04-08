# Security Audit E — Manual Verification Checklist

Use after deploy or when validating this hardening pass.

## Query / token bounds (Web)

- [ ] Open `/?invite=` with a token longer than 16384 characters → token should **not** be persisted; no crash.
- [ ] Open `/?model_invite=` with oversized token → same behavior.
- [ ] Existing valid invite/claim URL still loads preview and finalizes (regression).

## Shared selection

- [ ] `/?shared=1&name=` + very long name → title capped (256 chars).
- [ ] `/?shared=1&ids=` + hundreds of comma-separated ids → list capped (500 entries, each id max 128 chars).

## Guest / booking query

- [ ] `/?guest=<uuid>` guest flow still resolves when id is normal length.
- [ ] `/?booking=<uuid>` booking thread link still opens when valid.

## Messenger

- [ ] Send normal chat message → succeeds.
- [ ] Send message with only `http://` (not https) link → rejected (existing behavior).
- [ ] Programmatic path with `metadata` object whose `JSON.stringify` length &gt; 65536 → insert rejected / `sendMessage` returns null (developer test or temporary harness only).

## Calendar shared notes

- [ ] Append shared booking note with `&lt;script&gt;` in text → stored sanitized; UI shows escaped/plain text, no script execution.

## Guest chat package link

- [ ] From Guest chat, “open package” with a valid `https://` guest link → opens.
- [ ] If metadata ever contained non-https URL, open should not proceed (manual injection test in dev only).

## Regression smoke

- [ ] `npm run typecheck` && `npm run lint` && `npm test -- --passWithNoTests --ci` — all green.
