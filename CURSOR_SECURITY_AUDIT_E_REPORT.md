# Security Audit E — Input / Mutation / Abuse Hardening

**Date:** 2026-04-08  
**Scope:** P1–P8 (input sanitization, DB mutation patterns, file uploads, chat, tokens/URLs, rate/abuse surfaces, output safety)  
**Constraint:** No changes to business logic, RLS, Auth, Paywall, or Invite/Claim server semantics; minimal client-side hardening only.

---

## Executive Summary

The codebase already centralizes text validation in [`lib/validation`](lib/validation) (`validateText`, `sanitizeHtml`, `normalizeInput`, URL and file checks). Messenger and recruiting chat paths sanitize before storage; there is **no** `dangerouslySetInnerHTML` in the repo. File uploads use MIME + size + magic bytes + extension consistency on documented paths.

This audit identified a **small set of gaps** (mostly **LOW** severity): unbounded query/storage token size, unbounded shared-link query fields, optional `messages.metadata` JSON size, unsanitized shared booking notes, and one **Guest** UI path that opened `guest_link` without the same HTTPS validation used elsewhere.

**Minimal hardening was applied** (see [`CURSOR_SECURITY_AUDIT_E_DIFF_SUMMARY.md`](CURSOR_SECURITY_AUDIT_E_DIFF_SUMMARY.md)). No RLS, Auth, Paywall, or backend token algorithms were changed.

**SECURITY AUDIT E COMPLETE — ISSUES FOUND (minimal hardening applied)**

---

## Findings by Severity

### SAFE (confirmed)

| ID | Area | Notes |
|----|------|--------|
| **E-SAFE-001** | Chat text (messenger / recruiting) | `normalizeInput` → `validateText` → `sanitizeHtml`; URL subset check; link `metadata.url` validated. |
| **E-SAFE-002** | Rendering | No `dangerouslySetInnerHTML`; chat uses `<Text>` / RN primitives. |
| **E-SAFE-003** | OrgMessengerInline link open | `validateUrl` before `Linking.openURL` in `openUrl`. |
| **E-SAFE-004** | File uploads (chat / model / docs) | Documented pipelines use `validateFile`, `checkMagicBytes`, `sanitizeUploadBaseName`, size caps per [`lib/validation/file.ts`](lib/validation/file.ts). |
| **E-SAFE-005** | Guest booking message | Visible body goes through `sendMessage` (sanitized); `booking_request` renders as normal text type with sanitized `m.text`. |
| **E-SAFE-006** | Booking brief merge | [`src/utils/bookingBrief.ts`](src/utils/bookingBrief.ts) — fixed keys, max text, scope rules; product trust model for JSONB unchanged. |
| **E-SAFE-007** | `updateBookingDetails` | Shallow merge + optimistic lock on `updated_at`; field-level secrecy remains UI-filtered per product docs. |

### LOW / MEDIUM (addressed or documented)

| ID | Severity | Issue | Resolution |
|----|----------|--------|------------|
| **E-FIX-001** | LOW | `?invite=` / `?model_invite=` and storage could accept extremely long strings (local DoS / storage stress). | [`src/utils/queryParamGuards.ts`](src/utils/queryParamGuards.ts) + [`App.tsx`](App.tsx) getters; [`inviteToken.ts`](src/storage/inviteToken.ts) / [`modelClaimToken.ts`](src/storage/modelClaimToken.ts) reject oversize persist/read. |
| **E-FIX-002** | LOW | `?shared=1` `name` / `ids` unbounded. | `parseSharedSelectionParams` caps name length and id count. |
| **E-FIX-003** | LOW | `?guest=` / `?booking=` ids unbounded. | `clampQueryId` on read. |
| **E-FIX-004** | LOW | `messages.metadata` could be very large JSON. | `sendMessage` rejects `JSON.stringify(metadata).length > 65536`. |
| **E-FIX-005** | LOW | `appendSharedBookingNote` stored raw trimmed text without HTML stripping. | `sanitizeHtml` before persist (display remains plain text). |
| **E-FIX-006** | MEDIUM | `GuestChatView` opened `meta.guest_link` without `validateUrl`. | `validateUrl(url).ok` before `Linking.openURL`. |

### INFO (no code change)

| ID | Notes |
|----|--------|
| **E-INFO-001** | `booking_details` full JSONB on row SELECT — UI-filtered visibility; aligns with Audit D. |
| **E-INFO-002** | Client-side rate limiters (`messageLimiter`, `uploadLimiter`) are first-line only; server-side limits remain a future layer. |

---

## Simulated Attack Vectors

| Vector | Result |
|--------|--------|
| XSS via stored chat HTML | **Mitigated** — `sanitizeHtml` + no raw HTML render; RN `Text` does not execute scripts. |
| `javascript:` / `data:` in chat links | **Mitigated** — `extractSafeUrls` / `validateUrl` policy; `openUrl` validates HTTPS. |
| Renamed executable as image | **Mitigated** — magic bytes + extension checks on upload paths reviewed. |
| Megabyte `?invite=` token | **Mitigated** — length cap before state/storage. |
| Huge `messages.metadata` object | **Mitigated** — size cap at insert. |
| Malicious `guest_link` in package metadata | **Mitigated** — HTTPS validation before open in Guest flow. |

---

## What is SAFE vs WEAK vs FIXED

- **SAFE:** Core chat sanitization, file validation stack, absence of HTML injection sinks, booking brief key discipline.  
- **WEAK (residual):** Defense remains client-first for metadata/URL bounds; determined callers could still hit API limits until server quotas exist.  
- **FIXED:** Token/query bounds, metadata JSON cap, shared-note sanitization, guest link open validation (this pass).

---

## Out of Scope (unchanged per mandate)

- PostgreSQL RLS, `assert_is_admin`, paywall RPCs, invite/claim token generation/consumption on the server.
- Business rules for who may write which `booking_details` keys.
