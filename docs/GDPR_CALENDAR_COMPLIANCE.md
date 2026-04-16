# GDPR / DSGVO — Calendar (ICS + subscription feed)

**Not legal advice.** Technical–process notes for privacy officers and engineering. Final legal basis, retention, and Art. 6 / 9 assessments belong with the controller / DPO.

## Art. 15 — Access / portability (product channels)

| Channel | Scope |
|--------|--------|
| **`export_user_data` (v4, JSON)** | Portable structured export: includes `calendar_events` (from `user_calendar_events`), `calendar_entries`, **`booking_events`**, and other subject-scoped tables. See [GDPR_EXPORT_TABLE_MAP.md](./GDPR_EXPORT_TABLE_MAP.md). |
| **`.ics` download + webcal/HTTPS feed** | Same merged payload as `calendar_export_events_json`: **`user_calendar_events` ∪ `calendar_entries`** only. **`booking_events` are not included** in ICS/feed. |

Users should understand that **ICS and the subscription link are a convenience sync of that merged subset**, not a replacement for the full JSON export. In-app copy: `uiCopy.privacyData.calendarSyncVsFullExportNotice`.

Full interop and security audit: [CALENDAR_INTEROP_AUDIT_REPORT.md](./CALENDAR_INTEROP_AUDIT_REPORT.md).

## Art. 5 — Minimization (high level)

- Feed access requires session or a **secret** URL; only a **hash** of the token is stored (`calendar_feed_token_hash` cleared in `anonymize_user_data`).
- ICS `DESCRIPTION` may include fields such as `client_name` / notes — purpose limitation and training are organizational controls; see DPO checklist below.

## Art. 17 — Erasure / anonymization vs calendar rows

**Current product behaviour (repo / migrations, not a legal conclusion):**

- `anonymize_user_data` clears **`calendar_feed_token_hash`** (subscription links stop working server-side).
- **`user_calendar_events` and `calendar_entries` are not bulk-deleted** by `anonymize_user_data` in the migrations reviewed for this note.
- **`user_calendar_events.created_by`** references `auth.users(id)` **`ON DELETE SET NULL`** (`migration_organizations_invitations_rls.sql`). Hard auth-user delete therefore **nulls** `created_by` but **does not remove** the calendar row.
- **`owner_id`** on `user_calendar_events` is used polymorphically (`owner_type` = e.g. client / agency / model context). There is **no single FK** in the reviewed migrations from `owner_id` to `auth.users`; residual rows may retain **UUIDs and text** (title, note, etc.) after profile/auth deletion depending on cascade paths elsewhere.

**Risk (technical):** If the legal position requires **complete** removal of personal calendar content on erasure, additional **DELETE or field redaction** steps may be needed — balanced against **B2B / booking retention** and trigger chains. **Do not extend `anonymize_user_data` with calendar `DELETE` without DPO + product sign-off.**

## Art. 32 — Security (summary)

- Token: SHA-256 of UTF-8 secret; plaintext only at rotate time.
- `get_calendar_feed_payload`: intended **`service_role`** only; Edge Function calls with service key.
- Generic errors on invalid tokens where applicable (see calendar interop audit).

## DPO / controller checklist (alignment)

Use this list to record decisions (retention vs Art. 17, B2B contracts):

1. After **`anonymize_user_data`**, may **`user_calendar_events`** rows (title, note, `owner_id`, org linkage) **remain** for operational or statutory retention? If **no**, approve a targeted SQL follow-up (see appendix).
2. After **hard `delete-user`**, are **orphan calendar rows** with **no living auth user** acceptable under your policy? If **no**, approve cleanup or cascade design.
3. Is the **ICS/feed subset** adequately explained in the **privacy policy** and in-product (`calendarSyncVsFullExportNotice` + JSON export)?
4. Does **cache behaviour** of third-party calendar clients (delay after revoke) need a **short user-facing note** (transparency only)?

## Live DB verification (operators)

After deploy or when auditing drift, run on the **live** database:

```sql
-- Latest export function body (confirm v4 / expected keys)
SELECT pg_get_functiondef(p.oid)
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'export_user_data' AND p.prokind = 'f';

-- Constraints on user_calendar_events (created_by cascade, any owner FK)
SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'public.user_calendar_events'::regclass
ORDER BY conname;
```

**Repo expectation (2026-08):** `export_user_data` defined in `supabase/migrations/20260824_gdpr_export_v4_minimization_anonymize_model.sql`; `created_by` → `auth.users` **ON DELETE SET NULL** per `migration_organizations_invitations_rls.sql`.

### Live verification log (project `ispkfdqzjrfrilosoklu`, 2026-04-16)

| Check | Result |
|--------|--------|
| `export_user_data` body contains `booking_events` | **yes** |
| `export_user_data` body contains `gdpr_export_actor_ref` (v4 minimization) | **yes** |
| `user_calendar_events` FKs | `created_by` → `auth.users` **ON DELETE SET NULL**; `organization_id` → `organizations` **ON DELETE SET NULL**; `source_option_request_id` → `option_requests` **ON DELETE SET NULL**; **no** FK on `owner_id` (polymorphic UUID) |

## Appendix — Optional `anonymize_user_data` extensions (DSB + product only)

**Not deployed here.** Example directions for a future migration after sign-off:

- **Option A:** `DELETE FROM user_calendar_events WHERE owner_id = p_user_id AND owner_type = 'client'` (and analogous rows for other owner types if they map 1:1 to the data subject).
- **Option B:** Redact PII columns (`title`, `note`, …) where `created_by = p_user_id` or `owner_id` matches subject, **without** deleting rows needed for `option_requests` / audit retention.
- **Option C:** Tie calendar cleanup to existing **`delete_option_request_full`** / booking lifecycle so erasure does not break triggers.

Each option must be reviewed against **B2B retention** and **calendar trigger chains**.

## Related

- [GDPR_EXPORT_CALENDAR_QA.md](./GDPR_EXPORT_CALENDAR_QA.md)
- [GDPR_EXPORT_TABLE_MAP.md](./GDPR_EXPORT_TABLE_MAP.md)
