# Guest app — schedule the nordic bath from the home screen

| Field | Value |
|---|---|
| **Status** | Approved |
| **Branch** | `feature/guest-app-bath-home-scheduling` _(built on `feature/pricing-components-c`, ships with the pricing refonte in 4.2.0)_ |
| **Created** | 2026-11-13 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |
| **Summary for decision** | [`docs/specs/2026-11-13-guest-app-bath-home-scheduling.html`](../docs/specs/2026-11-13-guest-app-bath-home-scheduling.html) — interactive mock-up |

---

## 1. Context

Every stay at Domaine Solio gets **one hour of nordic bath offered** (2026-09-23), and a guest can buy more hours
when booking (site, devis) or later. Today:

- The guest app sells bath slots from the shop (`SlotPickerPage`, specs/guest-app.md rules 28-31) and its home shows a
  highlight « Un bain nordique ce soir ? » only when a slot is still free today (`homeHighlight.js`, key `bath`). The
  highlight sells; it never says what the guest **already owns**.
- Hours the guest **owns but has not placed** — the offered hour, hours bought with the stay — can only be placed by the
  operator in the arrival SAS (« Planifier », `hourly-resources/schedulingModel.js` `hoursRemaining`). A guest who
  arrives at 21:00 or wants to plan ahead from J-7 cannot do it.
- When owned hours are placed in the evening band, the stay owes the evening difference. The pricing refonte already
  values the offered hour at the **day rate** (specs/pricing-components.md rule 24, diff 4) and carries the evening
  difference as a component of the session line (rule 90.3). With the current lodger grid (day 30 €, evening 50 €
  from 20:00) an offered hour taken in the evening owes **20 €** — the same gap as the external grid (50 € / 70 €),
  which is how Adrien states it.

## 2. Goal

From the home of the guest app, a guest who owns bath hours sees them and places them in two taps — all in a row or
spread over the stay — and can add extra hours in the same screen; the screen shows, before the guest commits, the
exact amount due (evening supplement, extra hours), computed by the server.

## 3. Functional rules

### 3.A What the guest owns

1. **Owned hours** of a stay, per hourly resource sold in the guest app: the hours of its stay lines not yet placed
   (`hoursRemaining`, offered and paid alike) plus the offered minutes the stay is granted and no line carries yet
   (`sold.freeMinutes.left`). Computed by the server only; the app receives `ownedMinutes`, split
   `{ offered, prepaid }` for the wording.
2. **Placed sessions** of the stay that have not ended yet are listed on the card, oldest first.
3. A stay of a platform keeps the offered hour on the same terms as today (granted by the catalogue's free minutes); this
   spec changes nothing to who is granted what.

### 3.B The home card

4. A **bath card** sits on the home while (a) the shop sells an hourly resource to the
   lodging, (b) the stay has not ended, and (c) the guest owns hours **or** has an upcoming session **or** a slot is
   still bookable before the check-out. Its place (Q2): right under the stay card, above the tiles, while hours are
   to schedule; under the tiles in the two other states.
5. Its three states (wording in §6):
   - **To schedule** — owned hours > 0: « 1 h offerte à programmer », « 3 h à programmer · 1 offerte, 2 réglées ».
     Button « Programmer ».
   - **Scheduled** — owned hours = 0 and an upcoming session: the sessions (« ven. 14 nov. · 18 h – 19 h »), then two
     buttons stacked full width, same height (44 px) and width: « Ajouter une heure » (filled) and « Changer une
     séance » (outlined, opens the contacts sheet, rule 21).
   - **Offer** — nothing owned or placed: « 30 € l'heure · 50 € en soirée », button « Réserver ».
6. While the card shows, the home highlight never takes the `bath` key (`chooseHighlight` skips it): one bath message
   on the home, never two.
7. From J-7 the card shows like the rest of the app (the app opens seven days before the arrival); the days offered
   stay inside the stay, as for every bath slot of the app.

### 3.C Scheduling

8. « Programmer » opens the scheduling screen with `N` = owned hours. « Réserver » and « Ajouter une heure » open it
   with `N` = 0 and one extra hour.
9. **Mode.** When `N + extra ≥ 2`, a two-way switch: **« À la suite »** (default) / **« Réparties »**. With one hour
   there is no switch.
10. **À la suite** = one session of `N + extra` consecutive hours on one day. The server lists, per day, the start times
    where that many consecutive slots are all bookable (same judgement as one slot: availability, heat-up, turnover,
    service hours, stay bounds). A day without one is not shown; when no day has one, the screen says so and offers
    « Réparties ».
11. **Réparties** = `N + extra` sessions of one hour, chosen freely on any days of the stay, several on one day allowed.
    A counter « 2 sur 3 placées » follows the selection. Tapping a slot once the count is reached is refused in place:
    the slot shakes and the line under the counter says « 3 sur 3 déjà choisies — retirez-en une ou ajoutez une
    heure ». Placing fewer than owned is allowed: the rest stays « à programmer ».
12. Slots are those of `slotsForStay` (only `free` and `evening` states), so the evening ones keep their gold dot and
    « tarif soirée ».

### 3.D Extra hours

13. A stepper « Heures en plus » (0 to the resource's `maxQuantity`, at least 1 when the guest owns nothing) sits in
    the same screen, with the hourly price. Each extra hour raises the count to place; **an extra hour is only ever
    bought with its slot** — the app never sells unplaced hours.
14. In « Réparties », adding an hour by tapping « ajoutez une heure » in the refusal line raises the stepper and takes
    the tapped slot.

### 3.E Price — always the server's

15. Before every commitment the screen shows the server's quote (`POST /guest/bath/plan/quote`), line by line:
    - owned hours placed in the day band: « Offerte » / « Déjà réglée », 0 €;
    - each owned hour placed in the evening band: « Supplément soirée » = lodger evening rate − lodger day rate
      (today 50 − 30 = **20 €**), less what the sold line already billed above the day rate (`eveningCredit`);
    - each extra hour at its band (30 € day, 50 € evening).
    The total does not depend on which owned hour lands on which slot: the server values owned hours at the day rate
    (pricing-components rule 24) and prices the placed sessions on the bands.
16. The lodger grid is the reference for the supplement (decided 2026-11-13); the external grid is never read on a
    stay.

### 3.F Commit

17. **Total 0 €** → button « Confirmer mes séances »: the sessions are written on the stay's resource line(s), as the
    SAS « Planifier » does; nothing is sold.
18. **Total > 0 €** → button « Confirmer · 20,00 € » leading to the existing payment choice of the app (card first,
    « sur la note »; specs/guest-app.md). Placement and sale are **one** commit: the evening supplement goes on the
    session line as its evening component while that line is unpaid and its bucket open, otherwise on a new line of
    the resource (pricing-components rule 90.3); extra hours are a new resource line with their sessions. A card
    payment abandoned or refused places nothing (the hold lapses, `bathFulfilment`).
19. The commit re-judges every slot (`bathFulfilment.confirm`): a slot taken meanwhile refuses the whole commit, and the
    screen shows the next free slots of that day (« Never a dead end »).
20. The placement is recorded in the stay history (« Séances de bain programmées depuis l'appli »), and the planning
    card shows the sessions like any other.
21. Moving or cancelling a placed session from the app is **out of scope** (Q1); the « Scheduled » card's « Changer une
    séance » button opens the contacts sheet.

## 4. Architecture

Built on `feature/pricing-components-c`: it reuses the lines, components and fulfilment of the refonte.

### 4.1 Server

| Layer | File | Change |
|---|---|---|
| plugins / hourly-resources | `scheduler.js` | **new** `blocksForStay({ resourceId, propertyId, stay, now, hours, canIgnite })` — per day, start times of `hours` consecutive bookable slots (built on `slotsForStay`). |
| plugins / hourly-resources | `schedulingModel.js` | expose the per-resource `hoursRemaining` / `eveningCredit` to the guest app through the plugin's service (no logic change). |
| plugins / hourly-resources | `index.js` | export the service the guest app calls (`ownedHours`, `blocksForStay`, `placeSessions`). |
| plugins / guest-app | `bathPlan.js` | **new**, pure: owned minutes (rule 1), card state and wording (rules 4-5), quote lines (rule 15) from the hourly family's prices. |
| plugins / guest-app | `controllers/bathPlanController.js` | **new**: `GET /guest/bath/plan`, `GET /guest/bath/plan/blocks`, `POST /guest/bath/plan/quote`, `POST /guest/bath/plan`. |
| plugins / guest-app | `routes/` | mount the four routes behind `guestSession`. |
| plugins / guest-app | `homeHighlight.js` | `bath` highlight skipped while the card shows (rule 6). |
| plugins / guest-app | `controllers/ordersController.js` | the commit of rule 18 goes through the existing order write (card hold, « sur la note »), with the placement in the same transaction. |

### 4.2 Client (guest app, `server/src/plugins/guest-app/apps/guest/src/`)

| Layer | File | Change |
|---|---|---|
| components | `BathPlanCard.jsx` | **new**, specific: the home card, three states (rule 5). |
| components | `Segmented.jsx` | **new**, generic: two-or-more-way switch (« À la suite » / « Réparties »), reused wherever a mode is chosen. |
| components | `Stepper.jsx` | reuse the shop's quantity stepper if one exists, else **new** generic. |
| components | `SlotGrid.jsx` | reused; gains an optional `refusedKey` prop to shake the refused slot. |
| pages | `BathPlanPage.jsx` | **new**: route `/bain/programmer`; mode, days, slots or blocks, counter, stepper, server quote, sticky button. |
| pages | `HomePage.jsx` | renders `BathPlanCard` under the stay card. |
| services | `api.js` | the four calls. |
| i18n | `fr.json`, `en.json` | the strings of §6. |

No change in the GuestFlow admin client: the sessions show on the planning, the fiche and the SAS as today.

### 4.3 API

```
GET  /guest/bath/plan
  → { resources: [{ id, name, ownedMinutes: { offered, prepaid }, upcoming: [{ date, start, end, label }],
      state: 'toSchedule'|'scheduled'|'offer', title, detail, priceLabel }] }
GET  /guest/bath/plan/blocks?resourceId=2&hours=2
  → { days: [{ date, label, starts: [{ start, end, eveningMinutes }] }] }
POST /guest/bath/plan/quote   { resourceId, sessions: [{ date, start, end }], extraHours }
  → { lines: [{ label, amount, amountLabel }], total, totalLabel, unavailable: [...] }
POST /guest/bath/plan         { resourceId, sessions, extraHours, payment: 'card'|'note'|null }
  → 200 { placed: [...], orderId? , paymentUrl? } | 409 SLOT_TAKEN { nextSlots } | 400 COUNT_MISMATCH
```

`sessions` must hold exactly `owned placed + extraHours` hours, `extraHours ≤ maxQuantity`; the server re-derives
every amount and ignores any price sent.

## 5. Data model

No new table, no new column. Sessions land in `reservation_resources.sessions` (owned hours) or in the new lines the
refonte writes (extras, evening component), and the history in `reservation_history`.

## 6. UI / UX

The interactive mock-up is the reference: `docs/specs/2026-11-13-guest-app-bath-home-scheduling.html`.

- **Card** (« Domaine Solio » tokens, specs/guest-app.md §6): eyebrow « BIEN-ÊTRE », title in Marcellus, one line of
  detail, one filled button. Night photo fallback like the bath highlight. When the card holds two buttons they are
  stacked, full width, same height and same width, aligned on the same left edge (reviewed on the mock-up 2026-11-13:
  a text button beside a filled one read as misaligned).
- **Scheduling screen**: AppBar « Bain nordique », the owned line (« 1 h offerte · 2 h réglées »), the mode switch,
  day chips, then either start times (« À la suite », each chip « 18 h – 20 h », evening part marked) or the slot grid
  with the counter (« Réparties »), the stepper « Heures en plus », the quote lines, the sticky button with the total.
- **Refusal**: the over-count slot shakes 2× (reduced motion: no shake, the line alone), the line under the counter
  names the two ways out.
- **Mobile** (< 900 px): full-screen page, sticky button in the thumb zone. **Desktop** (≥ 900 px): the page opens as the
  app's centred dialog, slot grid on 4 columns.
- Strings: card « 1 h offerte à programmer » / « 3 h à programmer » / « 1 offerte, 2 réglées » / « Programmer » /
  « Vos séances » / « Ajouter une heure » / « Changer une séance » / « Réserver » ; screen « À la suite » / « Réparties » / « 2 sur 3 placées » /
  « Heures en plus » / « Supplément soirée » / « Confirmer mes séances » / « Confirmer · 20,00 € ». English in `en.json`.

## 7. Test plan

Server (`server/src/tests/`, one file per subject):
- `guest-bath-plan-owned.unit.test.js` — offered only, offered + prepaid, prepaid partly placed, offered already
  consumed, two lines of one resource.
- `guest-bath-plan-blocks.unit.test.js` — 2 h and 3 h blocks, a taken slot breaks a block, closing time, stay bounds,
  heat-up from cold, no day → empty.
- `guest-bath-plan-quote.unit.test.js` — offered hour in the day = 0 €; in the evening = 20 €; prepaid line sold from
  an evening session → 0 € (eveningCredit); 1 offered + 1 extra 19-21 h = 50 € whatever the allocation; count
  mismatch refused; sent prices ignored.
- `guest-bath-plan-commit.unit.test.js` — 0 € placement writes sessions and history; paid placement = one order with
  the evening component / new line; slot taken → 409 and nothing written; abandoned card hold places nothing.
- `guest-home-highlight.unit.test.js` (existing) — `bath` skipped while the card shows.

Guest app (Vitest, `apps/guest/src/__tests__/`):
- `BathPlanCard.states.test.jsx` — the three states and their buttons.
- `BathPlanPage.modes.test.jsx` — switch hidden at 1 h, blocks vs grid, counter.
- `BathPlanPage.refusal.test.jsx` — over-count refusal, « ajoutez une heure » raises the stepper.
- `BathPlanPage.quote.test.jsx` — the button shows the server total, never a client sum.

E2E: one Playwright scenario — a stay with 1 h offered + 1 h paid, « Réparties », one evening slot, total 20 €, « sur la
note », the planning shows both sessions.

Manual: mobile 390 px (card, both modes, refusal), tablet 900 px, desktop 1280 px (dialog); night register.

## 8. Out of scope

- Moving or cancelling a placed session from the app (Q1).
- Buying hours without a slot (decided 2026-11-13: an extra hour is bought with its slot).
- External bookings (specs/outside-booking-sas.md).
- Any change to who is granted the offered hour, or to the grids themselves.

## 9. Open questions

None.

### Resolved (2026-11-13, Adrien)

- **Q1** — Moving or cancelling a session from the app: not in this spec; « Changer une séance » opens the contacts. A
  later spec can allow it up to the heat-up lead of the session.
- **Q2** — Place of the card: under the stay card while hours are to schedule, under the tiles otherwise.

- Built on the pricing refonte (PR C), not on master: the 20 € rule already lives there.
- The evening supplement reads the **lodger** grid (evening − day), not the external one.
- « Réparties » = free choice with a counter, several sessions a day allowed.
- An extra hour is bought **with its slot**, never as a credit to schedule later.
