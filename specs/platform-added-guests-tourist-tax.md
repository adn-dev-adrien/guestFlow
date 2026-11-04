# Tourist tax of guests added after a platform booking — collected in the complement

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/platform-added-guests-tourist-tax` |
| **Created** | 2026-11-03 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |

---

## 1. Context

[platform-extra-guest-complement.md](platform-extra-guest-complement.md) bills the accommodation
supplement of guests added after the platform amounts were entered. Its §8 set the tourist tax aside
as « already follows the composition ». On a platform in mode `platform_reversed` (it collects the tax
from the guest and wires it to us) that is false: the platform collected and reversed the tax of the
party it sold, and nobody collects the rest. We still owe the whole tax to the commune.

Measured on the engine (`origin/master`, 2026-11-03): brut 600 €, 2 nights, 2 free guests,
1,20 €/adult/night, supplement 20 €/guest/night, party going from 2 to 3 adults.

| Mode | Accommodation | Tax | Complement | Effect |
|---|---|---|---|---|
| `platform_reversed` | 595,20 → **592,80** | 4,80 → 7,20 | 40,00 | **defect:** the 2,40 € leaves the accommodation: revenue falls, the declared tax rises, the guest pays nothing |
| `platform` | 600,00 | 0 | 40,00 | out of scope (decision 2026-11-03) |
| `owner` | 600,00 | 4,80 → 7,20 | 47,20 | correct: the tax already rides the complement |

## 2. Goal

On a platform that reverses the tourist tax to us, when guests added after the platform amounts raise
the tax, the difference is collected from the guest in the arrival complement, on its own line, and it
is declared to the commune. The accommodation no longer pays for it.

---

## 3. Functional rules

### 3.1 The base the platform paid for

1. **The engine keeps the adults the platform billed**, `platformPaidAdults`, beside the existing
   `platformPaidGuests`. Same lifecycle as
   [platform-extra-guest-complement.md](platform-extra-guest-complement.md) rules 4–6: captured on the
   save where the brut goes from empty to entered, kept when the brut is corrected, cleared with the
   brut and on a switch to direct, never read from a request body. No new field for the operator.

### 3.2 The amount

2. **Added tax = tax of the current party − tax of the paid party**, floored at 0. Both go through
   `computeTouristTaxBreakdown` with the same property settings, nights and base. The paid party is
   `platformPaidAdults` adults and `platformPaidGuests` occupants. Comparing two engine figures keeps
   the platform's own figure out of it: a platform rate that differs from ours never
   produces a complement on an unchanged party.
3. **It applies only when** the brut is pinned, the paid base is known and the platform's GLOBAL tax
   mode is `platform_reversed`. The condition reads the mode, **never a platform name** (decision
   2026-11-03). `platform`, `owner` and direct reservations are byte-identical to today.
4. **Rounding is not a sale.** On a percentage property the unit amount is rounded to the cent, so
   adding an adult moves the total by a few cents with no real change (27,28 → 27,30). A difference no
   larger than `0,01 € × nights × current adults` counts as 0.
5. **Only what the tax counts, counts.** A child, a teen or a baby added on a per-person property adds
   nothing. Adults replacing minors with the same head count does add tax, with no supplement.
6. **Recomputed on every save**: it rises, falls and disappears with the party.
7. **A collected complement stops moving.** With `complementPaid = 1` the engine reads the stored
   amount instead of recomputing it, and a guest added after that changes neither the tax nor the
   accommodation, exactly like the supplement
   ([platform-extra-guest-complement.md](platform-extra-guest-complement.md) rule 12).
7bis. **A frozen tax does not stop it** (decision 2026-11-03). With the balance paid or the tax ticked
   « Déclarée » ([tourist-tax-matches-the-office-calculation.md](tourist-tax-matches-the-office-calculation.md)
   rules 10–13), the frozen amount is what the platform reversed and what the commune was told, and it
   does not move. Guests added after that still produce an added tax, in the complement, on top:
   - the frozen part is `frozen total − stored added tax`, because the frozen total already contains
     the added tax of the last save;
   - the added tax is computed from the current party against the paid party, on the frozen base, with
     the live occupant count;
   - `touristTaxTotal = frozen part + added tax`.

### 3.3 Where the money goes

8. **The added tax lives 100 % in the arrival complement**, on top of the brut, never inside it.
9. **`touristTaxTotal` stays the full tax; only `touristTaxTotal − addedTax` is subtracted from the
   brut.** The accommodation stops shrinking, and the fiche's revenue no longer depends on the party.
   Example above: accommodation 595,20, tax 7,20, complement 42,40, total 642,40.
10. **It cannot be offered.** It is a debt to the commune: same reason as the untouchable tax poste of
    [adjustable-complement-amounts.md](adjustable-complement-amounts.md) rule 32. Offering the
    supplement leaves the tax line in place, and the complement adjustment cannot go below it.

### 3.4 What is declared and booked

11. **Declaration gate.** The added tax enters « Suivi taxe de séjour » only once the complement is
    paid. A complement never collected is never declared, as today. The row of the stay keeps its
    balance gate and its date, and its amount counts the added tax only when the complement is paid.
12. **A declaration already made does not move.** When the added tax is collected after the stay's row
    was ticked « Déclarée », the row keeps its amount and the added tax gets **a row of its own** in the
    month of `complementPaidDate`, with the added adults as person-nights and its own « Déclarée » tick:
    that is the only form the commune can be told the difference in.
13. **Accounting.** The added tax is booked on `46710000` with the complement entry (poste `tax` of
    `complementAllocation`), and the balance entry carries `touristTaxTotal − addedTax`. A cash
    complement stays off the books, as today.

### 3.5 Where it appears

14. **Fiche — pricing summary:** a line « Taxe de séjour · voyageurs ajoutés » with the amount and the
    « Complément » chip, under the existing tax line. No « Offrir ».
15. **Arrival SAS recap, departure recall, J-2 email, payment link:** the existing `tax` line of the
    complement detail, fed by `touristTaxInComplementAmount`, which gains the added tax. No
    surface-specific code.

### 3.6 The solde can still be marked paid

16. **Marking the solde paid works on a fiche with added guests.** Found on 2026-11-03 replaying the
    real path on `origin/master`: the payment capture counted the added guests' supplement
    ([platform-extra-guest-complement.md](platform-extra-guest-complement.md) rule 10) in the
    accommodation of the solde, found 640 € against the 600 € stored, and refused the flip with a 409.
    The supplement and the added tax are collected with the complement, so neither enters the solde's
    capture.

### 3.7 On `inte/plugins` (sync of v3.21.0, 2026-11-04)

17. **The export lives in the `accounting-export` plugin, and a paid solde keeps what it collected**
    ([accounting-books-the-money-collected.md](accounting-books-the-money-collected.md) rule 13). When
    the solde's contribs describe it, the balance entry books the frozen tax and the complement entry
    `touristTaxTotal − frozen`, which already holds the added tax; only a solde without trustworthy
    contribs reads `touristTaxTotal − addedTax` and `addedTax`. Plugin `accounting-export` 1.0.24.
18. **The stored-money readers of a solde leave the addition out too.** The stored split of a capture
    that failed (`captureStoredSplit`) takes the added guests' supplement out of the accommodation it
    shares against, so the lines are not under-credited; `bookedStayBuckets` of a cancelled stay reads
    the solde's tax without the added tax.

**Edge cases:**
- iCal import with 1 default adult, composition set to 4, then the brut → paid = 4, no added tax.
- Intake saves 4 adults and the brut together → no added tax.
- Brut corrected → paid base unchanged, added tax kept. Brut cleared → no added tax.
- Tax forced to the complement by the operator (`touristTaxInComplement`) → the whole tax is already
  there, the added share is a part of it, nothing is counted twice.
- Added tax already collected, more guests added → stored amount kept, as the supplement does (rule 7).
- Balance paid, then a guest added → frozen part unchanged, added tax in the complement (rule 7bis).
- Tax frozen with an added tax already in it, fiche saved again → no double count (rule 7bis).

---

## 4. Architecture

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `utils/` | `pricing.js` | T | Rules 2–9: added tax, split of the routing, complement detail, quote fields `touristTaxAddedGuestsAmount`, `platformPaidAdults` |
| `utils/` | `platformPaidGuests.js` | T | `resolvePlatformPaidAdults(stored, body)`, same lifecycle as the guests |
| `utils/` | `reservationEngineInput.js` | T | Replay the paid adults and the stored added tax |
| `controllers/` | `reservationsController.js` | T | Capture the paid adults on quote, create and update |
| `models/` | `reservationsModel.js` | T | Persist the two columns beside `persistExtraGuestComplement`; `touristTaxInComplementAmount` gains the added tax |
| `models/` | `financeModel.js` | T | Rules 11–12: gate, amount, own row of the declaration |
| `plugins/accounting-export/` | `accountingModel.js` | T | Rules 13, 17: split the tax between the balance and the complement entries |
| `utils/` | `cancelReservation.js` | T | Rule 18: a solde's booked tax leaves out the added tax |
| `utils/` | `forceItemContribsCapture.js` | T | Rules 13, 16, 18: the solde's capture and stored split leave out the added tax and the added guests' supplement |
| `controllers/` | `financeController.js` | T | Rule 12: forward `addedGuests` to the tick |
| `database.js` | | T | Idempotent `ADD COLUMN` × 3 + backfill (§5) |

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `components/` | `PricingSummary.jsx` | T | Rule 14: render the line from the quote |
| `pages/` | `TouristTaxPage.jsx` | T | Rule 12: render the added-guests row with its own tick |
| root | `api.js` | T | `setTouristTaxDeclared` carries `addedGuests` |

**Component reuse:** consumes the existing rows and chip of `PricingSummary`. No new component, no new
input. The client computes nothing.

### 4.3 API contract

| Method | Endpoint | Request body | Response | Notes |
|---|---|---|---|---|
| POST/PUT | `/api/reservations[/:id]` | unchanged | reservation + quote | `platformPaidAdults` is server-owned |
| POST | `/api/reservations/quote` | unchanged | `+ touristTaxAddedGuestsAmount`, `platformPaidAdults` | additive |
| GET / POST | tourist-tax declaration page and its tick | an added-tax row is ticked on its own | `+ addedGuestsRow` on the extra row | additive (rule 12) |

---

## 5. Data model

- `reservations.platformPaidAdults INTEGER NULL`.
- `reservations.touristTaxAddedGuestsAmount REAL NOT NULL DEFAULT 0`.
- `reservations.touristTaxAddedGuestsDeclaredAt TEXT NULL` — the tick of the row of rule 12.
- **Backfill, once:** every non-direct reservation with a brut gets its current adults as
  `platformPaidAdults`. The added tax is then 0 and **no stored amount moves**. Guests already added
  before this release are not billed retroactively.

**Data impact:** none on existing amounts. Documented under `Migration` in the changelog fragment.

## 6. UI / UX

- One new line in the pricing summary, under the tax line. No new field, button or dialog.
- **Mobile (xs):** the row stacks like the other complement rows; no horizontal scroll.

Interactive summary: `docs/specs/2026-11-03-platform-added-guests-tourist-tax.html`.

## 7. Test plan

### Server unit tests — `platform-added-guests-tourist-tax.unit.test.js` (15), `platform-added-guests-tourist-tax-books.unit.test.js` (5), `plugins/accounting-export/tests/platform-added-guests-tourist-tax-books.unit.test.js` (6), `platform-added-guests-stored-readers.unit.test.js` (1)
- [x] Rule 1: capture, keep on a corrected brut, clear, re-capture; body value ignored.
- [x] Rules 2–5: amount per mode and per tax mode, a platform rate that differs, rounding noise, minors.
- [x] Rules 6–7bis: rises and falls; stored amount kept once the complement is collected; frozen tax + guest added → line in the complement, frozen part unchanged, no double count on the next save.
- [x] Rules 8–9: the example of §1 to the cent; accommodation independent of the party. Modes `platform`, `owner` and direct unchanged to the cent.
- [x] Rule 10: offering the supplement keeps the tax.
- [x] Rules 11–12: declaration before and after the complement is paid; own row after a declared one.
- [x] Rule 13: balance and complement entries sum to the tax.
- [x] Rule 16: the solde's capture succeeds with added guests and books what the platform paid.
- [x] Rule 17: frozen solde + addition, untrustworthy contribs, and the whole path through the controllers to the journal (46710000 = 4,80 + 2,40).
- [x] Rule 18: stored split with a line, booked solde of a cancelled stay.
- [x] Rule 15: stored detail line. §5: backfill is an `UPDATE` inside the migration guard, totals unchanged by construction.

### Client (Vitest)
- [x] `PricingSummary.added-guests-tax.test.jsx` (2): the line, no « Offrir ».
- [x] `TouristTaxPage.added-guests.test.jsx` (1): the added row ticks alone.

### Manual UI verification
- [x] Fiche on a `platform_reversed` platform (isolated instance, 2026-11-03): brut entered, 2 → 3 adults: line on the
      fiche, 40,00 + 2,40 = 42,40 € in the arrival SAS recap; solde and complement paid; row in « Suivi taxe de séjour »;
      accounting entries balance (solde 46710000 = 4,80, complement 46710000 = 2,40).
- [x] Same fiche with the balance paid and the row declared, then a guest added: frozen part unchanged, line in the
      complement, own row once collected, ticked alone.
- [x] Mobile (375 px) and 900 / 1280 px: fiche summary, SAS recap, declaration page, no horizontal scroll.
- [ ] E2E suite: not run locally (another session holds port 4000), left to the CI.

## 8. Out of scope

- Billing guests added before this release (§5).
- Added tax on a platform in mode `platform`, which remits to the commune itself (decision 2026-11-03).
- Guests added once the arrival complement is collected (rule 7).
- Reconciling a platform's own tax rate with ours.
- Editing the composition from the SAS.
- Notifying the guest automatically ([no-automatic-email-without-approval.md](no-automatic-email-without-approval.md)).

## 9. Open questions

- Q: In mode `platform`, do we collect and declare the added tax ourselves? → **A (2026-11-03):** no,
  only platforms that reverse the tax to us; the condition reads the mode, never a platform name.
- Q: Guests added once the tax is frozen? → **A (2026-11-03):** a line all the same, in the complement
  (rule 7bis).
