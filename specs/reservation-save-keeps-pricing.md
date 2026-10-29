# A save keeps the stay as it was priced

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `fix/audit-money` |
| **Created** | 2026-10-28 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |

---

## 1. Context

The audit of 2026-10-28 (money and client slices) found one root cause behind four symptoms: the engine of
today re-derives a stored stay differently from the engine that priced it (a catalogue edited, a rule
changed since), and nothing separated « the operator changed something » from « the operator pressed
Enregistrer ».

- **The replay of a stored stay was not the fiche's.** `buildReservationEngineInput` left out the tariff
  snapshot, the acompte opt-out and overrides, the platform commissions and settings, the mid-stay and
  schedule context and the quote post-processors. 22 of 57 stays replayed away from their stored row. Its
  consumers — installment plans (and `restampBuckets`, which writes `depositAmount`/`balanceAmount`), the
  trop-perçu baseline, the contrib capture, the tourist-tax declaration — followed: a plan was split over
  1 000,80 € on a stay the fiche read at 928,80 €.
- **An untouched save rewrote money.** `PUT /api/reservations/:id` re-priced the stay whatever had changed:
  #22212 (paid, past) 297,61 → 300,27 €, #22282 905 → 901,82 € and a tourist tax 0 → 19,20 €; snapshots
  re-stamped, custom options deleted and re-inserted under new ids, a history « update » row blamed on the
  operator.
- **A collected arrival complement above the stay total** (#22209 +0,60, #22224 +21, #22226 +28 €).
- Two plausibility gaps: a commission of 91,5 % on a channel configured at 5 % (#22201), and four Booking 2027
  stays storing a tourist tax of 0 since before Booking was switched to « nous reverse » the tax.

## 2. Goal

A stay is priced the same way wherever it is priced; saving a fiche changes the money only when the operator
changed something the price depends on; money collected beyond the total is reported as such.

## 3. Functional rules

1. **A save that moved no pricing input keeps the stay as it was priced.** The quote of the posted fiche is
   compared with the quote of the stored stay (both through the same engine, `pricingUnchangedFromStored`).
   Only what a line BILLS is compared (identity, units, unit price unless offered, total, offered,
   routing, sessions, occurrences; for a custom line also its text and the amount typed, offered or not —
   renaming it or retyping an offered amount is an edit), with the money figures and the nights: an engine-derived auto-option
   (early check-in, cot) comes back from the replay as a plain locked line and from the save as a derived
   one, and must not count (review of #847: 14 of 52 fiches were re-priced by a note).
   When they are identical, the money columns, the option / custom-option / resource lines (ids included),
   the nights, the tariff snapshot, the tourist-tax freeze, the complement ventilation, the installment plan
   and the history are not touched. What is not priced (notes, client, beds, payment dates, cautions…) is
   saved and logged as before. The bed counts still follow the stored lines (`bed-config-in-linen-card.md`
   rules 7, 12), and the arrival-extras baseline is captured inside the write, after every refusal — the
   extras window of a started fiche included (it reads the baseline without storing it).
2. **A save that moved a pricing input re-prices the stay, as before.** An explicit « Recalculer » of the
   tourist tax (`refreshTouristTax`) or « Utiliser les tarifs actuels » (`refreshPricingToCurrent`) also
   re-prices: it is how a stale figure gets updated. A replay that cannot run reads as « changed ».
3. **One engine input for a stored stay.** `buildReservationEngineInput` carries every input the save passes
   that lives on the row (locked nights, lines and tariff snapshot, `depositDisabled`, the acompte and
   complement overrides, both commissions, the tourist-tax freeze, the booking date and the acompte deadline
   already promised). `quoteStoredReservation` adds what only the application's models know (the platform's
   acompte and payout settings, the mid-stay state) and the quote post-processors. The mid-stay, schedule,
   platform and freeze helpers moved out of the save controller into `reservationQuoteContext`, which the
   preview, the create and the save also use. Installment plans, restamped buckets, the trop-perçu baseline,
   the contrib capture, the tourist-tax declaration and the VAT regime switch all price a stored stay
   through it. The remaining differences between a replay and the stored row (19 of 57 on the Solio base) are
   stays priced by an older rule or catalogue — platform stays whose brut still nets a tax the platform no
   longer withholds, an archived option, the Booking tax of rule 6 — which a real edit of the fiche would
   move identically; they are what rule 1 protects.
4. **A collected complement stays at what was collected; the excess is a trop-perçu.** When an edit leaves a
   collected, unadjusted arrival complement above what the stay now asks of the arrival (a line moved out
   of it, a tax that fell), the books keep following the money, and the engine's `overCollectedTtc` carries
   the excess — the same trop-perçu machinery as the acompte and the solde (`reservation-refunds.md`
   rules 34-36): a save that adds to it is refused until confirmed, and the refund dialog offers it.
   *Resolved 2026-10-28 (open question 2 of `accounting-books-the-money-collected.md`): the alternative —
   lowering the collected complement to the live figure — would move an entry already exported
   (`accountant-accounting-export.md` rule 33) and write down money the guest really paid.* A complement the
   operator adjusted himself (`complementAmountOverride`, #22275 +3,95 €) is his decision and is not
   second-guessed.
   **Direct channels only** (Adrien, 2026-10-29: « ne rien changer » on platform stays): a platform stay
   keeps rule 38 of `reservation-refunds.md` — the guest paid the platform, which refunds them itself, so
   the engine exposes no `overCollectedTtc` for it, in the preview and in the replay alike, and the excess
   stays as it was (#22208, #22209 on the Solio base).
   On a direct channel the fiche preview (`liveOverpayment`) prices the stay with the collected complement
   at its stored amount, so the trop-perçu reaches the fiche and the refund dialog. Lodgify, a direct channel on Solio, is covered
   (#22224, #22226). #22209 (+0,60 €, Abracadaroom) is a platform stay: out.
5. **A commission far above the platform's rate is flagged.** On the fiche, a platform stay whose entered
   commission exceeds twice the platform's configured percent of the sale, or half of the sale, shows
   « Commission de 1 118,06 € : 91,5 % du séjour, contre 5,0 % attendus pour Lodgify. » Server-worded
   (`quote.notices`), a warning, never a refusal; no data is changed.
6. **A stale tourist tax is announced.** When the tax the engine computes now differs from the stored one on
   an unfrozen stay, the fiche shows « Taxe de séjour à mettre à jour : 0,00 € enregistrés, 21,24 € calculés. »
   with a « Recalculer » button; saving then re-prices (rule 2). On a platform that now reverses the tax
   (Booking since 16/10, `platform_reversed`: the amount the platform withheld is ignored, the computed tax
   is the one declared — `platform-tourist-tax-out-of-the-commission.md` rule 1), « enregistrés » is the
   figure the summary still prints as the platform's tax (#22282: 16,02 € then, 19,20 € calculés). Nothing is rewritten on its own: #22270,
   #22282, #22301 and #22304 are re-saved by the operator.
7. **The fiche's Enregistrer is disabled on a clean form** (and stays enabled once « Recalculer » is
   requested).
   > **Sans test** — one prop of a 4 000-line page; read in the browser on the shadow copy (the button is
   > disabled until a field changes).

**Edge cases:**
- A custom line's `customKey` is the browser's handle, not part of its price: ignored by the comparison.
- A save on a past stay passes the same gate; its allowlist is evaluated on the pinned figures, so a
  untouched save is never refused as « locked ».

---

## 4. Architecture

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `controllers/` | `reservationsController.js` | T | `performUpdate`: `keepPricing` gate, pinned quote, reduced write; `pricingNoticesOf`; imports the context helpers |
| `controllers/` | `installmentsController.js` | T | Prices the stay through `quoteStoredReservation` |
| `models/` | `reservationsModel.js` | T | `updateReservation({ keepPricing })` skips the engine-derived side writes |
| `models/` | `financeModel.js`, `vatRegimeSwitchModel.js` | T | Price stored stays through `quoteStoredReservation` |
| `utils/` | `reservationEngineInput.js` | T | The stored-stay engine input, complete |
| `utils/` | `reservationQuoteContext.js` | C | Mid-stay, schedule, platform and freeze inputs shared by preview, create, save and replay |
| `utils/` | `storedReservationQuote.js` | C | `quoteStoredReservation`, `pricingUnchangedFromStored`, `pinStoredPricing` |
| `utils/` | `fichePricingNotices.js` | C | Rules 5 and 6, pure |
| `utils/` | `forceItemContribsCapture.js` | T | Prices through `quoteStoredReservation` |
| `utils/` | `pricing.js` | T | `overCollectedTtc` carries the collected complement's excess (rule 4) |
| `plugins/accounting-export/` | `accountingModel.js` | T | See `accounting-books-the-money-collected.md` rule 15 |

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `components/` | `reservation/PricingNotices.jsx` | C | Renders `quote.notices` (generic: `{ code, text, action? }`) |
| `constants/` | `pricingSummaryStrings.js` | T | The notice action label |
| `pages/` | `ReservationPage.jsx` | T | Mounts the notices; Save disabled on a clean form (rule 7) |

### 4.3 API contract

`POST /api/reservations/calculate-price` gains `notices: Array<{ code, text, action? }>`.
`PUT /api/reservations/:id` answers as before.

## 5. Data model

None.

## 6. UI / UX

An amber alert above the platform price alert, one per notice, 44 px action target, full width at 390 px.

## 7. Test plan

- [x] `reservation-save-keeps-pricing.unit.test.js` (4) — rules 1-2: a stay shaped like #22212 / #22282
      (stored figures an older engine produced) saved untouched keeps money, custom option ids, nights and
      history; a note is saved and logged; a moved input re-prices; « Recalculer » re-prices.
- [x] `reservation-engine-input-parity.unit.test.js` (1) — rule 3: the auditor's repro (12 adults, extra guest
      price raised 25 → 40): the plan splits the stay total, the restamp goes back to it.
- [x] `frozen-complement-excess-is-trop-percu.unit.test.js` (3) — rule 4.
- [x] `fiche-pricing-notices.unit.test.js` (5) — rules 5-6; client `PricingNotices.test.jsx` (3).
- [x] `vat-regime-golden`: the `quote/*` family of the golden capture was regenerated (quotes of stored
      stays now carry refunds, commissions, the freeze and the payout delay); the 180 other keys are
      unchanged.

## 8. Out of scope

- Rewriting the 19 stays whose replay differs from their row, #22201's commission, the four 2027 taxes.
- Client finding 2 of the audit (bed counts `0` → `null`): another branch.

## 9. Open questions

None.
