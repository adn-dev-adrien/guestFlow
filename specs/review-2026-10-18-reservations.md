# Review 2026-10-18 — reservation screens, small fixes

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `fix/review-reservations` |
| **Created** | 2026-10-18 |
| **Author** | Adrien |
| **Related PR** | fix/review-reservations → `inte/plugins` |

---

## 1. Context

The end-to-end review of the reservations on 2026-10-18 compared `inte/plugins` with the production
version on a copy of the Solio data. The larger findings have their own rules in the specs of their
features:

| Finding | Where the rule lives |
|---|---|
| F1 — numbering after a cancellation | `reservation-number-and-search.md` rules 13-14 |
| F2 — negative tax credit after a paid stay is reduced | `accounting-books-the-money-collected.md` rule 11 |
| F3 — trop-perçu | `reservation-refunds.md` rule 34 |
| F4, F5 — hourly sessions | `plugins-phase-3c-hourly-resources.md` rules 30-31 |
| F6 — duplicate and abandoned clients | `clients.md` rules 12-13 |
| F7 — city autocomplete under the CSP | `security-hardening.md` rule 12 |
| F9 — `7.2` in an amount field | `reservation-price-arithmetic.md` rule 10 |

**Second review (2026-10-18).** An independent re-run of the batch found no blocker and four
follow-ups, each ruled in its feature's spec:

| Finding | Where the rule lives |
|---|---|
| Trop-perçu refund always booked on Hébergement (major) | `reservation-refunds.md` rule 35 |
| Summary tax and trop-perçu alert disagree while editing | `reservation-refunds.md` rule 35 (the alert's caption per poste) |
| No « Créer quand même » on the fiche | `clients.md` rule 14 |
| Repaired stays only in the boot log | `reservation-number-and-search.md` rule 15 |

This spec holds the small display fixes that belong to no single feature: F8, F10, F11, F12, F13, and
two responsive defects of the display review (M-4, M-5).

## 2. Goal

The reservation screens say what they mean, on a phone, a tablet and a desktop.

## 3. Functional rules

1. **No night count without dates (F8).** The pricing summary shows « (N nuits) » from the server's
   `quote.nights` only, and nothing while there are no dates. It no longer derives the count from the
   form's dates, which gave « (NaN nuit) » on an empty fiche.
2. **A struck-through price is a higher one (F10).** On the devis PDF, a « was » price is struck only
   when it is above the billed one. A manual accommodation price above the engine price prints alone;
   before, the lower engine price was struck above it and read as a discount.
3. **The SAS counts steps without a total (F11).** The SAS header reads « Étape N ». An accepted upsell
   opens its own pages, so a total turned « 9/10 » into « 9/12 » and read as going backwards.
4. **Impersonal texts (F12).** « Adresse en une ligne : n° rue CP ville » (client form), « Par défaut
   toute la tablée. » (served persons of a meal), « Identifiants Qonto manquants (Réglages ›
   Paiements). » (Qonto authorisation without credentials).
5. **A breakfast counted by the day reads in mornings (F13).** The pricing engine tags an option line
   `quantityUnit: 'morning'` when it is the breakfast (`autoOptionType = 'breakfast'`) and its
   quantity counts days: placed on its mornings, or priced `per_night` / `per_person_per_night`
   without a planning card. The summary then reads « Petit déjeuner · 3 matins » instead of
   « Petit déjeuner ×3 ». A breakfast still to plan counts portions and keeps « ×N ».
6. **The fiche fits a tablet (M-4).** The fiche is one column below `lg` (1200 px) and two columns
   (form, 320 px summary) from `lg`; the summary is sticky only in two columns. The client name and
   number centred in the action bar show from `lg` (new `PageActionBar` prop `centerFrom`, default
   `sm`): at 900 px they overlapped the title. Nothing scrolls sideways at 390, 900 or 1280 px.
7. **A long property name never widens a page (M-5).** The property selects of the fiche and of the
   calendar are bounded (`minWidth: 0`, `maxWidth: 100%`; at most 360 px in the calendar bar) and
   ellipsise; the grid tracks around them use `minmax(0, 1fr)`; the summary breaks an unbreakable name.

**Edge cases:**
- A quote without `nights` (still loading) → no count, as without dates.
- A breakfast priced `per_person` (portions) → « ×N », never mornings.
- The tabs of a page keep showing from `sm`: `centerFrom` applies to `center` only.

---

## 4. Architecture

### 4.1 Server side (`server/src/`)

| Layer | File | Change |
|---|---|---|
| utils | `utils/pricing.js` | `withQuantityUnit` tags breakfast lines counting mornings (rule 5). |
| utils | `utils/devisPdf.js` | `showsStruckOriginal`: strike only above (rule 2); `forceOriginal` removed. |
| utils | `utils/qonto/qontoSettingsController.js` | Message (rule 4). Core code since specs/plugins-phase-3a-online-payment.md rule 22, so no plugin bump. |

### 4.2 Client side (`client/src/`)

| Layer | File | Change |
|---|---|---|
| components | `PricingSummary.jsx` | Server night count; « · N matins »; sticky from `lg`; name wraps (rules 1, 5, 6, 7). |
| components | `PageActionBar.jsx` | Generic prop `centerFrom` (rule 6). |
| components | `reservation/StaySection.jsx` | Bounded property select (rule 7). |
| components | `ClientFormFields.jsx`, `reservation/OptionRow.jsx` | Texts (rule 4). |
| pages | `ReservationPage.jsx` | One column below `lg`, `centerFrom="lg"` (rule 6). |
| pages | `CalendarPage.jsx` | Bounded property select (rule 7). |
| plugins | `sas/ReservationSasDialog.jsx` | « Étape N » (rule 3); plugin 1.0.1. |

### 4.3 API contract

Option lines of `POST /api/reservations/calculate-price` (and every quote) may carry
`quantityUnit: 'morning'`. Additive.

## 5. Data model

None.

## 6. UI / UX

- Mobile (390 px): unchanged layout; a long property name ellipsises in the select.
- Tablet (900 px): the fiche is one column, the summary below the form; the bar shows title and actions.
- Desktop (1280 px): two columns, centred client name, sticky summary.

## 7. Test plan

- Server: `review-2026-10-18-reservations.unit.test.js` (rules 2, 4, 5) — 5 tests.
- Client: `PricingSummary.review-labels.test.jsx` (rules 1, 5) — 4 tests;
  `ReservationSasDialog.step-counter.test.jsx` (rule 3) — 1 test.
- E2E: `reservations/review-2026-10-18-layout.spec.js` (rules 6, 7) — 5 tests at 390, 900 and 1280 px.
- Second review: server `reservation-overpayment-by-poste.unit.test.js` (5),
  `clients-duplicate-created-from-the-fiche.unit.test.js` (1),
  `reservation-number-repair-shown-until-checked.unit.test.js` (3); client
  `RefundDialog.overpayment-by-poste.test.jsx` (3), `DialogProvider.secondary-action.test.jsx` (4),
  `RepairedReservationNumbersAlert.test.jsx` (3).

## 8. Out of scope

- The other display findings of the review (their own batches).

## 9. Open questions

None.
