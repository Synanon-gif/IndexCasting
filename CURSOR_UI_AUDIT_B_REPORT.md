# UI / Workflow / Consistency Audit B (Reset) — Report

## 1. Executive Summary

IndexCasting’s post-hardening UX is **coherent for primary flows**: invite/claim separation, paywall full-screen locks, client discover modes (package/shared/normal), and booking brief as structured fields are all documented in code and English `uiCopy`. The main **actionable gap** found in this pass was **measurement language**: mixed use of “Bust” vs “Chest”, dual DB fields (`bust` / `chest`), and missing explicit **cm** hints on several client- and guest-visible surfaces. **Small safe fixes** were applied in `uiCopy`, `ClientWebApp`, `GuestView`, and `SharedSelectionView` to align labels and overlays without touching auth, paywall, or calendar RLS.

**Booking Brief** remains **UI-scoped visibility** per role; it is **not** field-level RLS-isolated — consistent with [`docs/BOOKING_BRIEF_SYSTEM.md`](docs/BOOKING_BRIEF_SYSTEM.md). **Invite-before-claim** ordering in `finalizePendingInviteOrClaim` is an edge-case product behavior, not a security defect.

**Closure label:** `UI AUDIT B + SAFE FIXES APPLIED`

---

## 2. Surface map

| Primary surface | Responsibility | Mirrored / secondary | Overlap risk |
|-----------------|----------------|----------------------|--------------|
| `AuthScreen` + invite/claim gates | Sign-in/up, role context | `PendingActivationScreen`, `SetPasswordScreen` | Low if copy distinguishes invite vs self-service |
| `AgencyView` / `AgencyControllerView` | Roster, model edit, calendar, messages, clients, guest links | Some calendar patterns also in `ClientWebApp` | Medium: same booking JSON, different chrome |
| `ClientWebApp` | Discover, projects, messages, calendar | `ClientView` shell | Low: single web workspace |
| `ModelView` / `ModelProfileScreen` | Self-service profile, calendar, media | Agency-edited same model | Accepted: two editors, one DB |
| `GuestView` | Token package browse + request | In-app package mode in `ClientWebApp` | Low: different entry, similar grid |
| `SharedSelectionView` | Read-only URL selection | Discover shared-project mode | Naming: “shared” means different things |
| `BookingChatView` | Deep-linked booking thread | Option threads inside messages | Medium: user must know which “chat” |
| `AdminDashboard` | Admin-only ops | — | Isolated |

---

## 3. Cross-role walkthrough (concise)

| Persona | Likely mental model | Where they may drift | Severity |
|---------|---------------------|----------------------|----------|
| Agency Owner | Billing + invites + roster | Expect booker to invite (owner-only copy exists) | LOW — `uiCopy` documents owner-only |
| Agency Booker | Same product tools as owner except billing/member mgmt | Paywall if org blocked | LOW — full-app lock now mirrors client |
| Client Owner | Projects + discover + billing | Two chat types (option vs B2B) | MEDIUM — accepted complexity |
| Client Employee | Same as owner minus billing | Same as above | MEDIUM |
| Model | Calendar + profile + options | Agency vs self-edit boundaries | LOW — documented invariants |
| New self-service user | “I create my org” | Confused if they used invite link | LOW — invite gate copy |
| Invited Booker/Employee | “I join existing org” | Email mismatch alert path | LOW |
| Claimed model user | “I link profile” | Rare: both invite+claim tokens | LOW — sequential finalize |

---

## 4. Overlap / duplication findings

| Item | Classification |
|------|----------------|
| Option thread vs org B2B chat | `ACCEPTED_PRODUCT_COMPLEXITY` |
| Booking brief vs shared notes vs internal notes | `LOW` — `uiCopy.calendar` + `bookingBrief` separate titles |
| Discover / package / shared-project | `ACCEPTED_PRODUCT_COMPLEXITY` — guarded in `ClientWebApp` |
| Agency + Client both have attention filters on messages | `LOW` — intentional parity |
| Dual `bust`/`chest` columns | `CONFIRMED_UI_MEDIUM` (documentation + labeling; partial fix applied) |

---

## 5. Consistency / terminology / units

- **Canonical product meaning:** fashion measurements in **centimeters**; chest and bust refer to the **same** logical measurement for agency saves (mirror in `AgencyControllerView` when saving chest).
- **Discovery filtering:** server/client filters prefer **`chest`** (`modelsSupabase`, `modelFilters`).
- **Completeness:** `chest ?? bust` in [`src/utils/modelCompleteness.ts`](src/utils/modelCompleteness.ts).
- **Guest RPC:** `get_guest_link_models` exposes **`bust` only** — UI label **Chest** is correct; value source unchanged.
- **Fixes applied:** see [`CURSOR_UI_AUDIT_B_DIFF_SUMMARY.md`](CURSOR_UI_AUDIT_B_DIFF_SUMMARY.md).

---

## 6. Upload / photo UX findings

- **HEIC:** Central conversion in [`src/services/imageUtils.ts`](src/services/imageUtils.ts); user-facing failure in `uiCopy.common.heicConversionFailed`; services log `heic_conversion_failed`.
- **Surfaces:** Model photos, chat (`messengerSupabase`, `recruitingChatSupabase`), documents, verification, option documents — pattern is consistent at service layer; **device-specific** picker quirks remain **`MANUAL_REVIEW_REQUIRED`**.
- **Client photos:** Visibility alignment is documented in [`docs/CLIENT_MODEL_PHOTO_VISIBILITY.md`](docs/CLIENT_MODEL_PHOTO_VISIBILITY.md); no regression introduced.

---

## 7. Booking Brief privacy UX assessment

- **UI:** [`BookingBriefEditor`](src/components/BookingBriefEditor.tsx) + `uiCopy.bookingBrief` explain shared vs private badges.
- **Trust:** Row-level `calendar_entries` access still returns full `booking_details` JSON to authorized parties; private fields are **hidden in UI**, not stripped server-side — **do not** promise cryptographic or field-level DB isolation in marketing or help text.
- **No code change** required beyond existing docs.

---

## 8. Small safe fixes applied now

Listed in [`CURSOR_UI_AUDIT_B_DIFF_SUMMARY.md`](CURSOR_UI_AUDIT_B_DIFF_SUMMARY.md) and `fixed_now` in [`CURSOR_UI_AUDIT_B_PLAN.json`](CURSOR_UI_AUDIT_B_PLAN.json).

---

## 9. Rules / docs decision

- **`.cursorrules` / `system-invariants.mdc` / `auto-review.mdc`:** **No update** — existing rules already cover invite copy, booking brief trust model, upload matrix, and optimistic-update contracts.
- **Docs:** **No mandatory change**; canonical brief doc remains [`docs/BOOKING_BRIEF_SYSTEM.md`](docs/BOOKING_BRIEF_SYSTEM.md).

---

## 10. Top UI priorities next

1. **Discovery / algorithm Audit C** — ranking, filters, near-me, package injection (logical follow-up).
2. **Manual device matrix** for uploads (iOS Safari HEIC, Android gallery, desktop drag-drop).
3. **Optional:** single-field strategy long-term (`bust` vs `chest`) in DB/API to reduce engineer confusion (not required for users if UI stays consistent).
4. **Optional:** one onboarding tooltip for “Option chat vs Agency chat” on first messages visit.

---

## Suggested next step

**Discovery / Algorithm Audit C** is the most logical next pass after Audit B, because B establishes consistent **human-readable** measurement and surface boundaries; C can evaluate **what the client sees first** and why.
