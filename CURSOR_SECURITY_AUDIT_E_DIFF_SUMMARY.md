# Security Audit E — Diff Summary

**Date:** 2026-04-08

| File | Risk (before → after) | Change |
|------|-------------------------|--------|
| [`src/utils/queryParamGuards.ts`](src/utils/queryParamGuards.ts) | N/A → **LOW** hardening | New: token/id length limits, shared selection parser with caps. |
| [`App.tsx`](App.tsx) | **LOW** → **SAFE** | `getSharedParams` uses parser; invite/claim/guest/booking query getters use clamps. |
| [`src/storage/inviteToken.ts`](src/storage/inviteToken.ts) | **LOW** → **SAFE** | Reject oversize persist; purge oversize read/peek. |
| [`src/storage/modelClaimToken.ts`](src/storage/modelClaimToken.ts) | **LOW** → **SAFE** | Same as invite token. |
| [`src/services/messengerSupabase.ts`](src/services/messengerSupabase.ts) | **LOW** → **SAFE** | Max JSON size for `metadata` on `sendMessage`. |
| [`src/services/calendarSupabase.ts`](src/services/calendarSupabase.ts) | **LOW** → **SAFE** | `sanitizeHtml` on `appendSharedBookingNote` text. |
| [`src/views/GuestChatView.tsx`](src/views/GuestChatView.tsx) | **MEDIUM** → **LOW** | `validateUrl` before opening `guest_link`. |
| [`src/utils/__tests__/queryParamGuards.test.ts`](src/utils/__tests__/queryParamGuards.test.ts) | N/A | Unit tests for guards. |

**Risk legend:** Changes are client-side bounds and sanitization only; no storage bucket or RLS changes.
