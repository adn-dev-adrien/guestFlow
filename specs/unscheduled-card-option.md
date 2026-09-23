# An unscheduled card option keeps its line — and gets planned

| Field | Value |
|---|---|
| **Status** | Implemented _(2026-09-23)_ for rules 1-7, 9 and 10 — server suite 4305 green, client suite 1304 green, reproduction replayed in a browser. **Rule 8 (the arrival-SAS planning step) is deferred**, see §8. |
| **Branch** | `fix/unscheduled-card-option` |
| **Created** | 2026-09-23 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |
| **Related** | [option-planning-card.md](option-planning-card.md) (supersedes the « empty selection → no line » behaviour of §3.4), [public-planning-options.md](public-planning-options.md), [site-meal-portions.md](site-meal-portions.md) (§8 named this bug), [hourly-resource-quantity-and-sas-scheduling.md](hourly-resource-quantity-and-sas-scheduling.md) (same fix, already shipped for resources), [reservation-option-immutability.md](reservation-option-immutability.md) (the invariant this bug breaks), [sas-breakfast-and-catering-upsell.md](sas-breakfast-and-catering-upsell.md) (amends rules 2 and 8) |
| **Summary** | [docs/specs/2026-09-23-unscheduled-card-option.html](../docs/specs/2026-09-23-unscheduled-card-option.html) |

---

## 1. Context

A booking made on the website can carry a **planning-card option** — « Petit déjeuner », « Le repas
des trappeurs ». The visitor cannot choose the mornings, so the engine bills the **quantity** and
leaves the line **unscheduled**: `reservation_options.cardOccurrences` stays `NULL` and the line
carries `toBeScheduled: true` ([public-planning-options.md](public-planning-options.md) rule 1,
[pricing.js:1586-1626](../server/src/utils/pricing.js#L1586)). That mode exists only under the engine
flag `planningCardAsQuantity`, which only the public flow sets.

**The line then disappears from the reservation, and nobody is told.** Reproduced end to end on
2026-09-23 (dev server + browser, `/public/v1/booking-requests` → conversion → fiche):

| Step | Stored | What the operator sees |
|---|---|---|
| Site request (2 pers., 3 nights, 6 petits déjeuners) | devis 22289 · `quantity 6` · `billedUnits 6` · 48 € · `cardOccurrences NULL` · `finalPrice 348 €` | — |
| Conversion into a reservation | reservation 22290, line copied **intact**, 348 € | — |
| **Opening the fiche** | unchanged | « Petit déjeuner » switch **off**, summary **307,20 €** |
| Clicking « Enregistrer » | line **deleted**, `finalPrice` **300 €** | nothing |

So the loss is visible **before** any save: the fiche recomputes on load and the guest's 48 € is
already gone from the screen; the save only engraves it. The same happens to the **devis itself**
when it is opened in the back-office — verified on devis 22291, saved down from 348 € to 300 €.

**Three independent defects produce it.**

1. **The engine drops a taken option.** The card branch returns `null` when the selection is empty and
   the flag is absent ([pricing.js:1628](../server/src/utils/pricing.js#L1628)). A line billed on a
   quantity therefore cannot survive a replay by any caller that does not set the flag.
2. **Nothing carries the public origin.** `convertToReservation` does not copy `requestOrigin`
   ([devisModel.js:837](../server/src/models/devisModel.js#L837)), and `devisModel.update` reads the
   flag from the request body ([devisModel.js:406](../server/src/models/devisModel.js#L406)), which the
   fiche never sends — so no replay after the booking request ever has it.
3. **The client rebuilds an empty grid.** `buildGridFromStored` turns a `NULL` selection into an
   all-unchecked grid ([cardOccurrences.js:125](../client/src/utils/cardOccurrences.js#L125)),
   `toWireOccurrences` sends `[]`, and `applyQuoteToForm` rebuilds `selectedOptions` from the quote
   ([applyQuoteToForm.js:53](../client/src/utils/applyQuoteToForm.js#L53)) — a dropped line vanishes
   from the form, which is why the switch reads « off ».

**This is the third time the same hazard is paid for.** It was found and patched inside
`applyQuoteToForm` during the original implementation (« the next recompute sends no occurrences → the
server returns no line → the option vanishes », [option-planning-card.md:158](option-planning-card.md)),
patched again by a safety net in `buildInitialGrid`
([cardOccurrences.js:113](../client/src/utils/cardOccurrences.js#L113)), and a one-shot migration
`breakfast_card_occurrences_v1` ([database.js:1384](../server/src/database.js#L1384)) had to seed
occurrences on existing reservations for exactly the same reason. Each patch closed one road to the
cliff; the cliff is `return null`.

It also breaks [reservation-option-immutability.md](reservation-option-immutability.md) rule 1 head-on:
*« Once a reservation is created, its option set and all billed amounts are frozen »*. Here an
ordinary save deletes a line the guest has paid.

### 1.1 A fourth defect, this one already live in production

`buildReservationEngineInput` never passes `cardOccurrences`
([reservationEngineInput.js:64-68](../server/src/utils/reservationEngineInput.js#L64)). Every replay
built from it therefore hits the same `return null` — so **every** card-option line vanishes from it,
scheduled or not. The callers are `financeModel` (the « Suivi taxe de séjour » declaration),
`forceItemContribsCapture` (the per-bucket contribution capture at a payment flip) and
`neatSubscriptionRunner`.

Measured on a copy of the production database (2026-09-23, `DB_PATH` on a `VACUUM INTO` snapshot),
over the 13 bookings carrying a card option:

- **635 €** of option lines absent from every replay;
- **9,74 €** of tourist tax **over-declared** across 7 stays. Reservation 22226 declares 4,86 € where
  its fiche says 1,56 €; 22209 declares 13,56 € against 11,96 €.

  The mechanism is worth naming, because it decides which stays are hit: a platform booking pins
  `finalPrice` on the gross the guest paid, so the **accommodation absorbs** whatever the lines do
  not account for ([pricing.js:2160](../server/src/utils/pricing.js#L2160)). A card option that
  falls out of the replay does not lower the total — it enlarges the accommodation, and L'Estiva's
  tax is a percentage of it. Every stay that moves is in `percentage_accommodation` mode **and**
  carries a `platformGrossAmount`; the direct stays and the per-night-per-person ones declare the
  same before and after.

Injecting the stored occurrences into the same replay restores the fiche's own total to the cent
(22209: 331 € → 381 €, the stored value).

### 1.2 Damage assessment on production

- **Option lines: none.** No booking of public origin exists in production — `requestOrigin = 'public'`
  matches **0 row**, every reservation is `ical` (49) or `manual` (4), and all 17 card-option lines
  carry their occurrences. The online booking tunnel is not open yet
  ([cgv-acceptance-rollout](cgv-acceptance-rollout.md) gates it), so **no data repair is needed** —
  the bug is latent and will bite on the first site booking.
- **Contribution capture: none.** Every `acompteContribTtc` / `soldeContribTtc` on a card line is
  `NULL`; no wrong split was ever written.
- **Tourist tax: 9,74 € over-declared** on the declaration page, as above. The page recomputes live, so
  the fix corrects what it shows from the next read; whether a declaration already filed with the
  commune is worth correcting is an operating decision, not a code one.

## 2. Goal

An option the guest has paid for can never be erased by opening or saving a booking. When it was sold
without its moments — which is how the website sells it — GuestFlow says so, and the arrival SAS asks
the operator to place those moments with the guest if it has not already been done.

## 3. Functional rules

### 3.1 The line survives

1. **A taken card option always yields a line.** When an option with `showsPlanningCard = 1` is taken
   (`quantity > 0`) and carries **no occurrence**, the engine returns a normal option line priced on
   the portions it was sold at, marked `toBeScheduled: true` with `cardOccurrences: []` — for **every**
   caller, with or without `planningCardAsQuantity`. It is never `null`.
   _This generalises to options what [hourly-resource-quantity-and-sas-scheduling.md](hourly-resource-quantity-and-sas-scheduling.md)
   rules 1 and 3 already decided for hourly resources._
2. **Occurrences win over the quantity.** A non-empty selection prices the line
   `billedUnits = occurrences × served covers` exactly as today
   ([option-planning-card.md](option-planning-card.md) §3.4 rule 10/10bis). Nothing changes for a
   scheduled line.
3. **The portions the fallback bills are the ones the line was last sold at:**
   `billedUnits = locked.billedUnits ?? quantity`, where `locked` is the line's snapshot in
   `lockedOptionLines` — which every writer already passes (fiche save, devis update,
   `buildReservationEngineInput`). Consequences, all intended:
   - a site line keeps its exact 6 portions / 48 € through the conversion and every later save;
   - a **fresh** public request has no snapshot, so the visitor's quantity applies, in portions
     ([site-meal-portions.md](site-meal-portions.md) rule 1);
   - an admin line whose grid the operator empties keeps its billed portions instead of silently
     zeroing — removing the option is done with its switch, which already exists.
4. **`planningCardAsQuantity` stops deciding whether a line exists.** It keeps exactly one job: the
   public portion **cap and clamp** ([site-meal-portions.md](site-meal-portions.md) rule 3), which must
   not apply to an operator. The public controllers keep passing it; nothing else reads it for options.
5. **Superseded:** « an empty selection means the option isn't taken → no line »
   ([option-planning-card.md](option-planning-card.md) §3.4, test plan line 194) is replaced by rules 1
   and 3. An option is taken or not taken by its **switch**; its moments say *when* it is served, never
   *whether* it is sold.

### 3.2 Saying it, and planning it

6. **The summary marks it.** An option line with `toBeScheduled` renders an « à planifier » chip next to
   its name in `PricingSummary`, the same chip an unplaced hourly resource already uses
   ([PricingSummary.jsx:503-511](../client/src/components/PricingSummary.jsx#L503)). Display only, no
   effect on the total.
7. **The fiche shows the option as taken**, with its billed portions (« 6 petits déjeuners ») and an
   empty occurrence grid the operator may fill at any time. This needs no client change beyond rule 6:
   the line comes back in the quote, so the switch reads « on » again on its own.
   > **Sans test** — règle sans code : l'interrupteur se rallume parce que la ligne revient dans le
   > devis (règle 1, testée), `applyQuoteToForm` reconstruisant `selectedOptions` depuis
   > `quote.optionLines`. Vérifiée au navigateur sur la réservation 22293 (§7).
8. **The arrival SAS asks for the moments** — **différée, voir §8**. A card option that is on the
   reservation (not sold by this SAS) and still **unscheduled** opens a **planning** step instead of
   being hidden:
   > **Sans test** — règle non livrée dans ce changement : elle exige de retarifer une ligne déjà
   > payée depuis le SAS, chemin qui n'existe pas et qui porte ses propres questions d'argent (§8).
   > Elle est écrite ici parce que la décision est prise ; ses tests viendront avec sa spec.
   - it amends [sas-breakfast-and-catering-upsell.md](sas-breakfast-and-catering-upsell.md) rules 2
     and 8, which today close the step for good on any option « déjà prise à la réservation » — that
     rule was written for an option that is *already scheduled*, and it is kept for that case;
   - the step sells nothing. It shows what was paid (« 6 petits déjeuners payés »), the candidate
     moments grid, and a live counter « 4 / 6 planifiés »;
   - **nothing is pre-checked** — the moments are what the operator is asking the guest about, exactly
     as the catering sale page already does
     ([sas-breakfast-and-catering-upsell.md](sas-breakfast-and-catering-upsell.md) rule 7);
   - committing writes `cardOccurrences` on the **existing** line — no second line, the
     `PRIMARY KEY (reservationId, optionId)` is untouched, and the routing acompte/complément of the
     line is left exactly as it was;
   - **« Plus tard » is allowed** (the guest may not know yet, or it was settled by phone): the line
     stays unscheduled, keeps its money, and the fiche keeps saying « à planifier ».
9. **Planning fewer moments than were paid lowers the price, and it is said out loud.** The moments are
   authoritative (rule 2), so placing 2 mornings for 2 guests bills 4 portions and 32 € where 6 were
   sold. Whenever a card line's computed `billedUnits` differs from its `locked.billedUnits`, the
   engine reports the sold figure on the line (`soldUnits`) and the fiche summary shows
   « planifié 4 · vendu 6 » beside it, until the two agree again. The operator stays free; they can no
   longer do it without seeing it.

### 3.3 The replay

10. **`buildReservationEngineInput` passes the occurrences.** `selectedOptions` carries
    `cardOccurrences` (parsed from the stored JSON) and `cardPersons`, so a replay of a saved
    reservation reproduces its own card lines. This is what fixes the 9,74 € of over-declared tourist
    tax and the 635 € of lines missing from `financeModel`, `forceItemContribsCapture` and
    `neatSubscriptionRunner`.

**Edge cases:**

- Option switched off (`quantity = 0`) → no line, unchanged. That is the only way to remove it.
- Stay with **no night** → the engine returns before any option line is built
  ([pricing.js](../server/src/utils/pricing.js), the `nights <= 0` branch), so the fallback needs no
  guard of its own and none was added.
- No dates yet → no quote at all, unchanged.
- Offered line / free units → applied to `billedUnits` on the fallback path exactly as on the
  occurrence path.
- A line already scheduled → rules 1, 3, 6, 8 and 9 are inert; it behaves exactly as today.
- SAS re-opened after a commit → the planning step re-opens on the occurrences it wrote, like every
  other SAS step ([reopen-completed-sas.md](reopen-completed-sas.md)).
- `soldUnits` (rule 9) is a **display** field: it never enters a total, and it disappears once the save
  makes the snapshot agree with the planning.

---

## 4. Architecture

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `utils/` | `pricing.js` | T | Card branch: the quantity fallback no longer depends on `planningCardAsQuantity` (rules 1, 3, 4); `soldUnits` on a line whose planning differs from its snapshot (rule 9); the no-candidate-day guard |
| `utils/` | `reservationEngineInput.js` | T | `selectedOptions` carries `cardOccurrences` + `cardPersons` (rule 10) |
| `utils/` | `sasOptionSale.js` | T | _(rule 8, deferred)_ A booked-but-unscheduled card option becomes a **planning** offer instead of being filtered out |
| `controllers/` | `sasController.js` | T | _(rule 8, deferred)_ Relays the planning intent of the new step to the model |
| `models/` | `reservationsModel.js` | T | _(rule 8, deferred)_ `commitArrivalSas` writes the placed moments on the existing line **and re-prices it** |
| `routes/`, `middleware/`, `scheduledTasks.js`, `database.js` | — | — | (none — no schema change, no migration) |

The two lines actually shipped are `pricing.js` (a single `return null` removed, the fallback anchored
on the line's own snapshot, `soldUnits` reported) and `reservationEngineInput.js` (two columns added to
a SELECT). Everything else in this spec is a consequence of those.

**Notes:** `pricing.js` keeps reading `planningCardAsQuantity` for the public cap only (rule 4); the
flag is not removed from any caller's payload.

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `components/` | `PricingSummary.jsx` | T | « à planifier » chip on an option line (rule 6) and the « planifié N · vendu M » mention (rule 9) |
| `components/sas/` | `SasOptionSchedulingPage.jsx` | C | _(rule 8, deferred)_ The SAS planning step: what was paid, the moments grid, the « N / M planifiés » counter, « Plus tard » |
| `components/sas/` | `ReservationSasDialog.jsx` | T | _(rule 8, deferred)_ Inserts the step when the payload offers one |
| `pages/`, `hooks/`, `services/`, `utils/`, `constants/`, `styles/` | — | — | (none — the fiche needs no change: the line returns in the quote) |

**Component reuse declaration:**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing generic)** | `OccurrenceGrid`, `StatusBadge` | The same grid the fiche and the SAS sale pages already render; the chip vocabulary of the unplanned hourly resource. |
| **Created (new generic)** | — | None. |
| **Specific (kept feature-local)** | `SasOptionSchedulingPage` | A SAS step, like `SasResourceSchedulingPage` beside it — it is a composition of `OccurrenceGrid` plus the SAS's own step chrome, and only the SAS has steps. |

### 4.3 API contract

| Method | Endpoint | Change |
|---|---|---|
| POST | `/api/reservations/calculate-price` | Option lines may now carry `toBeScheduled: true` with `cardOccurrences: []` on any flow (additive), and `soldUnits` when the planning differs from the snapshot (additive) |
| PUT | `/api/reservations/:id`, `PUT /api/devis/:id` | Same line shape; a card option with no occurrence is **kept** instead of dropped |
| GET | `/api/reservations/:id/sas` | New `optionScheduling` block: the card options booked and not yet placed, with their candidate moments and their paid portions |
| POST | `/api/reservations/:id/sas/arrival` | Accepts the placed moments for those options (tri-state, like every other SAS step: absent = the step never ran) |

No public (`/public/v1/**`) contract changes.

---

## 5. Data model

**No schema change, no migration.** `reservation_options.cardOccurrences` already exists and already
accepts `NULL`; this spec stops treating `NULL` as « the option is gone ».

**Data impact:** none on stored rows. The audit (§1.2) found no production booking to repair.

## 6. UI / UX

**Fiche — « Résumé tarifaire ».** The option line reads « Petit déjeuner » with an « à planifier » chip
(amber, the resource chip's own styling), the portions on the second line (« 6 petits déjeuners ») and
its amount. Once the operator ticks moments, the chip goes; if what is planned differs from what was
sold, a caption « planifié 4 · vendu 6 » sits under the title until they agree.

**Fiche — options card.** Unchanged code: the switch is on, the occurrence grid is empty and tickable,
the « Personnes servies » field behaves as today.

**Arrival SAS — new step « Petit déjeuner : quels matins ? »** _(rule 8, deferred — §8)_, placed with
the other card-option steps.
Copy: title « Petit déjeuner », line « 6 petits déjeuners payés à la réservation », the moments grid,
a counter « 0 / 6 planifiés » that follows the ticks, and two buttons — « Valider les matins » and
« Plus tard ». Nothing is pre-checked. When the counter differs from the paid figure, a caption says
« 4 planifiés sur 6 payés — le montant suivra ce qui est planifié. »

**Responsive.** The SAS is a phone-first wizard: the step reuses `OccurrenceGrid`, which already wraps
its chips on `xs` and sits in the dialog's `fullScreen` mode below `sm`. The summary chip and the
« planifié · vendu » caption wrap under the line title on `xs`, no new column, no horizontal scroll.
Desktop identical to the existing steps.

**`PageActionBar`.** No page-level action changes: the fiche keeps its bar as-is, and the SAS is a
dialog, not a page.

## 7. Test plan

### Server unit tests

- [x] `tests/unscheduled-card-option.unit.test.js` (15 tests) — rule 1 (no occurrence + no flag → a
      line, not `null`, `toBeScheduled`, and the reproduction's 348 €), rule 2 (occurrences still
      win), rule 3 (the snapshot anchors the portions; a fresh quantity applies with no snapshot; an
      emptied admin grid keeps its portions; a non-per-person card bills its quantity), rule 4 (the
      public cap still clamps, an operator never does, the visitor's quantity wins on the public
      flow), rule 5 (switch off → no line), rule 9 (`soldUnits` present when planning ≠ snapshot,
      absent when they agree or when nothing is placed), edges (offered line, served covers).
- [x] `tests/reservation-engine-input-card-options.unit.test.js` (5 tests) — rule 10: a replay
      reproduces a scheduled card line and the stored `finalPrice`; the taxable base is the fiche's,
      not one inflated by the missing service; `cardPersons` rides along; an unscheduled line replays
      on its sold portions; a schema without the two columns still builds an input.
- [x] Three suites that pinned the superseded behaviour were **inverted**, not deleted:
      `pricing-option-planning-card` (« no selected occurrences → no line » → the line survives, plus a
      new case for the switch), `planning-card-public-pricing` (« still dropped » → keeps its line) and
      `payment-link-quote-parity` (the naive input no longer loses the meal, it mis-bills it).
- [ ] _(rule 8, deferred)_ `tests/sas-card-option-scheduling.unit.test.js`.

### Client tests (vitest)

- [x] `components/__tests__/PricingSummary.card-scheduling.test.jsx` (4 tests) — rules 6 and 9.
- [ ] _(rule 8, deferred)_ `components/sas/__tests__/ReservationSasDialog.option-scheduling.test.jsx`.

### Full suites

- [x] `cd server && npm test` — 4305 passed, 0 failed.
- [x] `cd client && npx vitest run` — 180 files, 1304 passed.
- [ ] `npm run test:e2e` — **not run**: the suite pins the client to port 3000, held by another
      workspace's dev server. To be run before merge.

### Manual UI verification

- [x] **The reproduction of §1, replayed after the fix**: `/public/v1/booking-requests` with 6
      breakfasts → conversion (reservation 22293) → the fiche opens at **355,20 €** (348 € + taxe)
      with « Petit déjeuner ×6 · à planifier · 48,00 € » → « Enregistrer » → the line is still in
      `reservation_options` (6 portions, 48 €) and `finalPrice` is still 348 €.
- [x] Ticking one morning → « planifié 2 · vendu 6 » on the summary line, 16,00 €, the « à planifier »
      chip gone.
- [x] Switching the option off → the line goes, as it should: that is the one gesture that removes it.
- [x] Mobile (390 px): the mention wraps under the line title, no horizontal scroll.
- [ ] _(rule 8, deferred)_ The arrival SAS planning step.

## 8. What this change left out

**Rule 8 — the arrival-SAS planning step — is not shipped here**, and the reason is worth writing
down because it was found at implementation, after the rule was agreed.

The decision of 2026-09-23 was that « Valider les matins » places the moments **and re-prices** the
line when the operator plans fewer portions than were paid. Placing the moments alone is not an
option: the engine rebuilds a card line from its moments, so a line stored with 2 mornings and
6 billed portions would read 48 € in the accounting snapshot and 32 € on the fiche — « one stay, two
amounts in two screens », the exact drift this codebase keeps fighting.

Re-pricing it from the wizard needs a path that does not exist: outside the fiche's own update flow,
nothing recomputes and persists a booked line. The SAS's existing writer handles **its own** sales
(`sasArrivalOrigin = 1`, routed to the complement, totals moved by a delta); a booked line routed to
the acompte/solde is another matter, and on a site booking it is a line the guest has **already paid
in full**, so lowering it creates an overpayment that GuestFlow does not surface on its own.

That is a feature with its own money semantics — re-pricing, the refund it implies, and a durable
record of the gap between what was sold and what was served (rule 9's mention only lives until a save
reconciles the two figures). It deserves its own spec rather than a corner of a bug fix. **The bug
this spec was opened for is fixed and verified without it**; an unplanned line keeps its money and
says « à planifier » on the fiche, which is what stops the loss before the website opens.

## 8bis. Out of scope

- **Carrying `requestOrigin` onto the reservation.** Deliberately not part of the fix: a paid line must
  survive whoever created the booking, so the correction must not depend on knowing the origin. Copying
  the column is useful for other reasons (badging a site booking) and belongs to its own change.
- **A durable record of the gap between what was sold and what was served.** Rule 9's mention lives as
  long as the two figures disagree and goes once a save reconciles them; `reservation_history` keeps the
  trace. A permanent « vendu / servi » on the line is a bigger idea (it would touch the invoice) and is
  not opened here.
- **The other replay drifts.** With the occurrences restored, two of the thirteen audited bookings still
  replay above their stored total (22194: 147,50 € vs 102,50 €; 22196: 174,29 € vs 168,57 €). That is a
  different cause, unrelated to card options, and is left for its own investigation.
- **Letting the website visitor choose the mornings** — still « à planifier avec l'hôte »
  ([site-meal-portions.md](site-meal-portions.md) §8).
- **The breakfast prep count** ([breakfastModel.js:136](../server/src/models/breakfastModel.js#L136))
  still assumes the whole party until the line is scheduled.

## 9. Open questions

- Q: How is the line prevented from vanishing? — **A (2026-09-23):** generalise the quantity mode to
  every caller, as was already done for hourly resources; `planningCardAsQuantity` stops being a
  condition (rules 1, 3, 4).
- Q: What does the fiche show for a line that is not yet planned? — **A (2026-09-23):** the option on,
  its portions, an « à planifier » chip — **and** the arrival SAS must ask for the moments if it has not
  been settled beforehand (rule 8).
- Q: The replay gap (635 €, 9,74 € of tourist tax) — here or in its own spec? — **A (2026-09-23):** here
  (rule 10); it is the same defect and the only one already doing damage.
- Q: What if the operator plans fewer moments than were paid? — **A (2026-09-23):** the planning is
  authoritative and the price follows, but the fiche says it out loud (rule 9).
