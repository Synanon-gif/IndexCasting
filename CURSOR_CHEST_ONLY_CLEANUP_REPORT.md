# Chest-only consistency cleanup — report

## 1. Executive summary

All **visible English product surfaces** in `src/` were aligned to **Chest** / **Chest (cm)** only. The legacy database and API field **`bust`** remains; display logic continues to prefer **`chest ?? bust`** where both exist. No schema migration, no auth/admin/paywall/calendar changes.

## 2. Visible “Bust” findings (before)

- `uiCopy`: mixed “Chest / Bust” and “Chest / bust” in model edit, completeness, and swipe strings.
- `ModelProfileScreen`: hardcoded label “Bust” and `bust`-only mapping.
- `modelCompleteness.ts`: banner issue label contained “bust”.
- `CustomerSwipeScreen`: `measurementBust` key and `bust`-only numeric field on client model.
- E2E guest tests keyed on the substring `bust`.

## 3. Chest-only normalization applied

- Central copy updates in [`src/constants/uiCopy.ts`](src/constants/uiCopy.ts); `swipe.measurementChest` replaces `measurementBust`.
- Swipe screen maps **`chest: m.chest ?? m.bust ?? 0`** and labels with `measurementChest`.
- Model profile screen stores **`chest`** from **`m.chest ?? m.bust`** and uses `uiCopy.modelEdit` measurement labels (including **Chest (cm)**).
- Completeness issue label: **Chest measurement missing.** Header comment documents legacy `bust`.
- Client web project overview adds **`cm`** to chest/waist/hips fragments for consistency.
- [`e2e/guest-link.spec.ts`](e2e/guest-link.spec.ts) uses **`chest`** in heuristics.
- [`.cursor/rules/auto-review.mdc`](.cursor/rules/auto-review.mdc): three additive guardrails for future changes.

## 4. Legacy internal mappings still present

- `public.models`: **`bust`** and **`chest`** columns; agency save path still writes both for compatibility ([`AgencyControllerView.tsx`](src/views/AgencyControllerView.tsx)).
- Guest-link RPC responses may expose **`bust`**; UI templates already said “Chest” and remain so.
- Services, imports, Mediaslide/Netwalk sync: **`bust`** in field lists and RPC params unchanged.

## 5. Rules decision

- **Updated:** `.cursor/rules/auto-review.mdc` (Chest-only visible copy; no leaking DB field names into UI; cm consistency).
- **Not updated:** `system-invariants.mdc` — not required for this copy-only cleanup.

## 6. Why no risky schema refactor

Renaming or dropping **`bust`** would touch migrations, RPC signatures, external sync (Mediaslide), and regression surface. Product goal (“users never see Bust”) is achieved by **UI and copy** plus **`chest ?? bust`** display rules.

## 7. Product-canonical terminology (after)

- **User-facing English:** only **Chest**, with **(cm)** in labels or inline as appropriate.
- **Internal:** **`bust`** may still appear in code and SQL as a legacy column name; it must not appear in user-visible strings.

---

**Audit C:** Running a follow-up UI/copy audit next is reasonable; this change removes Bust/Chest wording noise from the main app sources.
