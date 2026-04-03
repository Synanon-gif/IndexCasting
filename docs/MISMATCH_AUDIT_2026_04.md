# IndexCasting — Legal Document ↔ System Behavior Mismatch Audit
**Date:** April 2026 | **Method:** Full code scan + runtime path tracing  
**Auditor:** Automated code audit (no legal documents finalized yet — audit is against *intended* legal statements based on PROJECT_OVERVIEW_AGB_DSGVO.md and COMPLIANCE_AUDIT_REPORT_2026_04.md)

> **Important:** The platform's legal texts (AGB, Datenschutzerklärung, AVV) have **not yet been published**. This audit identifies every mismatch between **what those texts will need to promise** and **what the system actually does right now** — so the texts can be written to match reality, or the code can be fixed to match the intended promises.

---

## MISMATCH #1 — CRITICAL

**Document:** Privacy Policy (intended) / `uiCopy.legal.privacySuffix = "(GDPR compliant)"`  
**Legal statement intended:** "Users can request their personal data export at any time."  
**Actual behavior:** `exportUserData()` and `downloadUserDataExport()` were implemented in `src/services/gdprComplianceSupabase.ts` but there is **no UI anywhere** in the settings screens or profile views that exposes this function to the user. The right exists on the backend but is completely inaccessible to users.  
**Risk:** CRITICAL — GDPR Art. 20 data portability right is legally required and cannot be satisfied without accessible UI.  
**Fix:**
```
Add a "Download my data" button to the account settings screen (both Agency and Client).
Call downloadUserDataExport(userId) on press.
Document this in the Privacy Policy with a response time statement (max 30 days).
```

---

## MISMATCH #2 — CRITICAL

**Document:** Privacy Policy / Image Rights Policy (intended)  
**Legal statement intended:** "No photo is uploaded without prior confirmation of image rights."  
**Actual behavior:** `ModelMediaSettingsPanel.tsx` → `handleUploadFiles()` calls `uploadModelPhoto()` directly. **`confirmImageRights()` and `guardImageUpload()` are never called.** The image rights confirmation table and the guard function exist in the backend but no upload flow in the entire codebase calls them. This includes:
- `ModelMediaSettingsPanel.tsx` (portfolio, polaroid, private uploads)
- `AgencyControllerView.tsx` (model creation with photos)
- `applicationsSupabase.ts` (application image uploads)

The policy infrastructure is built; the enforcement is missing.  
**Risk:** CRITICAL — Uploading model images without auditable rights confirmation is an Urheberrecht / GDPR Art. 6(1)(a) violation. No legal defense in case of dispute.  
**Fix:**
```
Before every call to uploadModelPhoto() / uploadPrivateModelPhoto():
  1. Show checkbox: "I confirm I hold all required rights and consents for this image."
  2. On confirm: await confirmImageRights({ userId, modelId })
  3. Only then proceed with upload.
Wire to guardImageUpload() as the backend check.
```

---

## MISMATCH #3 — CRITICAL

**Document:** Privacy Policy (intended)  
**Legal statement intended:** "Legal pages are accessible at https://indexcasting.com/terms and https://indexcasting.com/privacy"  
**Actual behavior:** `uiCopy.legal.tosUrl = 'https://indexcasting.com/terms'` and `uiCopy.legal.privacyUrl = 'https://indexcasting.com/privacy'`. These URLs are shown in `LegalAcceptanceScreen.tsx` as clickable links that users must open before checking the acceptance box. **The pages do not exist yet** (pre-launch). Every new user is asked to "accept" a Terms of Service that returns a 404.  
**Risk:** CRITICAL — Consent obtained for a non-existent document has no legal validity. All existing consent records are legally defective.  
**Fix:**
```
Publish the legal texts BEFORE any user accepts them.
Options:
  A. Deploy static pages at indexcasting.com/terms and indexcasting.com/privacy FIRST.
  B. Temporarily disable signup (not practical).
  C. Embed the full text inline in LegalAcceptanceScreen as a scrollable view (stopgap).
```

---

## MISMATCH #4 — CRITICAL

**Document:** Privacy Policy (intended) — Consent records  
**Legal statement intended:** "We record the exact version of the legal document you accepted."  
**Actual behavior:** `acceptTerms()` in `AuthContext.tsx` inserts into `legal_acceptances` with `document_version: '1.0'` (hardcoded). However, `consent_log` (the table used by `consentSupabase.ts`) is a **separate table** and is never written to during consent acceptance. There are now **two separate consent tables** (`legal_acceptances` and `consent_log`) that are not synchronized:
- `legal_acceptances`: written by `acceptTerms()` ✅
- `consent_log`: written by `recordConsent()` — **never called during signup** ❌

The `hasActiveConsent()` / `withdrawConsent()` functions in `consentSupabase.ts` operate on `consent_log` only. This means withdrawal via `withdrawConsent()` would work on an **empty table** for most users — their real consent evidence is in `legal_acceptances`, not `consent_log`.  
**Risk:** CRITICAL — Consent withdrawal infrastructure is broken: withdrawing from `consent_log` is a no-op if the original consent was recorded in `legal_acceptances`. Privacy Policy cannot truthfully claim consent withdrawal is functional.  
**Fix:**
```
Option A (recommended): Make acceptTerms() also call recordConsent() for both 'terms' and 'privacy'.
  In AuthContext.tsx acceptTerms():
    await recordConsent(userId, 'terms', '1.0');
    await recordConsent(userId, 'privacy', '1.0');
    if (agencyRights) await recordConsent(userId, 'image_rights', '1.0');

Option B: Migrate to use consent_log as the single source of truth.
  Remove legal_acceptances inserts; update hasAcceptedVersion() queries to consent_log only.
```

---

## MISMATCH #5 — CRITICAL

**Document:** Privacy Policy (intended) — Consent records  
**Legal statement intended:** "We record the IP address at the time of consent acceptance as proof."  
**Actual behavior:** `acceptTerms()` in `AuthContext.tsx` does not capture IP address. `legal_acceptances` table insert has no `ip_address` column. The `consent_log` schema does have `ip_address` but since it's never written (see #4), it's moot. IP address at consent time is a standard GDPR proof-of-consent element.  
**Risk:** CRITICAL — In a consent dispute, inability to prove "when, where, from which device" the consent was given weakens the legal position significantly.  
**Fix:**
```
On web: capture IP via a lightweight server-side check or accept that IP is unavailable client-side.
On mobile: accept that IP is typically not available; document this limitation.
At minimum: record the timestamp + version + user_id (already done in legal_acceptances).
Add document_version to be updated when legal texts change — and notify users to re-accept.
Document in Privacy Policy: "We record the timestamp and document version at acceptance time."
Do NOT promise IP if it cannot be reliably captured.
```

---

## MISMATCH #6 — HIGH

**Document:** Privacy Policy (intended) — Cookie/LocalStorage disclosure  
**Legal statement intended:** (likely) "We use only technically necessary storage."  
**Actual behavior:** The app uses `localStorage` for:
1. **Supabase session token** (`sb-<project>-auth-token`) — technically necessary ✅
2. **Client projects** (model IDs, names, measurements) — functional data ⚠️
3. **Client filters** (height ranges, ethnicity, location, category) — user preference data ⚠️
4. **Agency projects, active project ID** — functional data ⚠️
5. **Client type preference** ('fashion'/'commercial') — user preference ⚠️

Items 2–5 are stored in `localStorage` without any consent banner and without GDPR justification. On mobile (native), equivalent data may live in `AsyncStorage`.  
**Risk:** HIGH — If the Privacy Policy says "we only use technically necessary cookies/storage", this is inaccurate. In Germany, even technically necessary localStorage usage must be disclosed.  
**Fix:**
```
Option A: Add all localStorage keys to Privacy Policy under "Technically necessary local storage".
  Justify each as: session = auth; projects/filters = contractual feature state (Art. 6(1)(b)).
  No consent banner needed for technically necessary storage — but MUST be documented.

Option B: Move non-session data to server-side (Supabase DB) and remove from localStorage.
  This is the cleaner GDPR approach but requires more dev work.
```

---

## MISMATCH #7 — HIGH

**Document:** AGB / Privacy Policy — Minors policy  
**Legal statement intended:** "Special protections apply for minors; guardian consent is required before any data is published."  
**Actual behavior:** `model_minor_consent` table and `is_minor` column on `models` were created. DB trigger `trg_guard_minor_visibility` prevents publishing a minor without consent. **However:**
- There is **no UI** to flag a model as `is_minor = true`
- There is **no UI** for the agency to enter guardian name/email or confirm consent
- There is **no UI** for the "guardian confirmation" workflow
- The DB trigger works, but a model could be created as `is_minor = false` (the default) even if they are actually a minor — the flag is opt-in only, no age verification

In practice: the minors protection is entirely optional and bypassable by simply not setting the flag.  
**Risk:** HIGH — If the Privacy Policy promises minors protection, the system cannot enforce it because there's no age gate and the flag is not mandatory.  
**Fix:**
```
Short-term (document-matching):
  In Privacy Policy: "Agencies are contractually obligated to flag minors and obtain guardian consent 
  before uploading data. Age verification is not automated."
  In AGB: "Agency is solely responsible for ensuring guardian consent for any minor model."
  
Long-term (system-matching):
  Add is_minor checkbox in model creation form (AgencyControllerView.tsx).
  If checked: require guardian name + email before model can be created.
  Wire confirmMinorConsentByAgency() to agency confirmation UI.
```

---

## MISMATCH #8 — HIGH

**Document:** Privacy Policy (intended) — Consent withdrawal  
**Legal statement intended:** "You can withdraw consent at any time. Withdrawal stops dependent processing."  
**Actual behavior:** `withdrawConsent()` function exists and sets `withdrawn_at` in `consent_log`. However:
1. There is **no settings UI** where users can withdraw marketing/analytics consent
2. `consent_log` is mostly empty (see #4 — acceptTerms writes to `legal_acceptances` not `consent_log`)
3. No backend process checks `withdrawn_at` before executing consent-dependent features
4. In particular, there is no "email marketing opt-out" flow connected to any email service

The withdrawal button doesn't exist; the withdrawal data goes to the wrong table; and even if it worked, nothing downstream would react to it.  
**Risk:** HIGH — GDPR Art. 7(3) requires withdrawal to be as easy as giving consent. Offering withdrawal via a function that users can't reach and that doesn't affect behavior is non-compliant.  
**Fix:**
```
1. Fix #4 first (write to consent_log on signup).
2. Add "Privacy Settings" section to account settings with toggle for optional consents (marketing, analytics).
3. Wire toggle to withdrawConsent() / recordConsent().
4. Document in Privacy Policy: "Withdraw consent under Settings → Privacy."
Note: if no marketing emails are currently sent, state this explicitly rather than promising withdrawal.
```

---

## MISMATCH #9 — HIGH

**Document:** COMPLIANCE_AUDIT_REPORT_2026_04.md — "Audit trail wired to booking/option flows"  
**Legal statement intended (for disputes):** "All bookings, price negotiations, and acceptance actions are logged."  
**Actual behavior:** `audit_trail` table exists. `log_audit_action()` RPC exists. `logBookingAction()` and `logOptionAction()` functions exist. **None of them are called anywhere in the codebase.** Specifically:
- `bookingsSupabase.ts`: no `logAuditAction()` call
- `optionRequestsSupabase.ts`: no `logAuditAction()` call
- `AgencyControllerView.tsx`: model creation — no `logAuditAction('model_created')` call
- No existing call sites for `logAuditAction()` anywhere outside the new service files

The audit trail is structurally complete but completely unpopulated.  
**Risk:** HIGH — In a booking dispute, "we log all actions" cannot be substantiated. Evidence is missing.  
**Fix:**
```
Minimum viable wiring (in priority order):
  1. bookingsSupabase.ts: getBookingsForAgency() → no; createBooking()/updateBooking() → yes:
     await logBookingAction(orgId, 'booking_confirmed', bookingId, { status, model_id })

  2. optionRequestsSupabase.ts: on status changes:
     await logOptionAction(orgId, 'option_confirmed'/'option_rejected', optionId, { old, new })

  3. AgencyControllerView.tsx handleAddModel():
     await logAuditAction({ orgId, actionType: 'model_created', entityType: 'model', entityId: id })

  4. AgencyControllerView.tsx handleDeleteModel():
     await logAuditAction({ orgId, actionType: 'model_removed', entityType: 'model', entityId: id })
```

---

## MISMATCH #10 — HIGH

**Document:** Privacy Policy / Data Retention Policy  
**Legal statement intended:** "We automatically purge accounts and data after the applicable retention period."  
**Actual behavior:** `gdpr_run_all_retention_cleanup()` function exists and is correct. **No pg_cron job is scheduled.** No Edge Function cron triggers it. The function will never run automatically. Profiles with `deletion_requested_at` set 31+ days ago remain in the database unanonymized.  
**Risk:** HIGH — Every GDPR deletion request that has passed the 30-day window has not been executed. This is an ongoing violation for any user who has already requested deletion.  
**Fix:**
```
Immediate:
  Run manually in SQL Editor to process pending deletions:
  SELECT * FROM public.gdpr_run_all_retention_cleanup();
  Then call auth.admin.deleteUser() for each returned purged_user_id via Edge Function.

Permanent fix (choose one):
  A. pg_cron (recommended):
     SELECT cron.schedule('gdpr-daily-cleanup', '0 2 * * *', 
       'SELECT public.gdpr_run_all_retention_cleanup()');
     
  B. Edge Function cron (Supabase scheduled functions):
     Deploy a cron Edge Function that calls gdpr_run_all_retention_cleanup() + deleteUser().
```

---

## MISMATCH #11 — HIGH

**Document:** Guest Link Policy (intended)  
**Legal statement intended:** "We log all guest link access for security and compliance purposes."  
**Actual behavior:** `guest_link_access_log` table was created. **No code writes to it.** The `get_guest_link_info()` and `get_guest_link_models()` RPCs in PostgreSQL do not insert access log entries. No TypeScript code calls any insert on this table. The table is structurally ready but completely empty.  
**Risk:** HIGH — If the policy promises audit logging of guest link access, the promise is false. Security and compliance monitoring of external access is impossible.  
**Fix:**
```
In migration_compliance_hardening_2026_04.sql:
  Update get_guest_link_info() RPC to insert into guest_link_access_log on every call:
    INSERT INTO public.guest_link_access_log (link_id, ip_hash, event_type)
    VALUES (p_link_id, encode(digest(v_ip, 'sha256'), 'hex'), 'opened');

OR in TypeScript guestLinksSupabase.ts getGuestLink():
  After successful fetch, call a lightweight log_guest_link_access(linkId, 'opened') RPC.
```

---

## MISMATCH #12 — MEDIUM

**Document:** Privacy Policy (intended) — "Two separate tables for the same data"  
**Legal statement intended:** "We maintain a secure record of all consents."  
**Actual behavior:** Consent data is split across two tables:
- `legal_acceptances` — written by `acceptTerms()` — has: user_id, document_type, document_version, created_at. No `ip_address`, no `withdrawn_at`.
- `consent_log` — written by `recordConsent()` — has: user_id, consent_type, version, accepted_at, ip_address, withdrawn_at. Not written during signup.

`export_user_data()` RPC returns `consent_log` only — so the data export **misses the actual consent records** that live in `legal_acceptances`.  
**Risk:** MEDIUM — Data export is incomplete; consent record is split and inconsistent. Legal defense requires a unified record.  
**Fix:**
```
Short-term: update export_user_data() RPC to also include legal_acceptances:
  'legal_acceptances', (
    SELECT jsonb_agg(row_to_json(la))
    FROM (SELECT * FROM public.legal_acceptances WHERE user_id = p_user_id) la
  ),

Long-term: consolidate to a single consent table (see #4).
```

---

## MISMATCH #13 — MEDIUM

**Document:** AGB / Privacy Policy — Photo URL upload  
**Legal statement intended:** "All uploaded content is verified for safety and rights."  
**Actual behavior:** `ModelMediaSettingsPanel.tsx` → `handleAddUrl()` allows adding a photo by **external URL** (not file upload). This path:
1. Does **not** call `confirmImageRights()`
2. Does **not** run EXIF stripping (only file uploads go through `stripExifAndCompress()`)
3. Does **not** run MIME type validation / magic bytes check
4. References an external URL — could point to content not owned by the agency

The file upload path has validation; the URL path has none.  
**Risk:** MEDIUM — Urheberrecht violation possible; GDPR risk if the URL references content with GPS EXIF data; policy bypass for image rights.  
**Fix:**
```
Option A (simplest): Remove the "Add by URL" feature entirely or restrict to admin-only.
Option B: Add rights confirmation checkbox to the URL input flow, identical to file upload.
Option C: Proxy the URL through a server-side function that strips EXIF and validates MIME.
Document in AGB: "Adding images by URL is the agency's responsibility for rights verification."
```

---

## MISMATCH #14 — MEDIUM

**Document:** Privacy Policy — Supabase session storage  
**Legal statement intended:** (TBD — no policy exists yet)  
**Actual behavior:** `lib/supabase.ts` uses `localStorage` on web for session persistence (`sb-<project>-auth-token` key, set automatically by the Supabase JS client). This is a JWT token stored client-side. On mobile, `AsyncStorage` is used.

No cookie/storage disclosure mentions this. No consent banner for this exists (nor is one legally required for technically necessary session storage — but it **must be documented**).  
**Risk:** MEDIUM — Privacy Policy omission, not a consent requirement violation. But German law (UWG §6a) and TDDDG require disclosure of any storage access.  
**Fix:**
```
In Privacy Policy, add section "Session storage":
  "We use browser localStorage (web) and device secure storage (mobile) 
  to maintain your login session. This data is technically necessary and 
  automatically deleted when you sign out. No tracking or advertising data 
  is stored locally."
No cookie banner needed — technically necessary. Just document it.
```

---

## MISMATCH #15 — MEDIUM

**Document:** AGB — "Owner-exclusive functions: invite/remove members"  
**Intended behavior:** Only the org owner can invite and remove members.  
**Actual behavior:** 
- Agency: `ClientOrganizationTeamSection.tsx` allows `owner` **and** `booker` to invite (per `.cursorrules` rule: "Agency: Booker and Agency Owner are functionally equivalent — all features except Owner-exclusive rights")
- The `invitations` table RLS policy allows `owner` and `booker` for agencies, `owner` and `employee` for clients to INSERT invitations
- The `.cursorrules` file explicitly states this as intended behavior

**But the AGB must match this.** If the AGB says "only the owner can invite", that's wrong. If it says "owner and booker can invite" for agency, that's correct.  
**Risk:** MEDIUM — AGB wording must precisely reflect: bookers can invite members too (agency); employees can invite members too (client). If AGB says "owner only" this is false.  
**Fix:**
```
AGB must state:
  "Agency: Owner and Booker can invite members. Only the Owner can delete the organization 
  and manage billing."
  "Client: Owner and Employee can invite members. Only the Owner can delete the organization 
  and manage billing."
This matches the actual backend RLS policies.
```

---

## MISMATCH #16 — MEDIUM

**Document:** Privacy Policy — Data export completeness  
**Legal statement intended:** "Your export contains all data we hold about you."  
**Actual behavior:** `export_user_data()` currently does NOT include:
- `legal_acceptances` records (the actual consent records — see #12)
- `bookings` linked to the user as a model or client
- `model_applications` submitted by the user
- `model_photos` associated with the user's models
- `notifications` addressed to the user
- `guest_link_access_log` entries (access events linked to the user's agency)

The export is structurally correct but incomplete for a complete Art. 20 response.  
**Risk:** MEDIUM — Incomplete GDPR export. A data subject request could reveal gaps.  
**Fix:**
```
Extend export_user_data() RPC to include:
  - legal_acceptances WHERE user_id = p_user_id
  - model_applications WHERE applicant_user_id = p_user_id
  - bookings WHERE model_id IN (SELECT id FROM models WHERE user_id = p_user_id) -- if applicable
  - notifications WHERE recipient_id = p_user_id (limited to 500, recent)
Each with appropriate field selection (no foreign org data).
```

---

## MISMATCH #17 — LOW

**Document:** Privacy Policy — "Automatic account purge after 30 days"  
**Legal statement intended:** "After 30 days, your account is permanently deleted from our systems."  
**Actual behavior:** `gdpr_purge_expired_deletions()` **anonymizes** the profile (replaces PII with placeholders) but does **not** call `auth.admin.deleteUser()`. The auth record (email, password hash) in `auth.users` remains. Complete deletion requires the calling Edge Function to also call `auth.admin.deleteUser()` for each returned user ID.

The function comment says "The calling Edge Function must then also call auth.admin.deleteUser()" — but since no cron exists (see #10), this never happens.  
**Risk:** LOW (once #10 is fixed, this self-resolves) — but the Privacy Policy should say "deleted from our application database and authentication system" not just "deleted from our systems."  
**Fix:**
```
When implementing the cron (#10):
  After calling gdpr_run_all_retention_cleanup(), loop through returned user_ids:
    await supabase.functions.invoke('delete-user', { body: { userId: purgedUserId } })
  This ensures auth.users record is also removed.
```

---

## MISMATCH #18 — LOW

**Document:** Privacy Policy — EXIF / location data  
**Legal statement intended:** "We strip location metadata from uploaded images."  
**Actual behavior:** `stripExifAndCompress()` in `modelPhotosSupabase.ts` strips EXIF via canvas re-encoding. However:
- This is only called in the **file upload path**
- The **URL-add path** (see #13) bypasses this
- The **application upload path** (`applicationsSupabase.ts`) — needs to be verified separately
- Stripping is graceful-degradation: on failure, the original (with EXIF) is uploaded, and only a `console.warn` is issued

**Risk:** LOW — EXIF stripping mostly works but has bypass vectors. Privacy Policy should not claim 100% EXIF removal without qualifying "where technically possible."  
**Fix:**
```
Privacy Policy wording: 
  "We attempt to remove EXIF location metadata from uploaded photos where technically 
  possible on your device. File upload by URL does not support automated EXIF stripping."
Also: fix URL-add path (#13).
```

---

## FULL MISMATCH SUMMARY

| # | Area | Risk | Status |
|---|------|------|--------|
| 1 | GDPR data export — no UI | CRITICAL | Fix required |
| 2 | Image rights — upload not enforced | CRITICAL | Fix required |
| 3 | Legal URLs return 404 | CRITICAL | Fix required (publish pages first) |
| 4 | Consent tables not synchronized | CRITICAL | Fix required |
| 5 | No IP captured at consent | CRITICAL | Fix wording OR capture IP |
| 6 | localStorage undocumented | HIGH | Fix wording |
| 7 | Minors — no UI | HIGH | Fix wording OR build UI |
| 8 | Consent withdrawal — no UI + broken | HIGH | Fix required |
| 9 | Audit trail not wired | HIGH | Fix required |
| 10 | Retention cleanup not scheduled | HIGH | Fix required (operational) |
| 11 | Guest link access log not written | HIGH | Fix required |
| 12 | Data export misses legal_acceptances | MEDIUM | Fix RPC |
| 13 | URL-add bypasses rights + EXIF | MEDIUM | Fix required |
| 14 | Session storage undocumented | MEDIUM | Fix wording |
| 15 | AGB invite-right wording mismatch | MEDIUM | Fix AGB wording |
| 16 | Export incomplete | MEDIUM | Extend RPC |
| 17 | Auth purge not fully executed | LOW | Fix on #10 implementation |
| 18 | EXIF stripping has bypass vectors | LOW | Fix wording |

---

## "DOCUMENTS OVER-PROMISE" LIST

These are statements the legal documents **cannot truthfully make** based on current system behavior:

| Statement | Reality |
|-----------|---------|
| "Users can export their data at any time." | No UI for this exists. |
| "Every image upload requires rights confirmation." | Not enforced in any upload flow. |
| "Consent can be withdrawn at any time." | No UI; withdrawal table mostly empty. |
| "All bookings and negotiations are logged for traceability." | Audit trail is empty; no wiring. |
| "We automatically delete your account after 30 days." | No cron is scheduled. |
| "We log all guest link access for security purposes." | Log table exists but is never written. |
| "Guardian consent is required for minors." | No UI; flag is not enforced at creation time. |
| "We record your IP address at consent time." | IP is not captured. |

---

## "SYSTEM DOES MORE THAN DOCUMENTED" LIST

These are protections that exist in code but may not appear in legal texts:

| Behavior | Where |
|----------|-------|
| EXIF/GPS stripping from uploaded photos | `modelPhotosSupabase.ts` → `stripExifAndCompress()` |
| SHA-256 hashing of IPs (never storing raw IPs) | `guest_link_rate_limit` table |
| 15-minute signed URL expiry for guest images | `guestLinksSupabase.ts` → `GUEST_IMAGE_SIGNED_TTL_SECONDS` |
| Rate limiting of guest link access (60 req/min) | `migration_guest_link_rate_limit.sql` |
| Cross-org member injection blocked by DB trigger | `trg_guard_org_member_insert` |
| Booking legal hold auto-set on confirmation | `trg_booking_set_legal_hold` |
| Minor visibility blocked at DB level without consent | `trg_guard_minor_visibility` |
| Stripe subscription linking attack prevention | `checkSubscriptionLinking()` in Edge Function |
| Option request state machine enforced by DB trigger | `migration_hardening_2026_04_final.sql` |
| Storage capacity enforcement per agency | `agencyStorageSupabase.ts` |

**Recommendation:** Add these to the Privacy Policy or ToMs as evidence of technical protection — they strengthen the legal position significantly.

---

## FINAL VERDICT

### ⚠️ MOSTLY ALIGNED — 5 CRITICAL FIXES REQUIRED BEFORE LAUNCH

**Current state:** The backend security and data architecture is strong. The **infrastructure** for compliance is largely built. The **wiring and operational execution** is missing in critical places.

| Category | Verdict |
|----------|---------|
| Multi-tenant isolation / RLS | ✅ Aligned |
| Billing / paywall logic | ✅ Aligned |
| Account soft-delete flow | ✅ Aligned |
| Guest link security | ✅ Aligned |
| Stripe webhook security | ✅ Aligned |
| **Legal text URLs exist** | ❌ NOT ALIGNED (404) |
| **Image rights enforcement** | ❌ NOT ALIGNED |
| **Consent table unified** | ❌ NOT ALIGNED |
| **Data export UI accessible** | ❌ NOT ALIGNED |
| **Retention cleanup running** | ❌ NOT ALIGNED |
| Audit trail populated | ⚠️ PARTIAL (infrastructure only) |
| Consent withdrawal functional | ⚠️ PARTIAL (backend only) |
| Minors protection | ⚠️ PARTIAL (DB trigger only) |
| GDPR export completeness | ⚠️ PARTIAL (missing some tables) |

### Priority order before any user faces these legal texts:

```
1. [TODAY]    Publish legal texts at /terms and /privacy (or embed inline)
2. [TODAY]    Fix acceptTerms() to write to consent_log (sync both tables)
3. [THIS WEEK] Add data export "Download my data" button to settings
4. [THIS WEEK] Schedule pg_cron for gdpr_run_all_retention_cleanup()
5. [THIS WEEK] Add image rights checkbox to all upload flows
6. [THIS WEEK] Write guest link access events to guest_link_access_log
7. [THIS WEEK] Wire logAuditAction() into bookings + option flows
8. [BEFORE LAUNCH] Add consent withdrawal UI to settings
9. [BEFORE LAUNCH] Add is_minor flag UI to model creation (or document limitation)
10. [LEGAL]    Update AGB re: booker invite rights; update Privacy Policy re: localStorage
```
