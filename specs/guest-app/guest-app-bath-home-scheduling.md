# Guest app — schedule the nordic bath from the home screen

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/guest-app-bath-home-scheduling` _(built on `feature/pricing-components-c`, ships with the pricing refonte in 4.2.0)_ |
| **Created** | 2026-11-13 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |
| **Summary for decision** | [`docs/specs/2026-11-13-guest-app-bath-home-scheduling.html`](../../docs/specs/2026-11-13-guest-app-bath-home-scheduling.html) — interactive mock-up |

---

## 1. Context

Every stay at Domaine Solio gets **one hour of nordic bath offered** (2026-09-23), and a guest can buy more hours
when booking (site, devis) or later. Today:

- The guest app sells bath slots from the shop (`SlotPickerPage`, specs/guest-app/guest-app.md rules 28-31) and its home shows a
  highlight « Un bain nordique ce soir ? » only when a slot is still free today (`homeHighlight.js`, key `bath`). The
  highlight sells; it never says what the guest **already owns**.
- Hours the guest **owns but has not placed** — the offered hour, hours bought with the stay — can only be placed by the
  operator in the arrival SAS (« Planifier », `hourly-resources/schedulingModel.js` `hoursRemaining`). A guest who
  arrives at 21:00 or wants to plan ahead from J-7 cannot do it.
- When owned hours are placed in the evening band, the stay owes the evening difference. The pricing refonte already
  values the offered hour at the **day rate** (specs/pricing/pricing-components.md rule 24, diff 4) and carries the evening
  difference as a component of the session line (rule 90.3). With the current lodger grid (day 30 €, evening 50 €
  from 20:00) an offered hour taken in the evening owes **20 €** — the same gap as the external grid (50 € / 70 €),
  which is how Adrien states it.

## 2. Goal

From the home of the guest app, a guest who owns bath hours sees them and places them in two taps — all in a row or
spread over the stay — and can add extra hours in the same screen; the screen shows, before the guest commits, the
exact amount due (evening supplement, extra hours), computed by the server.

## 3. Functional rules

### 3.A What the guest owns

1. **Owned hours** of a stay, per hourly resource sold in the guest app: the hours its stay line holds and has not
   placed (`includedHoursLeft`, the very hours an order places at no charge, guest-app rule 82) plus the offered
   minutes the stay is granted and no line carries yet (`sold.freeMinutes.left`). Computed by the server only; the app
   receives `ownedMinutes`, split `offeredMinutes` / `heldMinutes`. A held hour is said « comprise dans le séjour »,
   never « réglée »: the line may not be paid yet.
2. **Placed sessions** of the stay that have not ended yet are listed on the card, oldest first.
3. A stay of a platform keeps the offered hour on the same terms as today (granted by the catalogue's free minutes); this
   spec changes nothing to who is granted what.

### 3.B The home card

4. A **bath card** sits on the home while (a) the shop sells an hourly resource to the
   lodging, (b) the stay has not ended, and (c) the guest owns hours **or** has an upcoming session **or** a slot is
   still bookable before the check-out. Its place (Q2): right under the stay card, above the tiles, while hours are
   to schedule; under the tiles in the two other states.
5. Its three states (wording in §6):
   - **To schedule** — owned hours > 0: « 1 h offerte à programmer » (with « En journée, ou en soirée avec 20 € de
     supplément »), « 3 h à programmer » (with « 1 h offerte, 2 h comprises dans le séjour · À la suite ou réparties sur
     le séjour »). Button « Programmer ».
   - **Scheduled** — owned hours = 0 and an upcoming session: the sessions (« ven. 14 nov. · 18 h – 19 h »), then two
     buttons stacked full width, same height (44 px) and width: « Ajouter une heure » (filled) and « Changer une
     séance » (outlined, opens the contacts sheet, rule 21).
   - **Offer** — nothing owned or placed: « Un bain nordique pendant le séjour ? » / « 30 € l'heure · 50 € en soirée »,
     button « Réserver ». When a slot is still bookable today, the offer takes the former highlight's words: « Un bain
     nordique aujourd'hui ? » before 18:00, « … ce soir ? » from it, with « Premier créneau libre à 20 h » before the
     prices (`firstSlotToday`, heat-up counted from now). No rate can be read when no slot is left to book: the card
     then shows no price line rather than « 0 € l'heure » (review of 2026-11-15).
6. One bath message on the home, never two. The card shows wherever the former `bath` highlight could (it needs the
   shop, the highlight led to it), so the `bath` highlight is **removed** from `homeHighlight.js` and its timely words
   moved into the offer state (rule 5) _(implementation, 2026-11-15: keeping a highlight that can never show would be
   dead code)_.
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
    « Réparties ». When the block is longer than the hours the stay holds, the order places its first hours on the
    stay's line and sells the rest as a line of its own (guest-app rule 82): 2 held hours + 1 more from 11:00 to 14:00
    cost 30 €, not 90 €. The two halves touch and make one continuous bath, with no turnover between them (Adrien,
    2026-11-15, after the review found the whole block sold).
11. **Réparties** = `N + extra` sessions of one hour, chosen freely on any days of the stay, several on one day allowed.
    A counter « 2 sur 3 placées » follows the selection. Tapping a slot once the count is reached is refused in place:
    the slot shakes and the line under the counter says « 3 sur 3 déjà choisies — retirez-en une ou ajoutez une
    heure »; when the extra hours are already at their maximum the line stops at « retirez-en une. » (review of
    2026-11-15). Placing fewer than owned is allowed: the rest stays « à programmer », counted as the owned hours less
    the hours placed, because the order places the held hours first and buys only what goes beyond them.
12. Slots are those of `slotsForStay` (only `free` and `evening` states), so the evening ones keep their gold dot and
    « tarif soirée ».

### 3.D Extra hours

13. A stepper « Heures en plus » (0 to the resource's `maxQuantity`, at least 1 when the guest owns nothing) sits in
    the same screen, with the hourly price. Each extra hour raises the count to place; **an extra hour is only ever
    bought with its slot** — the app never sells unplaced hours.
14. In « Réparties », adding an hour by tapping « ajoutez une heure » in the refusal line raises the stepper and takes
    the tapped slot.

### 3.E Price — always the server's

15. Before every commitment the screen shows the server's quote (`POST /orders/quote`, the app's one quote) with the
    bath line's `breakdown`, line by line:
    - owned hours: « Comprise dans le séjour · 2 h » / « Offerte · 1 h », 0 €;
    - each owned hour placed in the evening band: « Supplément soirée » = lodger evening rate − lodger day rate
      (today 50 − 30 = **20 €**), less what the sold line already billed above the day rate (`eveningCredit`);
    - the extra hours at their band (30 € day, 50 € evening): « En plus · 1 h ».
    The breakdown is words only: its parts always add up to the line's total, computed by the existing order pricing
    (`price()`, `orderSupplement`, rules 81-83). The total does not depend on which owned hour lands on which slot: the server values owned hours at the day rate
    (pricing-components rule 24) and prices the placed sessions on the bands.
16. The lodger grid is the reference for the supplement (decided 2026-11-13); the external grid is never read on a
    stay.

### 3.F Commit

17. **Total 0 €** → button « Confirmer mes séances »: `POST /orders` with `payment: 'none'`; the held hours' sessions
    join the stay's line (guest-app rule 82, `placeOnHeld`), the offered minutes price at 0 €; nothing is sold. The 0 €
    guard (guest-app rule 55, `freeCovers`) counts the held hours as well as the offered minutes _(fix, 2026-11-15:
    placing a held hour in the day was refused « ne se commande pas dans l'application »)_.
    _(Amended 2026-11-27 by Adrien: the terms owed are shown and ticked on the page.)_ This path skips the cart, so the page
    itself asks the terms the quote says are owed (`quote.termsRequired`), as the cart does (rule 37 of
    `specs/gift-vouchers/gift-voucher-campaigns.md`): `TermsAcceptance` above the sticky button (checkbox + « Lire »), the button
    closed with « Acceptez les conditions générales pour commander. » until each owed version is ticked, `acceptedTerms` sent with
    the order; `TERMS_OUTDATED` re-asks the quote so the new version shows. Nothing owed (already accepted) → nothing asked. The paid
    path goes to the cart, which asks them.
18. **Total > 0 €** → button « Confirmer · 20 € »: the line goes to the cart (`cart.replace`), whose payment choice is
    the app's own (card first, « sur la note »; specs/guest-app/guest-app.md). Placement and sale are **one** order, the existing
    one: the held hours placed, the evening supplement a line of its own (rules 81-83), the extra hours a new resource
    line with their sessions. A card payment abandoned or refused places nothing (the order's rules 35-36).
19. The order re-judges every slot: a slot taken meanwhile refuses the whole order, the screen says the server's
    sentence and reloads the slots or blocks, so the next free ones show (« Never a dead end »). A quote the server
    refuses is said the same way, and the button stays closed.
20. The placement is recorded like every order (« Commande client #N » in the stay history), and the planning card
    shows the sessions like any other.
21. Moving or cancelling a placed session from the app is **out of scope** (Q1); the « Scheduled » card's « Changer une
    séance » button opens the contacts sheet.

## 4. Architecture

Built on `feature/pricing-components-c`. It adds no write path: the quote and the commit are the app's existing
`POST /orders/quote` and `POST /orders` with one `{ kind: 'resource', id, sessions }` line, so the price has one source
(the refonte's order pricing) _(implementation, 2026-11-15: the four `/guest/bath/plan` routes first drafted here were
dropped for that reason)_.

### 4.1 Server

| Layer | File | Change |
|---|---|---|
| plugins / guest-app | `bathPlan.js` | **new**, pure: `ownedOf` (rule 1), `upcomingSessions` (rule 2), `cardState` / `cardView` (rules 4-6, FR/EN words), `consecutiveBlocks` (rule 10). |
| plugins / guest-app | `controllers/shopController.js` | **new** `bathCards(guest, at, lang)` (rules 1-6, from `soldFor`, `includedHoursLeft` and `slotsForStay`) and `blocks` (`GET /shop/resources/:id/blocks?hours=N`, rule 10: candidates of `consecutiveBlocks`, each judged whole by `scheduler.validateSessions`). `firstBathSlotToday` removed (rule 6). |
| plugins / guest-app | `controllers/sessionController.js` | `/me` answers `bath` (the cards) when the lodging shows both the bath and the shop. |
| plugins / guest-app | `controllers/ordersController.js` | a bath quote line carries `breakdown` (rule 15); `freeCovers` counts the held hours (rule 17). The stored order snapshot never keeps `breakdown`. |
| plugins / guest-app | `homeHighlight.js` | the `bath` highlight removed (rule 6). |
| plugins / guest-app | `routes/public.js`, `index.js` | the `blocks` route; `bathCards` wired into the session controller. |
| plugins / guest-app | `manifest.json` | 1.2.0 and its French changelog. |

### 4.2 Client (guest app, `server/src/plugins/guest-app/apps/guest/src/`)

| Layer | File | Change |
|---|---|---|
| components | `BathPlanCard.jsx` | **new**, specific: the home card, three states (rule 5), buttons stacked. |
| components | `Segmented.jsx` | **new**, generic: a two-or-more-way switch with a sliding thumb. |
| components | `QuantityStepper.jsx` | reused for « Heures en plus ». |
| components | `TermsAcceptance.jsx` | reused above the sticky button at 0 € (rule 17). |
| hooks | `useLineQuote.js` | `reload()` asks the same line again (after `TERMS_OUTDATED`). |
| components | `SlotGrid.jsx` | optional `refusedKey` (the refused slot shakes); a day chip holding a selected slot carries a dot. |
| pages | `BathPlanPage.jsx` | **new**, route `/bain/programmer/:id` (`?ajout=1` opens it with one extra hour). |
| pages | `HomePage.jsx` | renders the cards (Q2 place); the `bath` highlight branch removed. |
| services | `api.js` | `blocks(resourceId, hours)`. |
| i18n / styles | `fr.json`, `en.json`, `styles.css` | `bathPlan.*` strings (`hl.bath` removed); `.bathcard`, `.seg`, `.bathplan` rules. |

No change in the GuestFlow admin client: the sessions show on the planning, the fiche and the SAS as today.

### 4.3 API

```
GET  /public/v1/guest/me
  → { …, bath?: [{ resourceId, name, state: 'toSchedule'|'scheduled'|'offer', eyebrow, title, detail,
       ownedMinutes, offeredMinutes, heldMinutes, maxExtraHours, priceLine, firstSlotToday?,
       upcoming: [{ date, start, end, label }], actions: [{ key: 'schedule'|'add'|'change', label }] }] }
GET  /public/v1/guest/shop/resources/:id/blocks?hours=N      (2 ≤ N ≤ 12)
  → { open: true, hours, days: [{ date, label, starts: [{ start, end, eveningMinutes }] }] }
  | { open: false, closedReason, days: [] } | 400 INVALID_INPUT | 404 ITEM_NOT_FOUND
POST /public/v1/guest/orders/quote   (existing) — a bath line now carries
  breakdown: [{ key: 'held'|'offered'|'evening'|'extra', hours?, label, amount, amountLabel }]
POST /public/v1/guest/orders         (existing) — unchanged
```

## 5. Data model

No new table, no new column. Sessions land in `reservation_resources.sessions` (owned hours) or in the new lines the
refonte writes (extras, evening component), and the history in `reservation_history`.

## 6. UI / UX

The interactive mock-up is the reference: `docs/specs/2026-11-13-guest-app-bath-home-scheduling.html`.

- **Card** (« Domaine Solio » tokens, specs/guest-app/guest-app.md §6): eyebrow « BIEN-ÊTRE », title in Marcellus, one line of
  detail, one filled button. Night photo fallback like the bath highlight. When the card holds two buttons they are
  stacked, full width, same height and same width, aligned on the same left edge (reviewed on the mock-up 2026-11-13:
  a text button beside a filled one read as misaligned).
- **Scheduling screen**: AppBar « Bain nordique », the owned line (« 1 h offerte · 2 h réglées »), the mode switch,
  day chips, then either start times (« À la suite », each chip « 18 h – 20 h », evening part marked) or the slot grid
  with the counter (« Réparties »), the stepper « Heures en plus », the quote lines, the sticky button with the total.
- **Refusal**: the over-count slot shakes 2× (reduced motion: no shake, the line alone), the line under the counter
  names the two ways out.
- **Mobile** (< 900 px): full-screen page, sticky button in the thumb zone. **Desktop** (≥ 900 px): a page beside the
  rail like the bath picker, slot grid on 4 columns _(implementation, 2026-11-15: the existing bath picker is a page,
  not a dialog; the two screens stay alike)_.
- Strings: card « 1 h offerte à programmer » / « 3 h à programmer » / « 1 h offerte, 2 h comprises dans le séjour » / « Programmer » /
  « Vos séances » / « Ajouter une heure » / « Changer une séance » / « Réserver » ; screen « À la suite » / « Réparties » / « 2 sur 3 placées » /
  « Heures en plus » / « Supplément soirée » / « Confirmer mes séances » / « Confirmer · 20 € ». English in `en.json` and in `bathPlan.js`.

## 7. Test plan

Server (`server/src/plugins/guest-app/tests/`, 20 cases):
- `guest-bath-plan-units.unit.test.js` (6) — owned minutes, sessions to come, the states, the words of each state, the
  offer's « aujourd'hui / ce soir », the « à la suite » chains.
- `guest-bath-plan-routes.unit.test.js` (13) — through the real routes and the hourly-resources scheduler: the cards of
  `/me` (offered only, held hours, scheduled), no bath highlight beside the card, blocks of 2 h (a taken hour breaks
  them, evening counted), a nonsense `hours` refused, the breakdown (offered in the day 0 €, offered in the evening
  10 € on the test grid, held hours in the evening, 1 offered + 1 extra in a row whatever the allocation, parts adding
  up to the total), a 0 € placement of a held hour that sells nothing and turns the card to « scheduled »; 2 held hours + 1 more in one 3 h block with a 15-minute turnover (30 €, the held line takes 11-13, a line of its own sells 13-14).
- Existing suites moved to the card: `guest-app-home` (the bath has no highlight), `guest-app-slots` rule 11 (the card's
  « aujourd'hui / ce soir »), `guest-app-first-bath-slot-heat` (`firstSlotToday` counts the heat-up from now).

Guest app (Vitest, `apps/guest/src/__tests__/`, 15 cases, fixtures in `bathPlanFixtures.jsx`):
- `BathPlanCard.states.test.jsx` (3) — states, place above or below the tiles, stacked buttons, contacts sheet.
- `BathPlanPage.modes.test.jsx` (4) — no switch at 1 h, blocks asked with `hours=N`, no block → « Réparties », the
  over-count refusal and « ajoutez une heure » (the mode stays « Réparties »).
- `BathPlanPage.quote.test.jsx` (3) — the server total on the button and the cart, the 0 € order sent with
  `payment: 'none'`, a refused quote said with the button closed.
- `BathPlanPage.terms.test.jsx` (5) — rule 17 (2026-11-27): the terms shown and the button closed until ticked, `acceptedTerms` sent, « Lire »,
  nothing owed → nothing asked, `TERMS_OUTDATED` re-asks, above 0 € the page asks nothing.

E2E: none. The Playwright suite does not serve the guest app (a separate Vite app); the scenario was played instead in a
real browser against the guest API on an isolated database (2026-11-15): offered hour in the evening → 20 €, 2 held
hours 20-22 h → 40 €, a 2 h day block confirmed at 0 € and the card turned to « Vos séances », the over-count refusal,
390 px and 1280 px, no horizontal scroll.

## 8. Out of scope

- Moving or cancelling a placed session from the app (Q1).
- Buying hours without a slot (decided 2026-11-13: an extra hour is bought with its slot).
- External bookings (specs/sas/outside-booking-sas.md).
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
