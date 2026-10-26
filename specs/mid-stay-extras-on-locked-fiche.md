# Sell extras on a locked fiche (stay in progress)

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/mid-stay-options-on-locked-fiche` |
| **Created** | 2026-10-26 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |

---

## 1. Context

From its check-in date, a reservation fiche is **locked**: only the client, the platform, price
adjustments and payment/caution statuses stay editable
([reservationsController.js](../server/src/controllers/reservationsController.js) — `pastReservationLocked`
and its 14-field allowlist). The whole « Options et ressources » card is greyed out
(`lockedSectionSx`, `opacity: 0.55; pointer-events: none`) and, server side, the option, custom-line
and resource lines are not even written (`if (!pastReservationLocked) model.replaceOptions(…)`).

Selling something to a guest who is already on site is routine: a beer, a cleaning, an extra hour
of the nordic bath. Today the only way is the admin-only « Déverrouiller cette fiche », which reopens
**everything** — dates, property, guests, deletion — to add one line. A non-admin operator cannot do
it at all.

The money side is already solved. [mid-stay-extras-to-end-of-stay-complement.md](mid-stay-extras-to-end-of-stay-complement.md)
routes every extra sold after arrival (above the `arrivalExtrasBaseline` snapshot) to the
**end-of-stay complement**, shown on the fiche and collected by the departure SAS. What is missing is
the door: letting the extras through the lock without letting anything else through.

A side finding: the client decides the lock itself (`res.startDate <= todayStr` in
[ReservationPage.jsx](../client/src/pages/ReservationPage.jsx), around line 749) — date logic in
React, duplicated from the server. This spec moves that decision to the server.

## 2. Goal

On a locked fiche, any operator can add (and correct) options, resources and custom lines without
unlocking it, as long as the end-of-stay complement has not been collected. What was sold at
arrival stays frozen, and everything else on the fiche stays locked.

## 3. Functional rules

### 3.1 The window

1. A reservation is **open for mid-stay extras** when all of these hold:
   - it is locked (`startDate ≤ today`, no « Déverrouiller » on this request);
   - its end-of-stay complement is **not collected** (`endOfStayComplementPaid = 0` and
     `endOfStayComplementPaidCash = 0`);
   - it is a real reservation (`kind = 'reservation'`) and is not cancelled.
   The window therefore covers the stay **and** the days after departure until the end-of-stay
   complement is collected (arbitrated 2026-10-26).
2. The decision is made by the **server**, at read time (exposed to the client, rule 13) and again at
   write time (rule 9). The client never derives it.
3. Any role that can already save a reservation can use the window. No admin requirement — this is a
   routine operation, unlike « Déverrouiller cette fiche ».
   > **Sans test** — no new authorization: `PUT /api/reservations/:id` keeps its existing `enforceRoleAccess` gate (admin-only today, §10).
4. Once the end-of-stay complement is collected, the window closes: the card is locked again, as
   today. To bill something after that, the operator unticks « payé » on the end-of-stay complement
   (mid-stay spec rule 19) — which reopens the window — or unlocks the fiche.

### 3.2 What is editable inside the window

5. The whole « Options et ressources » card (arbitrated 2026-10-26): catalogue options, resources
   (quantity and hourly sessions), custom lines (« Options personnalisées »).
6. **Lines sold at arrival are frozen.** A line is « sold at arrival » when its key (`opt:<id>`,
   `res:<id>`, `custom:<normalised label>`, mid-stay spec rule 2) is in `arrivalExtrasBaseline`. Such a
   line can be **neither removed nor reduced** below its arrival quantity, and its unit price,
   « offerte » flag and description stay as they are. **Increasing** its quantity is allowed: the
   added units are a mid-stay sale and go to the end-of-stay complement (mid-stay spec rule 6).
   Offered lines present before the save (outside the baseline by construction, mid-stay spec rule 5)
   are frozen the same way.
7. **Lines sold during the stay** (absent from the baseline, or the part above it) can be added,
   modified and removed freely — that is how a typo is corrected (arbitrated 2026-10-26).
8. Still locked inside the window: dates, times, property, guests, notes, deletion, cancellation,
   « Actualiser au tarif actuel », and the « Forcer en complément » switch of every line (a mid-stay
   sale goes to the end-of-stay complement whatever its routing, so the switch would do nothing but
   confuse). The bed-count sub-block of a bed-linen option follows its line: frozen if the linen was
   sold at arrival, editable if the linen option is added during the stay.

### 3.3 Server enforcement

9. On `PUT /api/reservations/:id` of a locked reservation:
   - window **open** → the locked-fields allowlist additionally accepts `totalPrice`,
     `optionsSignature`, `resourcesSignature`, and `singleBeds` / `doubleBeds` when rule 8 lets the
     bed counts move. The option, custom-line and resource lines are written (`replaceOptions`,
     custom lines, `insertResourceLines` with its availability check), then
     `syncMidStayComplement` runs as today. Nights are never rewritten.
   - a save that breaks rule 6 → `400`, `code: 'ARRIVAL_EXTRAS_FROZEN'`,
     `error: 'Une prestation vendue à l'arrivée ne peut être ni retirée ni réduite.'`
   - window **closed** and the extras changed → `400`, `code: 'MID_STAY_EXTRAS_CLOSED'`,
     `error: 'Complément de fin de séjour déjà encaissé : décocher « payé » ou déverrouiller la fiche.'`
   - any other forbidden field → unchanged `PAST_RESERVATION_LOCKED`.
10. The baseline is captured before the check (`captureArrivalExtrasBaselineIfDue`, already called
    before the lines are replaced), so the first save after arrival compares against the right state.
11. The arrival complement, deposit and balance never move because of a sale inside the window: the
    engine already routes the mid-stay part to the end-of-stay complement. A server test pins it.
12. The change lands in `reservation_history` like any other option edit (`optionsSignature`,
    `resourcesSignature`). No new audit mechanism.

### 3.4 Read side

13. `GET /api/reservations/:id` returns a ready-to-render `editLock` object:
    ```json
    {
      "locked": true,
      "extrasEditable": true,
      "extrasClosedReason": null,
      "arrivalLines": {
        "opt:12": { "minQuantity": 2, "frozen": true },
        "res:3":  { "minQuantity": 1, "frozen": true },
        "custom:bouteille de vin": { "minQuantity": 1, "frozen": true }
      }
    }
    ```
    `extrasClosedReason` is `'endOfStayCollected'` when the window is closed for that reason, `null`
    otherwise. `minQuantity` is computed by the server from the baseline amount and the line's unit
    price. The client replaces its own `startDate <= today` test by `editLock.locked`.

### 3.5 UI

14. **Banner** (locked fiche, window open): « Séjour commencé : options, client, plateforme, prix et
    paiements restent modifiables. » followed by the existing « Déverrouiller cette fiche » button for
    admins. Window closed: today's text, unchanged.
   > **Sans test** — static copy, checked manually on fiche 22282 (2026-10-26).
15. **Card** « Options et ressources »: not greyed when the window is open. Every other locked card
    keeps today's greyed rendering.
16. A frozen arrival line shows its switch ON and disabled, its quantity field with `min =
    minQuantity`, and a caption « Vendu à l'arrivée » under the label. A mid-stay line is rendered
    like any line of a future reservation.
17. The « Complément de fin de séjour » block of the finance card already lists the mid-stay lines
    (mid-stay spec rule 13) — it updates on the live quote, before saving, as today.
   > **Sans test** — existing behaviour, covered by mid-stay-extras-to-end-of-stay-complement.md rule 13 tests.
18. **Mobile**: no layout change — the caption wraps under the label inside the existing option row;
    the banner already stacks its button under the text on `xs`.
   > **Sans test** — layout only, checked manually at 390 px (2026-10-26).

**Edge cases:**

- Guest already left, end-of-stay complement not collected → window open (rule 1).
- Reservation without baseline (created before the mid-stay spec) → the baseline is captured on this
  save from the pre-save state (rule 10); everything already on the fiche counts as « arrival ».
- Hourly resource added during the stay: the save runs no overlap check on hourly SLOTS (only the
  quantity-based availability of non-hourly resources), so nothing refuses a slot another stay already
  holds, exactly as on a future reservation. Hourly slots sold at arrival may be moved, as long as the
  hours do not drop.
- Arrival SAS lines (`sasArrivalOrigin`) are in the baseline (mid-stay spec rule 4) → frozen.
- End-of-stay complement collected, then « payé » unticked → window reopens on the next load.
- Platform reservation → same rules; its extras already default to the complement routing, which
  rule 8 makes irrelevant inside the window.
- Admin unlocks the fiche → full edit as today; this spec's rules do not apply on an unlocked request.
- The fiche is open in the browser when the end-of-stay complement is collected elsewhere → the save
  gets `MID_STAY_EXTRAS_CLOSED`; the page reloads the reservation to show the locked card.

---

## 4. Architecture

### 4.1 Server (`server/src/`)

| Layer | File | New/Touched | Responsibility |
|---|---|---|---|
| `utils/` | `midStayExtrasWindow.js` | New | Pure rules: `midStayExtrasWindow(row, today)` / `isMidStayExtrasWindowOpen` (rule 1), `arrivalLineFloors(baseline, lines)` → `{ key: { minQuantity, frozen } }` (rules 6, 13), `arrivalExtrasViolations(baseline, beforeLines, afterLines)` (rule 6), `buildEditLock` (rule 13). |
| `models/` | `reservationsModel.js` | Touched | `getEditLock(reservationId, { today })` assembles the `editLock` payload from the row, the baseline and the current extra lines; `readExtraLinesWithQuantity` (lines with their units) and `getStoredRouting` (stored « Forcer en complément » flags) feed the controller. |
| `controllers/` | `reservationsController.js` | Touched | `applyUpdate`: window check, extended allowlist (rule 9), the two new error codes, extras lines written when the window is open. `getOne`: adds `editLock`. |
| `routes/` | — | — | No change. |
| `database.js` | — | — | No schema change. |
| `tests/` | `mid-stay-extras-on-locked-fiche.unit.test.js` | New | Window, floors, violations, controller paths (see §7). |

### 4.2 Client (`client/src/`)

| Layer | File | New/Touched | Responsibility |
|---|---|---|---|
| `pages/` | `ReservationPage.jsx` | Touched | Reads `editLock` instead of comparing dates; exposes `extrasEditable` and `arrivalLines` through the form context; new banner text (rule 14); reloads on `MID_STAY_EXTRAS_CLOSED`. |
| `components/reservation/` | `ExtrasSection.jsx` | Touched | Gates the card on `extrasEditable` instead of `isReservationLocked`; frozen arrival lines (rule 16); « Forcer en complément » disabled inside the window (rule 8). |
| `components/reservation/` | `OptionRow.jsx` | Touched | Same gating for catalogue options and the bed-count sub-block (frozen when the linen was sold at arrival). |
| `constants/` | `reservationLock.js` | New | The two banner texts and the « Vendu à l'arrivée » caption. |
| `utils/` | `arrivalLineKey.js` | New | Key builders to look a line up in `editLock.arrivalLines` (mirror of the server `extraLineKey`). |
| `__tests__/` | `ExtrasSection.mid-stay-locked.test.jsx` | New | Card enabled in the window, arrival lines frozen (option, custom, resource), mid-stay lines removable, routing switches disabled, card greyed when closed. |

No new generic component: the « Vendu à l'arrivée » caption is a `Typography variant="caption"`
inside the existing option row.

## 5. Data model

No change. Reuses `arrivalExtrasBaseline`, `endOfStayComplementDetail`,
`endOfStayComplementAmount`, `endOfStayComplementPaid` / `…PaidCash`.

## 6. API

- `GET /api/reservations/:id` — adds `editLock` (rule 13). Additive.
- `PUT /api/reservations/:id` — accepts extras changes on a locked reservation inside the window; new
  error codes `ARRIVAL_EXTRAS_FROZEN` and `MID_STAY_EXTRAS_CLOSED`.

## 7. Test plan

**Server** (`mid-stay-extras-on-locked-fiche.unit.test.js`, 28 cases — 7 on the pure rules, 21 end to end on the boot schema with the real controller and pricing engine):
- window open: in stay; after departure with complement unpaid; closed when paid or paid in cash;
  closed on a future reservation (not locked) and on a cancelled one;
- add a catalogue option during the stay → saved, end-of-stay complement += its amount, deposit /
  balance / arrival complement unchanged;
- add a custom line and a resource session → saved and in the end-of-stay complement;
- remove a mid-stay line → saved, end-of-stay complement back down;
- remove or reduce an arrival line → `ARRIVAL_EXTRAS_FROZEN`; increase it → saved, only the extra
  units go to the end-of-stay complement;
- change dates or guests together with an option → `PAST_RESERVATION_LOCKED`;
- extras change after collection → `MID_STAY_EXTRAS_CLOSED`;
- `editLock` payload: `minQuantity` per arrival line, `extrasClosedReason`;
- the payload cannot move a line's « Forcer en complément » routing; a linen option added during the stay unfreezes the bed counts, one sold at arrival freezes them; the sale is traced in `reservation_history` (rule 12).

**Client** (Vitest, 11 cases) — see §4.2.

**Manual** (dev server, copy of prod):
1. Fiche in progress, non-admin account: add « Ménage » and a custom line « Bière 3 € », save → the
   end-of-stay complement block lists both; dates and guests stay greyed.
2. Try to switch off an option sold at arrival → impossible; its quantity cannot go below arrival.
3. Collect the end-of-stay complement → the card greys out again.
4. **Mobile (375 px)**: same scenario 1, banner and caption readable, no horizontal scroll.
5. E2E suite (`npm run test:e2e`).

## 8. Out of scope

- Selling extras from the reception / SAS screens outside the fiche.
- Changing how the end-of-stay complement is collected (departure SAS, payment link).
- Any audit beyond `reservation_history`.

## 9. Open questions

_None — the three arbitrages were settled on 2026-10-26 (window until the end-of-stay complement is
collected; arrival lines frozen, mid-stay lines free; the whole extras card)._

## 10. Implementation notes

Decisions the spec did not cover, taken during implementation (2026-10-26):

- **Roles.** `PUT /api/reservations/:id` is admin-only in `enforceRoleAccess` (accountant is read-only,
  reception reaches no reservation write), so « any role that can already save » is, today, the admin.
  No middleware change: widening the PUT to another role is a separate decision.
- **Offered lines** present before the save are frozen at their current quantity and must stay offered;
  an arrival line cannot be offered either (`ARRIVAL_EXTRAS_FROZEN`).
- **Custom lines** have no catalogue to lock their price: lowering the amount of an arrival custom line
  below its baseline amount is a reduction. Raising it is accepted (the surplus is a mid-stay sale).
- **No baseline yet** (locked fiche never checked in, no arrival SAS): the first window save captures
  the baseline unconditionally (`captureArrivalExtrasBaseline`) — a locked fiche has started, so what it
  carries IS what was sold at arrival — and `GET` synthesises the same baseline for `editLock`. Nothing
  is left unfrozen. The live price preview of such a fiche still follows the arrival-moment rule until
  that first save.
- **Amounts.** Every non-offered arrival key is also checked on its AMOUNT (`next.total >= baseline`):
  fewer served persons on a per-person card option, a lower price or a lost free allowance shrink the
  amount without touching the quantity. The quantity floor stays as well.
- **`minQuantity`** is the stored quantity itself while the line has not been extended past its arrival
  amount (exact); once extended, the proportional estimate rounded up to a whole unit (0.01 for an hourly
  resource). The amount check is the real guard.
- **Atomic write.** The row, option, custom and resource lines, mid-stay sync and history are written in
  one transaction; a refused resource (409) rolls everything back.
- **Error codes.** `MID_STAY_EXTRAS_CLOSED` only when the end-of-stay complement is collected AND the
  extras changed in content (units, amount, offered); a routing-only change stays `PAST_RESERVATION_LOCKED`.
- **Bed counts** move only when the payload carries a bed-linen option not sold at arrival; otherwise
  they are pinned to the stored values.
- **`editLock`** entries carry `reason` (`arrival` | `offered`) and, for a planning-card option,
  `lockedOccurrences` (the first `minQuantity` moments, which cannot be unchecked); `frozenCustomOptionIds`
  lists the persisted custom lines that are frozen — the fiche freezes custom lines by id, never by label.
- **Fiche.** Captions « Vendu à l'arrivée » / « Offerte » follow `reason`; « Personnes servies » is
  disabled on an arrival line; the price summary's routing chips are read-only and « Offrir » is hidden on
  frozen lines inside the window; the Neat retry/void buttons stay disabled on a locked fiche; the
  displayed floor is a whole number except for hourly resources; after a save that keeps the page open the
  reservation is refetched. The breakfast « Heure souhaitée » field stays editable in the window (it moves
  no money).
- **Routing.** Inside the window the server overwrites the submitted `inComplement` of every line with the
  stored one (a new line falls back to the engine default) and keeps only the already-forced auto-option
  ids, so the payload cannot move it. `refreshPricingToCurrent` is ignored inside the window.
- **`ARRIVAL_EXTRAS_FROZEN`** carries `lines: [{ key, reason }]` (`removed | reduced | offered | unoffered`).
- **`editLock.extrasEditable`** is `true` only on a locked fiche with an open window; on a future fiche
  `locked` is `false` and the client keeps its normal editing. `arrivalLines` is `{}` when the window is
  closed.
- **Window closed by the end-of-stay collection:** the client alerts with the server message and reloads
  the reservation (`MID_STAY_EXTRAS_CLOSED`).
