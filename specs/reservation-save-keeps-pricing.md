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
   routing, sessions, occurrences; for a custom line also the amount typed, offered or not), with the money figures and the nights: an engine-derived auto-option
   (early check-in, cot) comes back from the replay as a plain locked line and from the save as a derived
   one, and must not count (review of #847: 14 of 52 fiches were re-priced by a note).
   **A custom line renamed alone saves its text only** (Adrien, 2026-10-29: « Texte seul, rien ne bouge »):
   the new name is written under the same id, a « Prestation libre » row goes to the history, and nothing
   is re-priced; a changed amount, quantity, date or any other pricing input re-prices. On a locked fiche a
   rename is refused like any other extras edit, unless the extras window is open.
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
   The trop-perçu reaches a **locked fiche** too: the ledger of `GET /api/reservations/:id` carries the
   « Trop-perçu » row (`ledgerFor(..., overpayment)` from the stored stay priced like its fiche) with its
   `refundPrefill`, which « Rembourser » opens the refund dialog on. The excess of a complement has no
   captured split: it is booked on the prestations the stay still sells — options first, then resources,
   then the accommodation — so bed linen moved out of the complement is refunded on the options account
   (70600010), not on the accommodation (70600000).
   The stored ledger measures the acompte and the solde against the STORED figures, never against today's
   engine (a stay paid in full at 807,20 € that the engine now prices at 777,70 € holds no trop-perçu: #14);
   only the collected complement's excess (`complementCollectedExcessTtc`) and a schedule excess measured on
   stored amounts show there. Swept over the 57 stays of the Solio base, only #22224 (21 €) and #22226 (28 €)
   carry the row.
   **Caisse interne by default** (Adrien, 2026-10-29): when the excess sits on a complement collected
   « caisse interne » (`complementPaidCash`), the `refundPrefill` carries `method: 'internal'` and the refund
   dialog opens on that means (`defaultMethod`), so nothing is booked in the accounts; the operator can change
   it. A refund by transfer is booked on the poste of its lines (70600010 for options), an internal one nowhere.
   Once the save has run the stored lines already carry the lower tax, so the tax a collected complement
   held is **stamped when it is collected**: `reservations.complementCollectedTax`, written by a trigger in
   the very statement that flips `complementPaid` 0 → 1 (every payment path, a plugin included), cleared when
   it flips back. A row collected before the column existed (NULL) reads the history instead (the value
   before the tax's first change since the collection); with neither stamp nor history the unexplained rest
   falls on the options, then the resources, then the accommodation.
   The poste of the excess is taken from what left the complement: the lines the stored complement carries
   beyond what the stay's complement now carries (options, resources, **tourist tax → 46710000**); what the
   stored lines cannot explain falls on the options, then the resources, then the accommodation.
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
   requested). The clean baseline of a loaded fiche is **the form as loaded**, plus what the quote writes
   into it (`applyQuoteToForm` on the baseline, never on the live form); a payment mark (and its undo, a refund, a ledger link, the SAS: every server-written update goes through one
   reload) moves whichever baseline is current, the loaded form before the first quote and the frozen one
   after, and re-baselines the same way, and a reload (STALE_FICHE included) takes it again. Until the first quote lands the baseline is the
   loaded form itself, so an edit typed meanwhile is already an edit: it can be saved, and leaving asks first
   (« Modifications non enregistrées »). The baseline is derived in the render that applies the quote (not in an
   effect), so a clean fiche with drifted stored figures never flashes « modified » when the quote lands.

8. **The stored trop-perçu is measured against the stored price** (round 2 of the money audit, 2026-10-29).
   On the GET, the trop-perçu of a direct stay is what was collected — the paid acompte and solde (their
   captured contribs when they exist) and the paid arrival complement — beyond the stored `finalPrice` plus
   tourist tax, net of refunds (`storedOverpaymentOf`). It no longer depends on the stored acompte and solde,
   which a save rewrites: a reduction confirmed after the solde was paid (#22306: 2 301,60 € paid, -10 % →
   176,30 €) still shows after the reload, on a locked fiche too. Drift between today's engine and the price
   the stay was sold at is not an excess (#14: 807,20 € paid at 807,20 €, replayed at 777,70 € → none);
   #22224 and #22226 keep 21 € and 28 €. A complement the operator adjusted is left out of both sides, and a
   platform stay has none (the platform refunds its guest). The engine only splits the amount by poste.
9. **The live ledger reports the stored figure plus what the edit adds.** `liveOverpayment` no longer reports
   the drift of today's engine: it is the stored trop-perçu (rule 8) plus the excess the posted fiche adds over
   what the engine already found on the stored stay. A note typed on an unlocked past fiche shows nothing new.
10. **The 409 OVERPAID carries the refund means** (`overpaymentMethod`, `internal` when the excess sits on a
    complement collected « caisse interne »), like the GET's `refundPrefill` and the live ledger.
11. **The detail line of an excess carried by a collected complement** reads « <poste> : <amount> encaissés
    en trop », never « 0,00 € dus »: the stay still owes its prestations, the line only says what was taken
    in excess.

12. **What the stored measure counts** (review of the round-2 fix, 2026-10-29). Collected is each paid bucket at
    the LARGER of its captured contribs and its stored amount (removing a paid line drops its contrib, the guest
    still paid it), plus the paid installments (an échéancier stay stores a 0 acompte and solde), the paid arrival
    complement, and what the mid-stay extras collected (settled notes, and the `midStayExtra` lines of a collected
    end-of-stay complement — they are inside `finalPrice`; the SAS-owned lines are not). An adjusted complement
    is left out of both sides: the total carries the complement the engine routes on its own
    (`complementRoutedAmount`), never the adjusted amount. Only free « Trop-perçu » refund lines (no line key)
    reduce the excess: the refund of a sold line takes its price off the stay too.
13. **The live ledger moves both ways.** It reports `max(0, stored + after − before)`: an edit that absorbs the
    stored excess takes it down, so the fiche never invites a refund the edit cancels.

14. **One refund basis in the live figure.** The stored trop-perçu is net of the free refunds only (rule 12); the
    two engine excesses the live ledger compares — the posted fiche and the stored stay — are raw (before any
    refund, never clamped by one) and compared with each other; the floor at 0 applies to the sum. Line
    refunds and free refunds therefore never distort the delta (#22306: a fully absorbed excess reads 0).
15. **The poste of an excess with no captured split is what left the stay.** The tourist tax first, then the
    options, then the resources, the rest on the accommodation: read from the stored lines against the quote's
    (before a save writes them) and from the history's tax / options / resources signatures since the first
    money was actually collected (after) — the first acompte or solde paid date, or the first paid installment —
    netting the increases inside that window (an option removed then restored counts for nothing); before a
    save writes, the larger of the two. A fiche read from the database uses the history alone: today's engine
    may price a stored line differently without any edit, which is no excess. Such a line reads « <poste> : <amount> encaissés
    en trop », never an « encaissés / dus » pair that contradicts the amount. Limit: a stay whose history was
    lost falls back on the accommodation; the correction of an adjusted complement (rule 12) uses today's
    engine for the complement it routes on its own, no stamp of that amount exists.
16. **No trop-perçu on a platform stay, live preview included (audit R3 N1, 2026-10-29).** The engine excess the
    live ledger compares (`engineExcessOf`) carries the same `isDirectChannel` guard as `overpaymentOf` and
    `storedOverpaymentOf` (reservation-refunds rule 38): a Gîtes de France or Airbnb stay whose solde is paid and
    whose brut or price is lowered reports `overpaymentTtc` 0, so the fiche never offers « Rembourser » there.
17. **The poste of a complement excess survives the save (audit R3 N3, 2026-10-29).** Once the save has
    rewritten the stored lines, the options and the activities a collected complement lost are read from the
    history's options / resources signatures since `complementPaidDate` (like the tax part, rule 15), the
    larger of that and the stored-vs-quote difference: a removed activity is refunded on « Activités », not on
    « Prestations complémentaires ».
    The complement's window overlaps the schedule's, so the hints can add up to more than the complement lost:
    only that overflow (Σ hints − `complementCollectedExcessTtc`) is taken back, from the options and resources
    the schedule share already covers on that poste, whatever the way it was split (leftover hints or captured
    contribs). A solde option removed in the window is thus not counted twice, and a drop that belongs to the
    complement is never cut. A paid complement with no paid date reads no history.
18. **The complement's history window reads only the complement's lines (audit R4 N5, 2026-10-29).** `droppedSince`
    filters the signature parts by their `cN` flag (`reservationAudit.js` `getOptionsSignature` /
    `getResourcesSignature`): the complement window (`complementLeftOf`) counts the `c1` lines only, the schedule
    window (`leftOfStayOf`) the `c0` lines only, and a line that only moved from one to the other is not a drop. An
    option dropped from an unpaid or already refunded solde therefore no longer takes the excess of a removed complement
    activity (X1, X2). A signature written before the flag existed carries none: its lines count in both windows, which
    is why rule 17's overflow correction stays.
19. **A paid direct stay can switch to a platform; what was received stays as received (Adrien, 2026-10-29: « Autoriser,
    figer le payé », audit R4 N6).** The save (and the preview) of a stay stored on a direct channel with an acompte or
    a solde ticked, posted on a platform, prices with `keepPaidAmounts`: the paid acompte and solde keep the stored
    amounts instead of following the platform statement (reservation-refunds rule 38), so the books keep what was really
    collected. The 409 `OVERPAID` and the live preview judge the posted channel like the save does: a platform sale
    announces no trop-perçu, and the channel change alone never asks for a refund. The freeze is the switching
    save's: a later save that moves no price keeps it (rule 1), a re-pricing follows the platform amount as any
    platform stay does.

**Edge cases:**
- In the extras window of a started fiche a custom line is keyed by its text (end-of-stay complement,
  arrival baseline): a rename there is refused with « Une prestation ajoutée une fois le séjour commencé ne
  peut pas être renommée. » (`ARRIVAL_LINE_RENAME`), not with the « ni retirée ni réduite » message.
- A custom line's `customKey` is the browser's handle, not part of its price: ignored by the comparison.
- The audit snapshot read from the database now carries `complementAmountOverride` and
  `endOfStayComplementAmountOverride`: an adjusted stay saved untouched is no longer read as an edit (#22275
  was refused with `PAST_RESERVATION_LOCKED` on a no-op save).
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

`reservations.complementCollectedTax REAL NULL` and its three triggers (`schema.sql`; `database.js` adds the column to an upgraded database right after the baseline pass): the tourist tax
as stored when the arrival complement was collected. Legacy rows stay NULL.

## 6. UI / UX

An amber alert above the platform price alert, one per notice, 44 px action target, full width at 390 px.

## 7. Test plan

- [x] `reservation-save-keeps-pricing.unit.test.js` (12) — rules 1-2: a stay shaped like #22212 / #22282
      (stored figures an older engine produced) saved untouched keeps money, custom option ids, nights and
      history; a note is saved and logged; a moved input re-prices; « Recalculer » re-prices; the bed
      invariant on stored lines; a refused or dry-run save pins no baseline; a rename saves the text alone
      (paid and offered line), a retyped offered amount re-prices; an adjusted complement is not an edit
      (#22275); a rename in the extras window is refused with its own message.
- [x] `reservation-save-keeps-pricing.auto-options.unit.test.js` (3) — rule 1: an early check-in line, a cot
      line, an offered auto-option whose catalogue price moved.
- [x] `reservation-engine-input-parity.unit.test.js` (1) — rule 3: the auditor's repro (12 adults, extra guest
      price raised 25 → 40): the plan splits the stay total, the restamp goes back to it.
- [x] `frozen-complement-excess-is-trop-percu.unit.test.js` (4) — rule 4, platform stays included.
- [x] `fiche-shows-collected-complement-excess.unit.test.js` (12) — rule 4: the preview announces it; the
      GET ledger of a locked fiche carries the row and its prefill; no false row when the replay prices a
      paid stay lower (#14); caisse interne default; options / tax poste, through the 409 and after the save; the stamp (same-day edit, edits around midnight,
      un-collecting) and the legacy fallback.
- [x] `plugins/accounting-export/tests/accounting-complement-excess-refund.unit.test.js` (2) — the excess
      refunded by transfer is booked on 70600010, by caisse interne nowhere.
- [x] Client `ReservationPage.baseline-before-quote.test.jsx` (1) — rule 7: a note typed before the first quote
      resolves (deferred mock) enables Enregistrer, shows the unsaved-changes dialog on leaving, and is sent;
      `ReservationPage.baseline-server-writes.test.jsx` (2) — a mark and an undo before the first quote leave the
      fiche clean, before and after the quote; `ReservationPage.baseline-drift.test.jsx` (1) — a drifted clean fiche never enables Enregistrer, not for a frame;
      `ReservationPage.bed-counts-zero.test.jsx` (3) — rule 7: a user edit then Enregistrer on a loaded fiche.
- [x] `trop-percu-stored-measure.unit.test.js` (15) — rules 8-15 (installments, removed paid line, mid-stay extras,
      adjusted complement, line versus free refunds, live ledger going down); rules 8-11: a confirmed trop-perçu
      survives the reload and shows locked (#22306 shape), no drift excess (#14 shape), platform none, the live
      ledger adds only the edit's change, the 409 means, the detail wording.
- [x] `fiche-pricing-notices.unit.test.js` (6) — rules 5-6; client `PricingNotices.test.jsx` (3).
- [x] Client `RefundDialog.overpayment.test.jsx` (5, `defaultMethod`) and `FinanceSection.refunds.test.jsx`
      (7, the row's own prefill).
- [x] `vat-regime-golden`: the `quote/*` family of the golden capture was regenerated (quotes of stored
      stays now carry refunds, commissions, the freeze and the payout delay); the other keys are unchanged.

## 8. Out of scope

- Rewriting the 19 stays whose replay differs from their row, #22201's commission, the four 2027 taxes.
- Client finding 2 of the audit (bed counts `0` → `null`): another branch.

## 9. Open questions

None.
