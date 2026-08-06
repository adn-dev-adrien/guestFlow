# Dashboard — red only on the complement actually to collect

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/dashboard-collection-alert` _(user-managed)_ |
| **Created** | 2026-08-05 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |

---

## 1. Context

The « Tableau de bord » ([Dashboard.js](../client/src/pages/Dashboard.js)) paints its « Paiements »
column red as soon as `paymentComplete` is false, on both the arrivals table
([Dashboard.js:222](../client/src/pages/Dashboard.js#L222), [:261](../client/src/pages/Dashboard.js#L261))
and the departures table ([:311](../client/src/pages/Dashboard.js#L311), [:337](../client/src/pages/Dashboard.js#L337)).

`paymentComplete` / `remainingDue` come from
[computePaymentStatus](../server/src/utils/paymentStatus.js#L19-L49), which nets **only** the deposit
and the balance out of `finalPrice`:

```js
const remainingDue = round2(finalPrice - (depositPaid ? depositAmount : 0) - (balancePaid ? balanceAmount : 0));
```

Two consequences make the red signal useless in daily operation:

1. **Platform bookings are red by construction.** Airbnb / Booking / Lodgify pay the rental **after
   the stay** — a single transfer, no deposit
   ([accounting-platform-commission-and-no-deposit.md](accounting-platform-commission-and-no-deposit.md) §1.2,
   [pricing.js:1715-1741](../server/src/utils/pricing.js#L1715-L1741) forces `depositAmount = 0` and
   routes everything to the balance). So on the arrival day the balance is legitimately unpaid, and
   the dashboard screams red for a perfectly normal situation. Every platform arrival is red, every
   day → the operator has learned to ignore the column entirely.
2. **The amount shown is wrong anyway.** `remainingDue` ignores both complements, while `finalPrice`
   already *includes* the in-complement extras ([platform-payment-entry.md](platform-payment-entry.md)
   rule 1bis: `finalPrice = brut + complement`). A reservation carrying a complement therefore stays
   red « Manquant X € » **even after the complement has been collected** — `complementPaid`,
   `complementPaidCash` and `endOfStayComplementPaid` are never read. The correct 4-bucket arithmetic
   already exists in [financeModel.js:73-88](../server/src/models/financeModel.js#L73-L88)
   (`remainingToPay` / `isSettled`, [finance-operational-remaining-to-pay.md](finance-operational-remaining-to-pay.md)),
   but only the Finances page consumes it — §8 of that spec explicitly left the dashboard out.

The only money the operator can actually do something about on the day is **the complement collected
at the door**: the arrival complement (extras forced into the complement + tourist tax charged on
arrival) and, at check-out, the merged « complément de fin de séjour »
([defer-arrival-complement-to-checkout.md](defer-arrival-complement-to-checkout.md)). Everything else
is either already settled or on a schedule the operator does not control.

## 2. Goal

On the dashboard, the red « Paiements » alert fires **only when there is money to collect at the
door that has not been collected** — the arrival complement on the arrivals list, the end-of-stay
complement on the departures list. Deposit and balance still-in-flight (the normal platform case)
are shown as plain information, never as an alert.

## 3. Functional rules

### 3.1 Arrivals list — what turns red

1. The « Paiements » cell of an arrival row is **red** if and only if the **arrival complement is
   still to be collected**:
   `complementAmount > 0` **AND** not paid (`complementPaid` = 0 **AND** `complementPaidCash` = 0)
   **AND** not deferred (`complementDeferredToCheckout` = 0).
2. An arrival complement marked « En fin de séjour » (`complementDeferredToCheckout = 1`) is **not**
   an alert — the collection was consciously moved to check-out. The cell says so explicitly.
3. An unpaid deposit or an unpaid balance **never** turns the cell red, whatever the platform
   (including `direct`). Rationale: the dashboard is the *day-of-operations* view, not the dunning
   view — chasing a late direct-booking balance belongs to the Finances page
   ([finance-operational-remaining-to-pay.md](finance-operational-remaining-to-pay.md)), which already
   lists « Reste à payer » with correct arithmetic.
4. When nothing at all is left to settle on the reservation (every applicable bucket paid, disabled
   or caisse-interne — same rule as `isSettled`), the cell is **green** and reads « OK ».
5. In every other case (something outstanding, but no door money to collect) the cell is
   **neutral** (`text.secondary`) and lists the state of each applicable bucket.

### 3.2 Departures list — what turns red

6. The « Paiements » cell of a departure row is **red** if and only if there is money left to collect
   at check-out: the still-unpaid part of the **arrival complement** (deferred or simply never
   collected) **plus** the still-unpaid **end-of-stay complement**
   (`endOfStayComplementAmount` with `endOfStayComplementPaid` = 0 **AND**
   `endOfStayComplementPaidCash` = 0) — i.e. the merged « complément de fin de séjour » of
   [defer-arrival-complement-to-checkout.md](defer-arrival-complement-to-checkout.md) §3.2, still open.
7. Same as rule 3: an unpaid deposit / balance never turns a departure row red.
8. Rules 4 and 5 apply identically to departures (green when fully settled, neutral otherwise).

### 3.3 What the cell displays

9. **Alert state (red, bold):** the amount still to collect at the door — arrivals
   « Complément à encaisser 45,00 € », departures « À encaisser 60,00 € ». The neutral bucket detail
   (rule 10) is appended after it so the operator still sees the whole picture.
10. **Neutral detail:** the list of applicable buckets with their state, joined by ` · ` —
    e.g. « Acompte OK · Solde NON · Complément OK ». A bucket is **omitted** when it carries nothing
    to collect: amount 0, or deposit opted out for the reservation (`depositDisabled`,
    [disable-deposit-per-reservation.md](disable-deposit-per-reservation.md)). A deferred arrival
    complement renders as « Complément reporté ».
11. **Platform chip.** When the reservation comes from a platform (`platform` ≠ `direct`) **and** at
    least one of deposit / balance is still unpaid, the cell also renders a `StatusBadge` reading
    « Réglé par la plateforme ». It makes the "this is normal, the payout lands after the stay"
    reading explicit instead of implicit.
12. **Settled state (green):** « OK » on arrivals, « Paiements OK » on departures — unchanged copy.
13. All of the above (which buckets apply, their state, the alert booleans, the amount to collect,
    whether the platform chip shows) is **computed server-side** and delivered ready to render.
    The client only maps states to strings/colors and formats the currency.

### 3.4 Reception role

14. Unchanged: the « Paiements » column stays hidden for a reception-only user
    ([reception-role-checkin-only.md](reception-role-checkin-only.md) §3.3), and the new payload
    block is **not** whitelisted in [receptionView.js](../server/src/utils/receptionView.js) — it
    carries deposit/balance states, which reception must never receive. The client must therefore
    tolerate the block being absent.

**Edge cases:**
- Complement paid in caisse interne (`complementPaidCash = 1`) → settled, no alert (rule 1). The cash
  flag already implies `complementPaid = 1` at persistence time
  ([complementPayment.js:24](../server/src/utils/complementPayment.js#L24)), but the rule reads both
  so a hand-edited row can't produce a false alert.
- Complement deferred **and** already paid → `buildCheckoutComplement` drops `deferred`
  ([checkoutComplement.js:43-45](../server/src/utils/checkoutComplement.js#L43-L45)); nothing to
  collect, no alert on either list.
- Arrival complement unpaid, not deferred, and the row is a **departure** → red on the departure list
  too (rule 6): the money is still owed and the guest is leaving. Last chance to collect.
- `complementAmount = 0` (no extras, tax in the balance) → the complement bucket is omitted from the
  detail entirely; the row can only ever be green or neutral.
- Devis (`kind = 'devis'`) never appear in the arrivals/departures lists → out of reach.
- Reservation with everything paid **and** a zero complement → green « OK ».

---

## 4. Architecture

> **Fat backend, thin frontend.** The alert booleans, the bucket list, the amounts and the chip
> decision are all computed in a pure server util and shipped on the reservation detail payload. The
> client keeps only the state → color/label mapping and `formatCurrency`.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `utils/` | `reservationSettlement.js` | C | Extracted from `financeModel.js`: the single source of truth for per-bucket settlement (`bucketStates`, `isSettled`, `remainingToPay`, `platformCommission`). Pure. |
| `utils/` | `operationalCollection.js` | C | Builds the day-of-operations collection block: `{ arrival, departure, platformSettled }` from a detailed reservation + its `checkoutComplement`. Pure. |
| `models/` | `financeModel.js` | T | Drops its private `isSettled` / `remainingToPay` / `platformCommission` copies and consumes `reservationSettlement.js` — behavior identical (the 38-test finance suite is untouched and green), one implementation. `totalSejour` / `comptaCollected` stay local: they are finance-specific shaping, not settlement rules. |
| `models/` | `reservationsModel.js` | T | `getByIdWithDetails` attaches `reservation.operationalCollection` right after `checkoutComplement`. |
| `utils/` | `receptionView.js` | — | **No change** — the whitelist drops `operationalCollection` automatically (rule 14). |
| `utils/` | `paymentStatus.js` | — | **No change** — `remainingDue` / `paymentComplete` keep their current semantics for their other consumers (list payload, planning, emails). |
| `routes/`, `controllers/`, `middleware/`, `database.js` | — | — | (none) |

**Notes:**
- `operationalCollection.js` never re-derives amounts: it reads `complementAmount`,
  `endOfStayComplementAmount` and the already-built `checkoutComplement`. No pricing logic moves.
- Extracting `reservationSettlement.js` is required by the "touch it, extract it" policy (CLAUDE.md
  §6.1) and prevents a second divergent copy of the settlement rules.
- `remainingToPay` deliberately keeps the **raw-flag** arithmetic of the original rather than gating
  on `bucketStates().applicable`: the commission of a zero-amount échéance must still be subtracted,
  otherwise the documented invariant `comptaCollected(r) + remainingToPay(r) === totalSejour(r)`
  breaks on that (degenerate) data. `bucketStates` is the new addition, consumed by `isSettled` and
  the operational block only.
- No new dependency.

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `pages/` | `Dashboard.js` | T | Renders `operationalCollection` in the 4 payment cells (arrival row/card, departure row/card); the local `arrivalPaymentText` helper is replaced by a shared renderer. |
| `components/` | `CollectionStatusCell.js` | C | Generic « what's left to collect » cell: alert line + neutral bucket detail + optional platform chip. Used 4× here (table cell / mobile card × arrivals / departures). |
| `components/` | `StatusBadge.js` | — | Consumed as-is for the « Réglé par la plateforme » chip. |
| `hooks/`, `services/`, `utils/`, `constants/`, `styles/`, `api.js` | — | — | (none — the field rides on the existing `GET /reservations/:id`) |

**Component reuse declaration:**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing generic)** | `StatusBadge`, `ResponsiveTable`, `PageActionBar` | Pre-existing. `StatusBadge status="info"` carries the platform chip. |
| **Created (new generic)** | `CollectionStatusCell` | Generic on purpose: it renders an `operationalCollection` block, not a dashboard row. The same block will be reused by the Planning arrival/departure cards and the reservation list once they migrate off `paymentComplete` — and it already has 4 call sites in this spec alone. JSDoc'd props: `{ collection, side: 'arrival'\|'departure', variant: 'row'\|'card' }` — one payload prop, so the client stays dumb. Renders `null` when `collection` is absent (reception payload). |
| **Specific (kept feature-local)** | — | none |

### 4.3 API contract

No new endpoint. `GET /api/reservations/:id` gains one read-only block (additive, backward
compatible — existing consumers of `remainingDue` / `paymentComplete` are untouched):

```jsonc
{
  "operationalCollection": {
    "arrival": {
      "alert": true,              // → red
      "settled": false,           // → green "OK"
      "amountDue": 45,            // arrival complement still to collect at the door
      "deferred": false,          // complement moved to check-out
      "parts": [                  // neutral detail, already ordered & filtered
        { "key": "deposit",    "label": "Acompte",    "state": "ok" },
        { "key": "balance",    "label": "Solde",      "state": "pending" },
        { "key": "complement", "label": "Complément", "state": "pending" }
      ]
    },
    "departure": {
      "alert": false,
      "settled": false,
      "amountDue": 0,             // unpaid arrival complement + unpaid end-of-stay complement
      "deferred": false,
      "parts": [ /* same shape; `complement` = the merged checkout complement */ ]
    },
    "platformSettled": true,      // → chip « Réglé par la plateforme »
    "platform": "airbnb"          // for the chip tooltip; null on direct
  }
}
```

`state` ∈ `ok` | `pending` | `deferred`. Buckets with nothing to collect are absent from `parts`.
Auth: unchanged (session required). Reception-only requesters never receive the block (rule 14).

---

## 5. Data model

**No schema change.** Every field consumed already exists on `reservations`: `complementAmount`,
`complementPaid`, `complementPaidCash`, `complementDeferredToCheckout`,
`endOfStayComplementAmount`, `endOfStayComplementPaid`, `endOfStayComplementPaidCash`,
`depositAmount`, `depositPaid`, `depositDisabled`, `balanceAmount`, `balancePaid`, `platform`.

**Data impact:** none — read-only derivation, no migration, no backfill.

## 6. UI / UX

### Arrivals table (`md+`) — « Paiements » column

| Situation | Rendering |
|---|---|
| Complément à encaisser | 🔴 **Complément à encaisser 45,00 €** <br> ‹gris› Acompte OK · Solde NON <br> ‹chip› Réglé par la plateforme |
| Complément reporté | ‹gris› Acompte OK · Solde NON · Complément reporté <br> ‹chip› Réglé par la plateforme |
| Plateforme, rien au comptoir | ‹gris› Solde NON <br> ‹chip› Réglé par la plateforme |
| Tout soldé | 🟢 **OK** |

### Departures table (`md+`) — « Paiements » column

| Situation | Rendering |
|---|---|
| Complément de fin de séjour ouvert | 🔴 **À encaisser 60,00 €** <br> ‹gris› Solde NON |
| Rien à encaisser à la porte | ‹gris› Solde NON <br> ‹chip› Réglé par la plateforme |
| Tout soldé | 🟢 **Paiements OK** |

**Copy (French):**
- `Complément à encaisser {montant}` (arrivals, alert)
- `À encaisser {montant}` (departures, alert)
- `Acompte` / `Solde` / `Complément` + ` OK` | ` NON` | ` reporté`
- `Réglé par la plateforme` (chip, `StatusBadge status="info"`), tooltip
  « {Plateforme} verse le montant de la location après le séjour. »
- `OK` (arrivals, settled) / `Paiements OK` (departures, settled)

**Colors:** alert → `error.main` + `fontWeight: 700`; settled → `success.main` + `fontWeight: 700`;
neutral detail → `text.secondary`, regular weight. Replaces today's binary green/red.

**Responsive:**
- The block is always stacked (alert line → neutral detail → badge, one per line): inline-after-detail
  was tried and rejected — the badge blows the « Paiements » column width on `md` and forces the
  neutral detail to wrap mid-word.
- `xs` — the mobile cards ([Dashboard.js:249-277](../client/src/pages/Dashboard.js#L249-L277),
  [:314-338](../client/src/pages/Dashboard.js#L314-L338)) render the same block in `variant="card"`,
  which only drops the type scale to `caption`. Verified at 390px: no horizontal scroll.
- `md` / `lg` — same block inside the table cell, `body2` scale.
- Empty/loading/error states of the dashboard are unchanged.

**Sticky action bar:** unchanged — `<PageActionBar title="Tableau de bord" titleOnXs center={…} />`
([Dashboard.js:366](../client/src/pages/Dashboard.js#L366)). No new page-level action.

## 7. Test plan

### Server unit tests
- [x] `tests/operational-collection.unit.test.js` — **15 tests**, rules 1-8 and 10:
  - complement unpaid + not deferred → `arrival.alert = true`, `amountDue = complementAmount`
  - complement deferred → `arrival.alert = false`, `deferred = true`
  - complement paid / paid cash → no alert on either side
  - platform booking, balance unpaid, no complement → `arrival.alert = false`,
    `platformSettled = true`
  - **direct** booking, balance unpaid, no complement → `arrival.alert = false` (rule 3)
  - everything settled → `settled = true` on both sides
  - departure: unpaid end-of-stay complement → `departure.alert = true`,
    `amountDue = endOfStay + unpaid arrival part`
  - departure: arrival complement unpaid & not deferred → counted in `departure.amountDue`
  - `parts` omits zero-amount buckets and a `depositDisabled` deposit
- [x] `tests/reservation-settlement.unit.test.js` — **10 tests**: the extracted `isSettled` /
  `remainingToPay` / `bucketStates` / `platformCommission` keep their current results
- [x] `tests/finance-model.unit.test.js` — untouched, still 38/38 green after the extraction
  (non-regression proof of the refactor, incl. the
  `comptaCollected + remainingToPay === totalSejour` invariant)
- [x] `tests/payment-status.unit.test.js` — untouched (`computePaymentStatus` unchanged)
- [x] `cd server && npm test` → **2218/2218**

### Client tests
- [x] `client/src/pages/__tests__/Dashboard.test.js` — **+3 tests**: a platform arrival with an
  unpaid balance and no complement shows no red but shows the badge; an arrival with an unpaid
  complement shows the red amount + the neutral detail; a settled reservation shows the plain green
  « OK » with no detail line
- [x] `cd client && npx vitest run` → **733/733**
- [x] `npm run test:e2e` → **32 passed, 1 skipped**

### Manual UI verification (2026-08-05, dev server + Chrome)
- [x] Platform arrival, balance unpaid, no complement (11/08, Lodgify) → grey « Solde NON » +
  badge « Réglé par la plateforme », **no red**
- [x] Arrival with an unpaid complement (10/10, Abracadaroom) → red « Complément à encaisser 4,30 € »
  over grey « Solde OK · Complément NON »
- [x] Deferred complement (02/08) → arrival neutral « Acompte OK · Solde OK · Complément reporté »,
  and its departure day (03/08) shows red « À encaisser 64,00 € »
- [x] Fully settled reservation (05/08) → green « OK » / « Paiements OK »
- [x] Mobile 390px on both cards → alert + detail + badge stacked, no horizontal scroll
- [x] Zero console errors across the whole walkthrough
- [x] Regression: Finances page renders with its figures after the `reservationSettlement` extraction
- [ ] Direct booking with an unpaid balance — **not reachable in the dev dataset** (no such row);
  covered by the unit test « rule 3 — a DIRECT booking with an unpaid balance is not an alert either »
- [ ] Reception-only account — not re-checked in the browser; the « Paiements » column is behind the
  unchanged `!receptionMode` guard, `CollectionStatusCell` returns `null` on an absent block, and the
  existing reception Vitest case still passes

## 8. Out of scope

- Changing `computePaymentStatus.remainingDue` / `paymentComplete` — they keep their current
  semantics for the list payload, the Planning and the emails. This spec adds a parallel,
  operationally-correct block rather than mutating a field 20 call sites read.
- Migrating the Planning cards / the reservation list off `paymentComplete` (they'll consume
  `CollectionStatusCell` in a later sweep).
- Any change to the Finances page's own red/pending logic — it is already correct.
- Dunning / reminder emails for a late deposit or balance.
- The « Caution » column, which keeps its own independent red
  ([Dashboard.js:250-254](../client/src/pages/Dashboard.js#L250-L254)).

## 9. Open questions

- Q: Does the red rule apply to direct bookings too, where the balance is genuinely due before
  arrival?
  - A: **Yes — resolved 2026-08-05.** One single rule for every platform: only the door complement
    turns the dashboard red. Chasing a late direct balance is the Finances page's job (rule 3).
- Q: What turns a **departure** row red?
  - A: **Resolved 2026-08-05.** The merged « complément de fin de séjour » (deferred arrival
    complement + end-of-stay extras) when still unpaid (rule 6).
- Q: What replaces the red « Manquant X € » text when the state is normal?
  - A: **Resolved 2026-08-05.** The bucket detail in neutral grey, **plus** an explicit
    « Réglé par la plateforme » chip on platform bookings (rules 10-11).
