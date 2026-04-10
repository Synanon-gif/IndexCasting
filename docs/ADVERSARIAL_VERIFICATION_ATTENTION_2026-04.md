# Adversarial Verification — Smart Attention / Calendar / Negotiation (2026-04)

## 1. Executive summary

- **Single commercial gate:** `deriveNegotiationAttention` (D1) and `deriveApprovalAttention` (D2) now both treat “price closed” as **`priceCommerciallySettledForUi`** (accepted + `proposed_price` or `agency_counter_price`), matching [`NegotiationThreadFooter`](src/components/optionNegotiation/NegotiationThreadFooter.tsx) lock and avoiding header/approval vs footer drift when `client_price_status === 'accepted'` without anchors (pathological / legacy rows).
- **Store:** [`agencyCounterOfferStore`](src/store/optionRequests.ts) reconciles the thread row from **`getOptionRequestById`** after the counter RPC (fallback to local fields if fetch fails); notifications reuse that row when present.
- **Tests:** Extended coverage for `counter_rejected`, approval next-step, `job_confirmed`, commercial-gate edge cases, and calendar badge fixtures with explicit price anchors.

## 2. Pass/fail matrix (surfaces × states)

Legend: **Y** = aligned by construction; **C** = coarse by design; **—** = not applicable.

| # | State | Thread header / list | Summary / chips | Footer | Calendar badge | Calendar next-step | Smart attention (role) | Deeplink/reload |
|---|--------|------------------------|-----------------|--------|----------------|-------------------|-------------------------|-----------------|
| 1 | Initial negotiation | Y (`attentionHeaderLabelFromSignals`) | Y (attention prop) | Y (`priceLocked` false) | C (D2 inactive → “negotiating”) | Y (D2→D1) | Y | Y (store + `getOptionRequestById` on refresh paths) |
| 2 | Agency counter → client | Y | Y | Y (agency awaiting client branch) | C | Y | Y | Y |
| 3 | Client proposed → agency | Y | Y | Y | C | Y | Y | Y |
| 4 | `counter_rejected` | Y | Y | Y | C | Y (tested) | Y | Y |
| 5 | Commercially settled (price) | Y (D2 can activate) | Y | Y (`priceLocked`) | Y (D2-driven) | Y | Y | Y |
| 6 | Waiting agency approval (model linked) | Y | Y | Y (`agencyMayActOnFee`) | Y | Y | Y | Y |
| 7 | Waiting model | Y | Y | Model strip | Y | Y (model “your turn”) | Y | Y |
| 8 | Option confirmed | Y | Y | Locked / confirm job rules | Y / C | Y | Y | Y |
| 9 | Client confirm job | Y | Y | `clientMayConfirmJobFromSignals` | Y (`awaitingClientJob`) | Y | Y | Y |
| 10 | Job confirmed | Terminal | Terminal | Closed copy | Job | `nextStepNoAction` | No attention | Y |
| 11 | Deleted / rejected pre-job | Purged / terminal | — | Closed | `rejected` / gone | Terminal | No | Purge store |

**Note:** Calendar **badge** stays **D2-first** and intentionally **coarse** during pure D1 negotiation (`approval_inactive` → generic “Option (negotiating)”); **next-step** and **header** expose D1 direction. This is consistent with the plan; changing it would be a product decision.

## 3. Remaining inconsistencies found

- **`hasConflictWarning`:** Still not passed into calendar/list signals (always `false` in builders). Safe while conflicts are submit-time alerts only; if conflicts are ever persisted on the row, wire them through `attentionSignalsFromOptionRequestLike` and [`attentionHeaderLabelFromSignals`](src/utils/negotiationAttentionLabels.ts).
- **`deriveSmartAttentionState`:** Legacy; production uses D1/D2. Kept aligned via the same commercial gate in the negotiation branch.

## 4. Fixes applied (this pass)

| Area | Change |
|------|--------|
| D1/D2 | `priceCommerciallySettledForUi` for `price_agreed` (D1) and approval gate (D2); removed unused `priceAgreed` helper |
| Store | `agencyCounterOfferStore` full row refresh + single `getOptionRequestById` for notifications |
| Tests | `optionRequestAttention`, `calendarDetailNextStep`, `calendarProjectionLabel` |

## 5. Files changed

- [`src/utils/optionRequestAttention.ts`](src/utils/optionRequestAttention.ts)
- [`src/store/optionRequests.ts`](src/store/optionRequests.ts)
- [`src/utils/__tests__/optionRequestAttention.test.ts`](src/utils/__tests__/optionRequestAttention.test.ts)
- [`src/utils/__tests__/calendarDetailNextStep.test.ts`](src/utils/__tests__/calendarDetailNextStep.test.ts)
- [`src/utils/__tests__/calendarProjectionLabel.test.ts`](src/utils/__tests__/calendarProjectionLabel.test.ts)
- This document

## 6. What is verified consistent (automated)

- Footer commercial lock ↔ D1 `price_agreed` ↔ D2 approval phases (same settlement predicate).
- Calendar next-step ↔ header priority (D2 then D1) for tested fixtures.
- Agency calendar `needsAgencyActionForOption` ↔ `attentionHeaderLabelFromSignals` (existing parity test unchanged).
- `clientRejectCounterStore` / accept paths already used canonical refresh; counter-offer path now reconciles like accept.

## 7. Manual live QA (recommended)

- Reload thread after agency counter, client accept/reject counter, confirm option, confirm job, delete request — confirm no stale footer.
- Calendar deeplink into negotiation thread: badge coarse vs next-step specific — confirm acceptable UX.
- Multi-tab: two clients on same thread (if applicable) — last write wins; no automated test.

## 8. Quality gates

- `npm run typecheck` — pass
- `npm run lint` — pass (existing warnings elsewhere)
- `npm test -- --passWithNoTests --ci` — pass

## 9. Git commit

Performed as part of release workflow (pull --rebase before commit, push after).

## 10. Residual risks

- Rare DB rows with `accepted` and no price columns: UI now treats them as **not** commercially settled (negotiation still “open” for D1, D2 inactive), matching footer.
- Badge coarseness vs list attention during D1-only phases.

## 11. Verdict

**CONDITIONALLY READY FOR LIVE QA** — automated gates green; full end-to-end confirmation on staging with real RPCs and calendar still recommended. Upgrade to **READY FOR LIVE QA** after the manual checklist in §7 is executed once on staging.
