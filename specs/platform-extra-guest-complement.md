# Extra guests added after a platform booking — billed as a complement

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/platform-extra-guest-complement` _(user-managed)_ |
| **Created** | 2026-10-22 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |

---

## 1. Context

A platform reservation (iCal import, or a platform fiche entered by hand) arrives with the party the
platform sold. Afterwards the guest often announces more people (a friend joins, a child was not
declared). When the new party exceeds the property's free guests (`basePriceIncludedGuests`), the
extra-guest supplement must be collected from the guest on arrival: the platform never charged it.

Today the engine computes the supplement (`computeExtraGuestSurcharge`, `server/src/utils/pricing.js`)
but on a platform reservation with a brut it is **taken out of the brut**
(`pinnedAccommodation = brut − extraGuestSurcharge − …`, `pricing.js` ≈ l. 2243). Adding a guest only
shrinks the accommodation share: the total does not move, nothing lands in the complement, and the
arrival SAS shows nothing to collect.

The composition of an iCal import is not reliable either: the Booking.com feed carries no guest count
(the import defaults to 1 adult), and the real composition is entered afterwards from the extranet,
together with the platform amounts (`platform-booking-intake` skill). Those guests are paid.

## 2. Goal

When guests are added to a platform reservation after its platform amounts were entered, the matching
supplement is added automatically to the arrival complement, appears in the arrival SAS recap, and can
still be offered. The operator keeps a single way of working: the usual composition fields.

## 3. Functional rules

### 3.1 No supplement before the platform amounts

1. On a **non-direct** reservation (`!isDirectChannel(platform)`) whose **brut is not entered**
   (`platformGrossAmount` NULL), **no extra-guest supplement is counted**: `extraGuestSurcharge = 0`,
   whatever the composition. The composition can be filled and corrected freely.
2. Direct reservations are untouched. « Direct » means `isDirectChannel(platform)` — `direct` **and**
   `lodgify` (the own-site channel): a Lodgify reservation without brut keeps its supplement.
2bis. The paid base and the split (§3.2–3.3) apply wherever the engine pins a brut today
   (`platformGrossPin != null`, i.e. `platform !== 'direct'` with a brut entered), Lodgify included, so a
   brut is never split two different ways.

### 3.2 The paid base is captured when the brut is entered

3. **No new field for the operator.** The composition fields stay the only input (decision
   2026-10-22). The engine keeps, internally, the persons the platform billed: `platformPaidGuests`.
4. It is **captured automatically on the save where the brut goes from empty to entered**, from the
   composition of that same save: adults + teens + children, **babies excluded** (same `persons` as
   `pricing.js`).
5. **Changing an already-entered brut does not move it**: correcting a typo in the amount must not
   swallow guests added since. **Clearing the brut clears it** (back to rule 1); entering it again
   captures the composition of that moment.
6. Switching the reservation to « direct » clears it.

### 3.3 The split of the supplement

7. With `included = basePriceIncludedGuests` (or the locked tariff's) and `paid = platformPaidGuests`:
   - `extraGuestCount = max(0, persons − included)` — unchanged;
   - `complementGuests = max(0, persons − max(included, paid))`;
   - `inBrutGuests = extraGuestCount − complementGuests`.
8. **Amounts:** `inBrutSurcharge = surcharge(inBrutGuests)`,
   `complementSurcharge = surcharge(extraGuestCount) − inBrutSurcharge`, both through
   `computeExtraGuestSurcharge` with the same unit, price, tiers and locked tariff. Added guests are
   therefore the highest-ranked ones when tiers apply.
9. **Only `inBrutSurcharge` is subtracted from the brut** in the accommodation back-solve. The
   complement part is added on top of the total.
10. **The complement part lives 100 % in the arrival Complément bucket** (`inComplement = 1`, NULL
    acompte/solde contributions), like any extra on a platform reservation
    (`force-extras-complement-on-platform.md`). It is stay revenue at the accommodation VAT rate.
11. **Recomputed on every save** — adding guests raises the line, removing guests lowers it, and it
    disappears when `persons ≤ max(included, paid)`.
12. A complement **already marked collected** is frozen as today (`frozen-complement-trusts-client.md`):
    a later change of composition does not rewrite collected money.

### 3.4 Offering it

13. **The existing « Offrir » toggle** (`extraGuestSurchargeOffered`) applies, on a non-direct
    reservation, **to the complement part only**: the in-brut part was paid on the platform and is never
    « offered ». Direct reservations keep today's meaning.
14. **Offered = lossless**: the line shows its real price struck through and counts 0 €, like every
    other offered complement line (`sas-offer-complement-lines.md` rules 2–3).
15. Offering survives a change of composition: the flag stays, the amount it hides is recomputed.

### 3.5 Where it appears

16. **Fiche — pricing summary**: a line « Voyageurs ajoutés · N pers. » with the « Complément » chip and
    the « Offrir » toggle, separate from the in-brut supplement.
17. **Arrival SAS recap**: listed with the in-complement extras, offerable (new offerable kind
    `extraGuests`). The SAS **never edits the composition** (decision 2026-10-22); it only shows and
    offers the line, decided in memory and written at the single commit.
18. **Departure SAS**: when the arrival complement is still unpaid, the line is recalled with the other
    arrival lines (`recall-unpaid-arrival-complement-at-checkout.md`) and stays offerable there.
19. Every surface that itemises the arrival complement (J-2 email complement line, payment link) shows
    the line, because it is part of the quote's complement lines — no surface-specific code.

**Edge cases:**
- Booking import with 1 default adult, composition set to 4 adults before the brut → no supplement.
- Intake saves 4 adults and the brut together → paid = 4, no complement.
- Paid = 4, included = 2, composition 4 → 5 → one guest in complement.
- Paid = 1, included = 2, composition 1 → 3 → one guest in complement (the first extra guest is above
  the free count, not above the paid count).
- A baby added → no change (babies never count).
- Composition shrinks below paid → no complement; the in-brut part follows today's rule.
- Brut corrected from 600 to 610 € → paid unchanged, added guests stay in complement.
- Brut cleared → no supplement at all (rule 1).

---

## 4. Architecture

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `utils/` | `pricing.js` | T | Rule 1 (no supplement before the brut); `splitExtraGuestCount` + split of the amounts (rules 7–10, 13); `extraGuests` complement line; quote fields `extraGuestInBrut*`, `extraGuestComplement*`, `platformPaidGuests` |
| `utils/` | `platformPaidGuests.js` | C | `resolvePlatformPaidGuests(stored, body)` — capture / keep / clear (rules 4–6); `isBrutPinned` shared with the engine |
| `controllers/` | `reservationsController.js` | T | Capture / keep / clear `platformPaidGuests` on save (rules 4–6); pass it to the quote |
| `models/` | `reservationsModel.js` | T | `persistExtraGuestComplement` writes the three columns from the quote (a collected complement keeps its amount, rule 12); SAS commits accept the `extraGuests` offered ref |
| `controllers/` | `sasController.js` | T | `extraGuests` joins `OFFERABLE_KINDS`; line included in the recap payload |
| `models/` | `reservationsModel.js` — `arrivalComplementDetailFromReservation` | T | Itemise a stored `extraGuests` line (amount, count, offered) instead of letting it fall into the « Complément d'arrivée » remainder; `applyOfferedComplementExtras` gets an `extraGuests` branch |
| `utils/` | `complementAllocation.js` | T | `POSTE_BY_KIND.extraGuests` → accommodation revenue account |
| `utils/` | `reservationEngineInput.js` | T | Replay `platformPaidGuests` when the quote is rebuilt from the stored row (finance, Neat, contribs capture) |
| `database.js` | | T | Idempotent `ADD COLUMN` × 3 + backfill (§5). `schema.sql` is the frozen baseline and is not touched, like every column added since. |

The iCal import is not touched: an imported reservation has no brut, so rule 1 covers it.

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `components/` | `PricingSummary.jsx` | T | `ExtraGuestRow` (file-local): in-brut part without « Offrir » on a pinned brut, added guests with the Complément chip and « Offrir » |
| `components/` | `sas/ReservationSasDialog.jsx` | T | Render the `extraGuests` recap line; offered ref in the commit payload |

**Component reuse declaration:**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing generic)** | the recap's offerable row, `PricingSummary` toggle | No new component, no new input. |
| **Created (new generic)** | — | |
| **Specific (kept feature-local)** | — | |

The client computes nothing: counts, amounts and the line come from the quote.

### 4.3 API contract

| Method | Endpoint | Request body | Response | Notes |
|---|---|---|---|---|
| POST/PUT | `/api/reservations[/:id]` | unchanged | reservation + quote | `platformPaidGuests` is server-owned, never read from the body |
| POST | `/api/reservations/quote` | unchanged | `+ extraGuestComplementCount`, `extraGuestComplementSurcharge`, `extraGuestComplementOriginal` | additive |
| GET | `/api/sas/:id` | — | recap lines `+ { kind: 'extraGuests', … }` | additive |
| POST | `/api/sas/:id/arrival` (and departure) | offered refs accept `{ kind: 'extraGuests', id: 0 }` | — | sets `extraGuestSurchargeOffered` |

---

## 5. Data model

- `reservations.platformPaidGuests INTEGER NULL` — idempotent migration in `database.js`.
- `reservations.extraGuestComplementSurcharge REAL NOT NULL DEFAULT 0` and
  `extraGuestComplementCount INTEGER NOT NULL DEFAULT 0` — the complement part's real (un-offered)
  amount and its number of guests, written on every save from the quote. The arrival-complement detail is built from
  stored rows (SAS recap, J-2 email, checkout), not from a live quote, so the amount has to be stored like
  `complementAmount` is.
- **Backfill, once:** every non-direct reservation with a brut gets the persons of its current
  composition. Its total is unchanged (`persons = paid` → no complement); only guests added from now
  on are billed.
- Non-direct reservations **without** a brut lose their extra-guest supplement (rule 1). Their total
  drops by that amount until the brut is entered; it was never collectable money.

**Data impact:** no change on reservations with a brut; non-direct reservations without a brut drop the
supplement from their provisional total. Documented under `Migration` in the changelog fragment.

## 6. UI / UX

- **Fiche**: no new field. The pricing summary shows « Voyageurs ajoutés · 1 pers. » — amount,
  « Complément » chip, « Offrir » / « ✓ Offert », caption « Au-delà des 4 personnes payées à la
  plateforme ».
- **Arrival SAS recap**: same label among the in-complement lines, same toggle as the other lines.
- **Mobile (xs)**: rows already stack; the toggle wraps under the amount.
- No `PageActionBar` change.

Interactive summary: `docs/specs/2026-10-22-platform-extra-guest-complement.html`.

## 7. Test plan

### Server unit tests — `server/src/tests/platform-extra-guest-complement.unit.test.js` (16 tests)
- [x] Rules 1–2: non-direct without brut → supplement 0; direct and Lodgify unchanged.
- [x] Rules 4–6: capture on first brut (babies excluded), kept on a correction, cleared with the brut and on switch to direct, re-captured.
- [x] Rules 7–8: split with included/paid combinations, per-stay and per-night (tiers rank nights, not guests: the split is linear).
- [x] Rule 9–10: back-solve subtracts only the in-brut part; the added guests stay out of the pre-arrival split.
- [x] Rule 11: composition up then down → line rises, falls, disappears.
- [x] Rule 13: offered hides the complement part only, original preserved; direct unchanged.
- [x] Rule 17: stored detail line with its ref; arrival commit offers and un-offers it.
- §5 backfill: an `UPDATE` inside the migration guard, totals unchanged by construction (`persons = paid`).

### Client (Vitest)
- [x] `ReservationSasDialog.extra-guests.test.jsx` (3) — line and total, offer → ref in the commit, reopened « ✓ Offert ».
- [x] `PricingSummary.extra-guest-complement.test.jsx` (2) — split rows, no « Offrir » on the in-brut part.
- `PricingSummary.extra-guest-tiers.test.jsx` fixtures gained the server's in-brut fields.

### Manual UI verification
- [ ] iCal Booking reservation: composition 4 → no supplement; enter the brut; 5 adults → line on the
      fiche and in the arrival SAS; offer it; commit.
- [ ] Edge: a baby added → nothing; brut corrected → line kept.
- [ ] Mobile (375 px): fiche summary and SAS recap.
- [ ] Regression: direct reservation supplement and its « Offrir » unchanged.

## 8. Out of scope

- Editing the composition from the SAS (decision 2026-10-22).
- A field showing or editing the paid base (decision 2026-10-22: one way of working).
- Taxe de séjour of added guests (already follows the composition).
- Notifying the guest automatically (`no-automatic-email-without-approval.md`).
- **Pre-existing, found while planning (2026-10-22):** the quote's VAT split
  (`accommodationVatAmount`, `totalVatAmount`) leaves `extraGuestSurcharge` out. The new complement line
  inherits that gap; fixing it changes every reservation with a supplement and gets its own spec.

## 9. Open questions

- Q: How is the paid base known? → **A (2026-10-22):** no dedicated field; the composition at the
  moment the platform amounts are entered. Before that, no supplement.
- Q: Trigger from the SAS? → **A (2026-10-22):** no, the SAS does not edit the composition.
- Q: Persons removed afterwards? → **A (2026-10-22):** the line is recomputed (rule 11).
- Q: Brut corrected afterwards? → **A (2026-10-22):** the paid base does not move; clearing the brut
  resets it (rule 5).
- Q: Existing platform reservations? → **A (2026-10-22):** with a brut, the paid base is backfilled from
  the current composition (§5).
