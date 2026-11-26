# Platform stays are always saveable

| Field | Value |
|---|---|
| **Status** | Approved |
| **Branch** | `feature/platform-stays-always-saveable` |
| **Created** | 2026-11-26 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |

Interactive summary: `docs/specs/2026-11-26-platform-stays-always-saveable.html`.

---

## 1. Context

On 2026-11-26, after the 4.6.0 install, the Booking stay #22301 (Tardy, Granja, 08/07 → 11/07/2027, 3
nights) had its statement corrected on the fiche. The save stopped on « Durée minimale non respectée —
3 nuit(s), inférieur au minimum requis de 4 ». The minimum comes from the « Très haute » season, which
starts on 10/07 and requires 4 nights. The stay touches that night, and GuestFlow applies the most
restrictive minimum among the nights a stay touches (`pricing/tariff-recipes.md` rule 20). Booking only
reads the minimum of the arrival date (08/07, « Haute », 2 nights), so it sold the 3 nights.

The booking is made and must be honoured. Asking the operator to « force » a stay the platform has
already sold is noise, and it blocks the agents that correct fiches through the UI. The server already
holds the principle for iCal imports (`pricing/tariff-recipes.md` rule 24: « a platform booking that
violates the constraint is a fact to record, not a request to validate »), but the fiche does not.

Adrien, 2026-11-26: « ce qui provient des plateformes est forcément enregistrable et modifiable après
coup par nous ».

## 2. Goal

A stay sold by a platform is saved and edited like any other fiche, whatever the property's stay rules
say. A rule it breaks is shown on the fiche as information, so the platform's settings can be fixed.

## 3. Functional rules

### 3.1 Which stays

1. **A platform stay is any stay whose channel is not `direct`** (`saleChannel(platform).namedChannel`).
   This includes a platform counted as a direct sale (Lodgify): the booking was accepted by a system
   that is not GuestFlow.

### 3.2 What no longer blocks a platform stay

2. **The stay-shape rules never block the save of a platform stay**: minimum nights, maximum nights,
   arrival and departure weekdays (`tariff-recipes.md` rules 20, 20bis, 23). The quote reports no breach for it
   (`minNightsBreached`, `maxNightsBreached`, `changeoverBreached` are `false`), so the fiche opens no
   dialog and the server returns no `409`. This holds on create and on update, with dates moved or not.
3. **The guest capacity never blocks a platform stay** (`property-capacity-single-total`). The server
   tells the fiche whether capacity is judged (`quote.capacityJudged`), and the fiche reads it rather
   than deciding on its own.
4. **What still blocks a platform stay**: an overlap with another stay (anti-overbooking,
   never relaxed), the beds limit (the bed configuration is ours, not the platform's), a resource that
   is not available, the typed-count alerts, the trop-perçu confirmation, the past-stay lock. None of
   these is a rule the platform decides.

### 3.3 The breach stays visible

5. **The broken rule is stated on the fiche, worded by the server** (`quote.stayRuleNotes`, a list of
   French sentences), as an information line under the dates in the « Séjour » section.
   Example: « Booking a vendu 3 nuits ; ces dates en demandent 4 (« Très haute » dès le 10/07). À
   corriger sur Booking pour les prochaines réservations. »
6. The line informs and never asks: no button, no confirmation, and it does not prevent the save.

### 3.4 Direct stays

7. **A direct stay keeps the current guard**: the « Forcer l'enregistrement » dialog, the `409` with
   its code and the force flags.
8. **A save that moves neither the dates nor the party never re-judges the stay shape or the
   capacity, whatever the channel.** This extends `edit-reservation-blocked-by-overlap`, which already
   spares a finance-only edit from the overlap and capacity guards, to the minimum, maximum and
   changeover rules.

### 3.5 Unchanged

9. The website's public path still refuses every breach (`site/public-api.md` rule 12).
10. iCal imports and platform intakes stay unblocked (`tariff-recipes.md` rule 24).

    > **Sans test** — unchanged behaviour: iCal imports never went through the fiche's guards, and this change touches neither (covered by the iCal suites).
11. A stay switched from a platform to `direct` falls under rule 7 again at its next save.

**Edge cases:**
- Platform stay whose dates the operator moves into a period with a higher minimum → saved, note shown.
- Platform stay above capacity (an added guest reported by the platform) → saved, note on capacity.
- Platform stay that overlaps another stay → refused as today (rule 4).
- Direct stay, statement or payment edit only → saved without any dialog (rule 8).

---

## 4. Architecture

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `utils/` | `stayRuleJudgement.js` | C | Pure: `stayMovement(stored, posted)` says what a save moves against the STORED row (dates, property, party); `judgeStayRules` says, from the quote's breaches, the channel and that movement, which breaches still block and words the notes (rules 2, 3, 5, 8); `quoteWithJudgement` reports a non-blocking breach as none |
| `controllers/` | `reservationsController.js` | T | `calculatePrice`, `create`, `update` and `checkCapacity` read the judgement instead of the raw breaches; the quote carries `capacityJudged` and `stayRuleNotes` |
| `models/` | — | — | (none) |
| `database.js` | — | — | (none: no schema change) |

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `pages/` | `ReservationPage.jsx` | T | The capacity confirm follows `quote.capacityJudged`; the stay-shape confirms are unchanged (they already follow the quote's breaches, which the server now clears) |
| `components/` | `reservation/StaySection.jsx` | T | Renders `quote.stayRuleNotes` as info lines under the dates |

**Component reuse declaration:** the note is an MUI `Alert severity="info"`, the pattern the fiche
already uses for its server lines. No new generic component.

### 4.3 API

- `POST /api/reservations/calculate-price` → adds `capacityJudged: boolean` and `stayRuleNotes: string[]`.
  "Moved" (rule 8) is read server-side against the stored row named by `reservationId` (a creation or a
  devis moves everything): the client never says whether it moved. Capacity is re-judged when the
  property or the party moved; the minimum, maximum and changeover when the dates, the property or the
  party moved. For a platform stay `stayRuleNotes` is filled whether or not anything moved; for a direct
  stay it is always empty.
- `POST /api/reservations`, `PUT /api/reservations/:id` → no longer return `409 MIN_NIGHTS`,
  `MAX_NIGHTS`, `CHANGEOVER` or the capacity refusal for a platform stay, nor for a save that moves
  neither the dates nor the party (rule 8). The `force*` flags still exist for direct stays.

## 5. Data model

No change.

## 6. UI / UX

- Platform stay: « Enregistrer » saves directly; an info line under the dates states the broken rule.
- Direct stay that moves its dates or party: unchanged (« Forcer l'enregistrement » dialog).
- Mobile: the info line wraps under the date fields, full width; nothing else moves.

## 7. Test plan

Server unit tests, `server/src/tests/platform-stays-always-saveable.unit.test.js`:
- Rule 2: platform stay under the minimum, over the maximum, off the changeover day → saved without force on create and update.
- Rule 3: platform stay above capacity → saved without `forceCapacity`; `capacityJudged` false.
- Rule 4: platform stay overlapping another → still refused; beds over the limit → still refused.
- Rule 5: `stayRuleNotes` worded for each breach, empty when none.
- Rules 7, 8: direct stay moving its dates → `409 MIN_NIGHTS` as before; direct stay, finance-only edit → saved.
- Rule 9: public request under the minimum → still refused.

Client: `ReservationPage.platform-stays.test.jsx`, which checks that no dialog appears and the note shows.
E2E: one platform fiche saved under the minimum in the smoke suite.
Manual: Tardy #22301 re-saved in prod after release with its corrected statement (mobile and desktop).

## 8. Out of scope

- Writing the stay rules to Booking or another platform (no API for it). The Booking minimum-stay
  setting is fixed by hand in the extranet.
- Relaxing the overlap guard for any channel.

## 9. Open questions

None. Resolved 2026-11-26 by Adrien:
- Q1 → every channel but `direct`, Lodgify included (rule 1).
- Q2 → the info line is shown (rule 5).
- Q3 → rule 8 included: a save that moves neither dates nor party never re-judges the stay shape, every channel.
