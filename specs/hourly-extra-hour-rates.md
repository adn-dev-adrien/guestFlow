# Hourly resources — a price for the following hours

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/hourly-extra-hour-rates` |
| **Created** | 2026-11-24 |
| **Author** | Adrien |
| **Related PR** | — |

Interactive summary: [`hourly-extra-hour-rates.html`](hourly-extra-hour-rates.html).

---

## 1. Context

A banded hourly resource (the nordic bath: a planning card, a day rate, an evening rate from
`hourlyEveningStart`) has two rate pairs today:

- guests: `price` (day) and `hourlyEveningRate`;
- outside customers: `hourlyExternalDayRate` and `hourlyExternalEveningRate`, each falling back to
  the guest rate when 0.

Every hour of a session costs the same. `specs/gift-voucher-campaigns.md` rules 43–45 (2026-11-18)
added a degressivity table **in percent per hour rank**, shared by both audiences. On 2026-11-24
the owner asked for something else: **a price for the extra hours**, set separately for guests and
outside customers. A percent shared by both audiences cannot say « 1st hour 70 €, then 50 € » for
outsiders and « then 40 € » for guests.

## 2. Goal

On the resource's form, the owner types, for guests and for outside customers, the price of the
first hour and the price of each following hour, in the day and in the evening. Every place that
prices the resource charges exactly that.

## 3. Functional rules

1. **Eight rates, four of them new.** A banded hourly resource carries, per audience (guests,
   outside customers) and per band (day, evening), a **first-hour rate** and a
   **following-hours rate** (€/h).
   - The first-hour rates are today's four fields, unchanged in meaning and fallback.
   - The new fields are `hourlyNextDayRate`, `hourlyNextEveningRate`,
     `hourlyExternalNextDayRate` and `hourlyExternalNextEveningRate`.
   - **An empty following-hours rate means « same as the first hour »** of that band and audience,
     so a resource nobody edits prices exactly as today.
2. **Rank.** The rank of a slice is the hour of the session it falls in, counted from the
   session's start: the first 60 minutes are rank 1, everything after is a following hour.
   - The engine still walks the session in `slotDuration` steps (`priceMinutes`).
   - A slice takes its **band** from its start time (before or after `hourlyEveningStart`), then
     its **rate** from its rank: first-hour rate at rank 1, following-hours rate after.
   - Time added after a voucher's covered minutes keeps counting ranks from the voucher's first
     minute (`rankOffsetMinutes`, unchanged): the added time is always a following hour.
3. **The free hour does not count as a rank** (owner decision of 2026-11-24). A guest's « 1 h
   offerte » (`freeMinutes` of the property) is set aside, valued at the guest's first-hour day rate
   (today's rule), and the ranks start at the first **paid** minute. So a guest who books 2 h with
   the free hour pays the 2nd hour at the guests' **first-hour** rate; a 3rd hour is a following
   hour.
   - In the engine: the rank origin moves forward by the free minutes applied; a slice inside the
     free minutes is priced at rank 1 (its value is the deduction).
4. **Everywhere the resource is priced**, with no exception: the guest app, the reservation fiche
   and its SAS, the evening supplement, a session outside a stay, the planning card, « Mon bain »,
   the gift-voucher campaigns and the dateless session quote. The audience decides the rate set,
   as it already decides the first-hour pair (`rateGridOf`).
5. **Validation.** Each following-hours rate is empty or a number from 0 to 10 000 with at most two
   decimals. Anything else is refused by the server with « Le tarif des heures suivantes (soir,
   extérieurs) doit être un montant positif. » naming the field's band and audience, and the form
   shows that sentence under the field. 0 is a valid value (free following hours) — unlike the
   first-hour external fields, where 0 keeps meaning « same as guests ».
6. **A displayed unit price stays the first hour's.** A slot grid shows the first-hour rate; a
   session's total, priced by the engine, carries the ranks. Where a screen describes the tariff
   in words (catalogue modes of the campaigns, outside booking page), it adds « puis X €/h » when
   the following-hours rate differs.
7. **The percent table is withdrawn.** Rules 43–45 of `specs/gift-voucher-campaigns.md` are
   superseded by this spec. `hourlyDegressiveTiers` is no longer read nor edited.
   - Migration: a resource whose table is not empty gets, for both audiences and both bands,
     a following-hours rate equal to its first-hour rate discounted by the percent of rank 2,
     rounded to the cent; the later rows are dropped, and the migration log says so. Production
     has no table (checked 2026-11-24), so only development copies are concerned.

**Edge cases:**
- A session shorter than or equal to one hour → only first-hour rates.
- A 30-min slot grid, session 19:30–21:00, evening at 20:00 → 19:30–20:00 day rank 1, 20:00–20:30
  evening rank 1, 20:30–21:00 evening following hours.
- Following-hours rate higher than the first hour → allowed (a premium is a choice, not an error).
- Guest booking of 1 h with the free hour → 0 €, as today.

## 4. Architecture

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `plugins/hourly-resources/` | `hourlyPricing.js` | T | `normalizeConfig` takes `dayNextRate` / `eveningNextRate` (fallback to the rank-1 rate); `priceMinutes` and `bandsOf` pick the rate by rank; the percent code is removed |
| `plugins/hourly-resources/` | `bookingPricing.js` | T | `rateGridOf` returns the four rates of the audience; callers pass them through |
| `plugins/hourly-resources/` | `pricing.js`, `scheduler.js`, `schedulingModel.js`, `sessionQuote.js` | T | Build their engine config from `rateGridOf` instead of reading `price` / `hourlyEveningRate` directly |
| `plugins/hourly-resources/` | `catalogueLines.js` | T | « puis X €/h » in the tariff description (rule 6) |
| `plugins/hourly-resources/` | `migrations.js` | T | Four columns, nullable; the percent-table conversion of rule 7 |
| `plugins/gift-vouchers/` | `controllers/campaignsController.js` | T | Serves the catalogue as the family reads it: the `degressiveText` sentence is gone, each session mode carries `followingRateCents` and `followingText` |
| `models/` | `resourcesModel.js` | T | Reads/writes the four columns |
| `controllers/` | `resourcesController.js` | T | Validation of rule 5; drops the percent-table validation |
| `database.js` / `schema.sql` | | T | Column declarations for a fresh database |

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `plugins/hourly-resources/` | `HourlyResourceFields.jsx` | T | The rates become a 2 × 2 grid per audience (rows day/evening, columns « 1re heure » / « Heures suivantes ») |
| `plugins/hourly-resources/` | `DegressiveTiersEditor.jsx` | removed | Replaced by the grid |
| `pages/options/` | `resourceForm.js` | T | Draft fields; the server's refusal sentence under the field |

No new generic component: the grid is specific to banded hourly resources. The client computes
nothing; every price comes from the engine.

### 4.3 API

`GET/PUT /api/resources/:id` gain the four fields (number or `null`) and lose
`hourlyDegressiveTiers`. `GET /api/gift-vouchers/catalogue`: a session mode loses `tiers` and `degressiveText`, gains `followingRateCents` and `followingText` (« puis 45 €/h » or `null`). No public contract changes: the WordPress plugin only reads prices the
server computed.

## 5. Data model

`resources`: `hourlyNextDayRate REAL NULL`, `hourlyNextEveningRate REAL NULL`,
`hourlyExternalNextDayRate REAL NULL`, `hourlyExternalNextEveningRate REAL NULL`. `NULL` = same as
the first hour. `hourlyDegressiveTiers` stays in the table (SQLite) but is no longer read.

## 6. UI / UX

On the resource form, under « Planification par séances + tarif horaire » :

- Two blocks, « Clients hébergés » and « Clients extérieurs », each a small grid: rows
  « Journée » and « Soirée (dès 20:00) », columns « 1re heure » and « Heures suivantes ».
- The following-hours field shows the first-hour value as its placeholder (« = 50 € ») when empty; an outside first hour left at 0 (« same as guests »)
  shows « = 1re heure ».
- The guests' day first-hour cell is the resource's general price (« Prix général »): read only here, edited in the Prix section. The evening switch time
  (« Heure de bascule soir ») stays above the two blocks.
- The refusal sentence of rule 5 is drawn under its field, from the client's own check before saving and from the server's refusal after.
- **Mobile (xs)**: the two columns stay side by side inside each row (two short numeric fields
  fit at 360 px); the two audience blocks stack.

## 7. Test plan

- Server `server/src/tests/hourly-extra-hour-rates.unit.test.js` (22 tests): empty → unchanged prices; outside 18:00–21:00 rates 50/70, following 40/50, evening at
  20:00 → 50 + 40 + 50 = 140; guest 2 h and 3 h with the free hour (first paid hour at the first-hour rate; 90 € and 50 €); 30-min grid crossing the switch; voucher
  added time at the following-hours rate; the audience's rate grid; the words (« puis X €/h »); validation refusals; the stored columns; the migration of a percent table.
- Existing degressivity suites are rewritten to the new rule (rules 43–45 of `specs/gift-voucher-campaigns.md` superseded): `hourly-degressive-pricing.unit.test.js` and
  `HourlyResourceFields.degressive.test.jsx` are deleted, the gift-voucher and outside-visit suites price with following-hours rates.
- Client `HourlyResourceFields.extra-hour-rates.test.jsx` (7 tests): the grid, placeholder, refusal shown, the form's own check, the payload.
- Manual: resource form at 390 / 900 / 1280 px; a quote in the guest app and on the outside page.

## 8. Out of scope

- Prices per rank beyond the second (3rd hour, 4th hour…). One « following hours » price.
- Prices per property (the free hour per property stays as it is).

## 9. Open questions

_All resolved._

- **Resolved 2026-11-24** — the percent table is **replaced** (rule 7), not kept beside the new rates.
- **Resolved 2026-11-24** — with the free hour, the first **paid** hour is at the first-hour rate (rule 3).
