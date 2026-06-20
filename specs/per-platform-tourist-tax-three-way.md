# Per-platform tourist tax — three-way handling (platform-remits / platform-reverses / owner-collects)

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/per-platform-tourist-tax-three-way` → revised on `feature/tourist-tax-global-and-charged` _(user-managed)_ |
| **Created** | 2026-06-19 |
| **Author** | Adrien |
| **Related PR** | #249 (initial), follow-up (global + case-1 charged) |
| **Supersedes** | extends [per-platform-tourist-tax-collection.md](per-platform-tourist-tax-collection.md) (binary → three-way) |

> **Revision (2026-06-19, follow-up PR).** Two corrections after the first cut (#249):
> 1. **The mode is GLOBAL per platform** — it lives on the `platforms` table (like `platforms.color`),
>    not per-property on `ical_sources`. Changing a platform's mode on one property applies to **all**
>    properties. The per-property `ical_sources.collectsTouristTax` / `touristTaxRemittedByPlatform`
>    columns are deprecated (no longer read).
> 2. **Case 1 (`platform_reversed`) is CHARGED, not offered.** The tax now appears on the reservation
>    fiche (not struck-through) and is scheduled in the **balance** (the platform pays it to us with the
>    settlement). Stored `touristTaxTotal` is the real amount, so the **standard** tax-in-balance path
>    books it on `46710000` — the `reversedPlatformTaxTtc` special-case from #249 is removed.
> "Offered" (struck-through, zeroed, absent from our books) now means **case 2 only**. The driving rule:
> **anything WE remit to the commune (direct, case 1, case 3) appears in the « Taxe de séjour » page.**

---

## 1. Context

Today the per-platform tourist-tax setting on each property's `ical_sources` row is **binary**
(`collectsTouristTax`, see [per-platform-tourist-tax-collection.md](per-platform-tourist-tax-collection.md)):

| `collectsTouristTax` | Meaning today | Quote | Suivi taxe de séjour | Comptabilité |
|---|---|---|---|---|
| `1` (default) | « Plateforme » | offered (not charged by us) | **excluded** | no tax line |
| `0` | « Vous » | charged at arrival (complement) | **included** | `46710000` line |

This binary collapses **two genuinely different real-world cases** into the single `= 1` state:

1. **The platform collects the tax from the guest and reverses it to us at settlement.** We are the
   ones who must remit it to the commune → it **must** appear in *Suivi taxe de séjour* and the
   accounting pass-through (`46710000`). The platform payout includes the tax.
2. **The platform collects the tax from the guest and remits it to the commune itself.** We never
   touch it → correctly hidden from Suivi and accounting. *(= today's `collectsTouristTax = 1`.)*

The current code treats **both** as case 2, so a case-1 platform's tax silently disappears from the
remittance report and the books — wrong, because we still owe it to the commune.

The third case (the owner collects at check-in) already works: the engine routes the tax into the
**Complément à percevoir** bucket (`isTouristTaxCollectedOnArrival`), it shows in the SAS arrival
recap total, in Suivi, and on the `46710000` accounting line. *(= today's `collectsTouristTax = 0`.)*

## 2. Goal

Turn the per-platform tourist-tax setting into a **three-way choice** and propagate it coherently to
the quote, the *Suivi taxe de séjour* report, and the *Comptabilité* export:

| Mode (GLOBAL per platform) | Charged on the fiche? | Where in the schedule | We remit to commune? | « Taxe de séjour » page | Compta `46710000` |
|---|---|---|---|---|---|
| **`platform`** — plateforme collecte + reverse à la commune (case 2, default) | No (offered, struck-through) | — (`touristTaxTotal = 0`) | **No** | excluded | no |
| **`platform_reversed`** — plateforme collecte + nous reverse (case 1) | **Yes (charged)** | **balance** (platform pays it with the settlement) | **Yes** | **included** | **yes (in the balance)** |
| **`owner`** — à collecter à l'arrivée (case 3) | Yes (charged) | complément (at check-in) | **Yes** | included | yes (in the complement) |

`direct` bookings are implicitly « owner collects + we remit » (tax in the balance), unchanged.

## 3. Functional rules

### Data / resolution

1. Each `ical_sources` row keeps **`collectsTouristTax`** (1 = the platform charges the guest / the
   tax is *offered* on our quote; 0 = we charge it at arrival) and gains a second boolean
   **`touristTaxRemittedByPlatform`** (1 = the platform remits to the commune, we don't touch it;
   0 = **we** remit). The two booleans encode exactly three valid states:
   - `collectsTouristTax = 1, touristTaxRemittedByPlatform = 1` → **`platform`** (case 2).
   - `collectsTouristTax = 1, touristTaxRemittedByPlatform = 0` → **`platform_reversed`** (case 1).
   - `collectsTouristTax = 0, touristTaxRemittedByPlatform = 0` → **`owner`** (case 3).
   The invalid combo `collectsTouristTax = 0, touristTaxRemittedByPlatform = 1` (« we collect at
   arrival but the platform remits ») is **normalised away in the model**: whenever
   `collectsTouristTax = 0`, `touristTaxRemittedByPlatform` is forced to `0`.
2. **Guest-facing quote is unchanged** between `platform` and `platform_reversed`: both are *offered*
   (`isPlatformCollectingTouristTax` still reads `collectsTouristTax`, so the engine keeps zeroing
   `touristTaxTotal` and the deposit/balance/complement schedule is identical). The ONLY difference
   between case 1 and case 2 is **who remits** → Suivi + compta. `owner` keeps today's
   collect-on-arrival schedule (tax in the complement from save 1).
3. **« We remit »** predicate (drives Suivi + compta inclusion), per reservation:
   - `platform = 'direct'` → we remit.
   - non-direct → look up the property's iCal source matching `lower(platformKey)` **OR**
     `lower(platformLabel)` (same dual-match as the existing rules) → we remit iff its
     `touristTaxRemittedByPlatform = 0`. No matching source → **default to "platform remits"**
     (we don't remit), preserving the legacy hidden-from-Suivi behaviour for ad-hoc platforms.
4. **Suivi taxe de séjour** (`getTouristTaxExtraction`) includes a reservation iff the « we remit »
   predicate is true. Concretely the SQL `WHERE` swaps `s.collectsTouristTax = 0` →
   `s.touristTaxRemittedByPlatform = 0`. The tax **amount** is recomputed from nights/persons/rate as
   today (`computeTouristTaxBreakdown`), so case-1 reservations — whose stored `touristTaxTotal` is 0
   because the tax is offered — still report the correct would-be amount.
5. **Comptabilité (case 1 — `platform_reversed`):** the reversed tax is a **pass-through** we owe the
   commune, booked on `46710000`, not revenue. The platform settles in a single payout (deposit = 0
   for platforms), so the tax rides the **`balance`** accounting entry:
   - `taxTtc` for the balance entry gains the reversed tax (`= quote.touristTaxOriginalTotal`).
   - the entry's encaissement TTC (and net) grows by the same amount — the payout we banked
     included the tax.
   - the commission stays computed on the stay only (`effectiveGross − finalPrice`), untouched
     by the tax.
   Cases 2 / 3 / direct accounting are **unchanged** (case 2 has no tax in the books; case 3 + direct
   already carry their tax on `46710000` via `touristTaxTotal`).
6. **No retroactive recompute** of stored `touristTaxTotal` / `touristTaxRate` on past reservations.
   The live engine + the report/export queries resolve the new flag; historical stored amounts are
   left alone. The migration backfills the new column so existing behaviour is byte-identical until a
   source is explicitly switched to `platform_reversed`.
7. **SAS arrival recap (case 3 itemisation):** the tourist tax collected at arrival already sits
   inside `complementAmount` (so the SAS total is right), but it is **not itemised**. The reservation
   payload exposes a server-computed **`touristTaxInComplementAmount`** (the tourist-tax portion of
   the complement); the SAS arrival « complément à percevoir » detail renders a **« Taxe de séjour :
   X € »** line when it is `> 0`. This also fixes the case where option/resource complement lines were
   itemised but the tax was not, so the listed lines summed to less than the displayed total.

### Edge cases

- A non-direct manual reservation whose platform has **no** iCal source on the property → « we don't
  remit » (legacy default) → hidden from Suivi, no tax in compta. To make it appear, the operator
  configures the platform row (even URL-less) and picks `platform_reversed` / `owner`.
- `ical_sources` table/column absent (minimal test DB) → resolvers swallow the SQL error and fall
  back to « platform remits / offered » (defensive default).
- A source switched `owner` → `platform_reversed`: future quotes stop charging the tax to the guest
  (offered) but it keeps appearing in Suivi/compta. Past reservations keep their stored schedule
  (rule 6).
- `direct` row has no tax selector (always « owner collects + we remit »); the cell shows « — ».

---

## 4. Architecture

> **Fat backend, thin frontend.** The three-way state is stored as two booleans, resolved entirely
> server-side (engine + finance/accounting SQL + model), and the model owns the
> single-string ⇄ two-boolean mapping. The client only renders a 3-option `Select` and the resulting
> state; the SAS renders a server-computed amount.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `database.js` | [database.js](../server/src/database.js) | T | Idempotent `ALTER TABLE ical_sources ADD COLUMN touristTaxRemittedByPlatform INTEGER NOT NULL DEFAULT 1` (PRAGMA-guarded). One-time backfill `UPDATE ical_sources SET touristTaxRemittedByPlatform = 0 WHERE collectsTouristTax = 0` so existing owner-collect rows correctly say « we remit ». |
| `schema.sql` | [schema.sql](../server/src/schema.sql) | T | Add the column to the `CREATE TABLE ical_sources` for fresh installs. |
| `utils/pricing.js` | [pricing.js](../server/src/utils/pricing.js) | T | Keep `isPlatformCollectingTouristTax` (reads `collectsTouristTax`). **New** `isTouristTaxRemittedByOwner(db, propertyId, platformKey)`: direct → true; else match source by `platformKey`/`platformLabel` → `touristTaxRemittedByPlatform = 0` ? true : false; no source/missing table → false. The quote returns a new boolean **`touristTaxRemittedByOwner`** (and keeps `touristTaxOfferedByPlatform`, `touristTaxCollectedOnArrival`, `touristTaxOriginalTotal`, `touristTaxTotal`). |
| `models/financeModel.js` | [financeModel.js:389](../server/src/models/financeModel.js#L389) | T | `getTouristTaxExtraction` WHERE: `s.collectsTouristTax = 0` → `s.touristTaxRemittedByPlatform = 0` (the dual `platformKey`/`platformLabel` match is unchanged). |
| `models/accountingModel.js` | [accountingModel.js:288](../server/src/models/accountingModel.js#L288) | T | `buildEntry`: when `quote.touristTaxOfferedByPlatform && quote.touristTaxRemittedByOwner` (case 1) and `kind === 'balance'`, add `round2(quote.touristTaxOriginalTotal)` to `taxTtc` (→ `46710000`) and to the encaissement TTC/net. Both the contrib-driven and legacy paths. Commission/buckets untouched. |
| `models/propertyIcalModel.js` | [propertyIcalModel.js](../server/src/models/propertyIcalModel.js) | T | `SOURCE_COLUMNS` += `touristTaxRemittedByPlatform`. `createSource`/`updateSource` accept a single **`touristTaxCollection`** string (`'platform' \| 'platform_reversed' \| 'owner'`) → derive both booleans; keep accepting the legacy `collectsTouristTax` boolean (derive `remitted` from it). Normalise: `collectsTouristTax = 0 ⇒ touristTaxRemittedByPlatform = 0`. |
| `models/platformsModel.js` | [platformsModel.js:231](../server/src/models/platformsModel.js#L231) | T | `listForProperty` SELECT += `touristTaxRemittedByPlatform`; each row exposes a derived **`touristTaxCollection`** string (+ keep `collectsTouristTax` for back-compat). Default (no source) → `'platform'`. |
| `models/propertiesModel.js` | [propertiesModel.js:112](../server/src/models/propertiesModel.js#L112) | T | `getByIdWithDetails` nested `icalSources` SELECT += `touristTaxRemittedByPlatform` (so any consumer reading the nested array sees the same state). |
| `models/reservationsModel.js` | [reservationsModel.js:451](../server/src/models/reservationsModel.js#L451) | T | The reservation detail mapping exposes **`touristTaxInComplementAmount`** = `touristTaxTotal` when the tax is routed to the complement (`touristTaxInComplement = 1` **or** (`platform != 'direct'` and `touristTaxTotal > 0`)), else `0`. Server-side derivation (fat backend) consumed by the SAS. |
| `controllers/` | propertyIcalController | — | No change — passes `req.body` through; the model owns the mapping. |

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `pages/PropertyDetail.js` | [PropertyDetail.js:591](../client/src/pages/PropertyDetail.js#L591) | T | Replace the « Taxe collectée » `Switch` with a 3-option `Select` (`renderTaxControl`) bound to `row.touristTaxCollection`; read-mode change persists immediately, edit-mode keeps a draft. `editDraft` + `upsertPlatformSource` + `handleToggleTax`→`handleSetTaxMode` send `touristTaxCollection`. `direct` still shows « — ». Column header « Taxe collectée » → « Taxe de séjour ». Mobile cards mirror the Select. |
| `components/PricingSummary.js` | [PricingSummary.js](../client/src/components/PricingSummary.js) | T | When the tax is offered (`touristTaxOfferedByPlatform`), branch the caption on `quote.touristTaxRemittedByOwner`: case 1 → « Collectée par la plateforme, reversée — à déclarer (Suivi taxe de séjour) » ; case 2 (2026-06-20) → struck-through amount + a short **neutral** caption « Collectée et reversée à la commune par la plateforme » and **no « Offert » badge** (it isn't a geste commercial). |
| `components/sas/ReservationSasDialog.js` | [ReservationSasDialog.js:324](../client/src/components/sas/ReservationSasDialog.js#L324) | T | Add a « Taxe de séjour : X € » line to the arrival recap detail when `r.touristTaxInComplementAmount > 0` (folded into `complementDetailLines` or rendered alongside). |
| `api.js` | [api.js](../client/src/api.js) | T | iCal-source CRUD already exists; payload now carries `touristTaxCollection`. No new endpoint. |

**Component reuse declaration:** no new generic component. The 3-option `Select` is a feature-local
composition of existing MUI `Select`/`MenuItem` inside the `PropertyDetail` platform table (same place
the old `Switch` lived). The SAS line reuses the existing `lineText` renderer.

### 4.3 API contract

| Method | Endpoint | Request body | Response | Notes |
|---|---|---|---|---|
| GET | `/api/properties/:id/platforms` | — | rows += `touristTaxCollection: 'platform'\|'platform_reversed'\|'owner'` (+ `collectsTouristTax`) | merged list, additive field. |
| POST/PUT | `/api/properties/:id/ical-sources(/:sourceId)` | `{ …, touristTaxCollection?: string }` (legacy `collectsTouristTax?: boolean` still accepted) | created/updated row | model derives both booleans + normalises. |
| GET | `/api/properties/:id` | — | `icalSources[].touristTaxRemittedByPlatform: 0/1` | nested array, additive field. |
| GET | `/api/finance/tourist-tax-extraction?month=YYYY-MM` | — | rows now also include case-1 (`platform_reversed`) reservations | filter logic changed; payload shape identical. |
| GET (reservation detail) | existing | — | `touristTaxInComplementAmount: number` | additive field consumed by the SAS. |
| GET (accounting export) | existing | — | case-1 balance entries carry the reversed tax on `46710000` | additive; cases 2/3/direct unchanged. |

---

## 5. Data model

**Revised (global storage).** The two booleans live on the **`platforms`** table (global per platform),
not on `ical_sources`:
- **`platforms.collectsTouristTax INTEGER NOT NULL DEFAULT 1`** — the platform charges the guest (1) vs
  we charge at arrival (0).
- **`platforms.touristTaxRemittedByPlatform INTEGER NOT NULL DEFAULT 1`** — the platform remits to the
  commune (1) vs **we** remit (0).
- Three valid states: `platform` (1,1), `platform_reversed` (1,0), `owner` (0,0). The model normalises
  the invalid combo (collects=0 ⇒ remitted=0).
- The per-property **`ical_sources.collectsTouristTax` / `touristTaxRemittedByPlatform`** columns (added
  in #249) are **deprecated** — kept for back-compat but no longer read; the resolvers + the Suivi/compta
  queries key on the global `platforms` row.

**Resolution** of a reservation's platform → the global mode (the `platforms` row): (1) direct match
`lower(platforms.name) = lower(r.platform)` (manual reservations store the label); (2) bridge through
`ical_sources` (`platformKey`/`platformLabel` → `platformLabel` → `platforms.name`) for iCal imports
whose `r.platform` is the hyphenated key. Mirrors how `platforms.color` is resolved.

**Migration (idempotent, `database.js`):**
1. PRAGMA-guarded `ALTER TABLE platforms ADD COLUMN collectsTouristTax INTEGER NOT NULL DEFAULT 1`.
2. PRAGMA-guarded `ALTER TABLE platforms ADD COLUMN touristTaxRemittedByPlatform INTEGER NOT NULL DEFAULT 1`.
3. One-time backfill from the previous per-property `ical_sources` flags (adopt the first non-default
   per-source mode for each platform, matched by label), then enforce `remitted = 0 WHERE collects = 0`.

**Data impact:** purely additive. The default `(1,1)` + the backfill make every existing platform resolve
to its current behaviour, so nothing changes until the operator picks a non-default mode. No
reservation/finance row is rewritten; stored `touristTaxTotal` on past reservations is left alone (case-1
reservations created before this change keep their stored schedule until re-saved).

## 6. UI / UX

- **Fiche logement → Plateformes & iCal** (`/properties/:id`): the « Taxe collectée » cell becomes a
  small **`Select`** (read-mode persists on change; edit-mode drafts), with three options:
  - **« Collectée + reversée par la plateforme »** (`platform`) — caption/help: la plateforme la
    reverse directement à la commune ; absente du Suivi taxe de séjour.
  - **« Collectée par la plateforme, reversée à vous »** (`platform_reversed`) — vous la reversez à la
    commune ; apparaît dans le Suivi taxe de séjour et la compta.
  - **« À collecter à l'arrivée »** (`owner`) — perçue au check-in (complément, visible dans le SAS) ;
    Suivi + compta.
  - Column header renamed « Taxe collectée » → « Taxe de séjour ». `direct` → « — ».
  - **Responsive:** the `Select` replaces the `Switch` in both the desktop table cell and the `xs`
    stacked card; full-width on `xs`, no horizontal scroll.
- **Fiche réservation → PricingSummary:** for an offered tax, the caption distinguishes case 1
  (« …reversée — à déclarer ») from case 2. **Case 2 (2026-06-20):** the amount is shown
  **struck-through** with **no « Offert » badge** (it isn't a geste commercial), and a short neutral
  caption underneath explains the routing: « Collectée et reversée à la commune par la plateforme ».
  Owner-collect (case 3) and direct captions unchanged.
- **SAS arrivée:** the « complément à percevoir » detail gains a **« Taxe de séjour : X € »** line
  when the reservation routes the tax to the complement (case 3 / forced). The total is unchanged
  (the tax was already in `complementAmount`); the line just makes it explicit and reconciles the
  itemised lines with the total.
- **Suivi taxe de séjour:** same page; the monthly extraction now also lists `platform_reversed`
  reservations (we remit). `platform` ones stay excluded.

## 7. Test plan

### Server unit tests (`cd server && npm test` — 1717 pass)

- [x] **`pricing-tourist-tax-three-way.unit.test.js`** (new, 9) — `isTouristTaxRemittedByOwner`:
  direct → true; `platform` (remitted=1) → false; `platform_reversed` (remitted=0) → true; `owner`
  (collects=0 ⇒ remitted=0) → true; no matching source → false; case-insensitive `platformKey`
  **and** `platformLabel` match; missing column/table → false (defensive). Plus: the quote exposes
  `touristTaxRemittedByOwner` consistently for the four cases, and `platform_reversed` leaves the
  guest-facing schedule identical to `platform` (offered, no complement, `touristTaxTotal = 0`).
- [x] **`tourist-tax-collection-coverage.unit.test.js`** (extended, now 6) — a `platform_reversed`
  reservation **appears** in `getTouristTaxExtraction` with the recomputed amount, and surfaces on a
  `46710000` line in the accounting detail + CSV; a `platform` reservation appears in **neither**.
- [x] **`accounting-model-tourist-tax.unit.test.js`** (extended, now 8) — `platform_reversed`
  balance entry: `taxTtc` and encaissement grow by `touristTaxOriginalTotal` (200 → 204.80), the tax
  lands on `46710000`, commission is computed on the stay only, and `platform` stays tax-free.
- [x] **`platforms-and-ical-rework.unit.test.js`** (extended) — `createSource`/`updateSource` map
  `touristTaxCollection` → the two booleans; the `collectsTouristTax = 0 ⇒ remitted = 0`
  normalisation holds; `listForProperty` exposes the derived `touristTaxCollection` string (default
  `'platform'`); `getByIdWithDetails` exposes `touristTaxInComplementAmount` (case 3 / forced → tax,
  direct / offered → 0).
- [x] **`properties-model.unit.test.js`** (extended) — `getByIdWithDetails` exposes
  `touristTaxRemittedByPlatform` on each iCal source.

### Client tests (vitest — 556 pass)

- [x] `pages/__tests__/PropertyDetail.test.js` (extended, 9) — the non-direct platform row renders the
  3-option `Select`; choosing `platform_reversed` upserts the source with that `touristTaxCollection`;
  `direct` shows no selector.
- [x] `components/sas/__tests__/ReservationSasDialog.test.js` (extended, 12) — the arrival recap shows
  a « Taxe de séjour : 4,80 € » line when `touristTaxInComplementAmount > 0` and the detail reconciles
  with the total (Repas 80 + tax 4,80 = 84,80).

### Manual UI verification

- [~] Covered by the automated suites above + the green E2E run (the property fiche / finance /
  comptabilité pages render without console errors). A live manual walkthrough of each mode wasn't run
  separately — the 3-way `Select` persistence and the SAS tax line are asserted by the component tests.

### E2E (Playwright) — `npm run test:e2e`

- [x] Full suite green after the client changes: **28 passed, 1 skipped** (the Select replaces the
  Switch in PropertyDetail; the property fiche + platform list render fine; the e2e server boots with
  the new migration on a fresh DB).

## 8. Out of scope

- No per-reservation override of the platform's tax mode (still per-source, per property).
- No retroactive recompute of past reservations' stored tax (rule 6).
- No change to the tourist-tax **computation** (per-day/per-person, %, fixed) — only the
  collection/remittance routing changes.
- No bulk « apply to all sources of platform X » action.

## 9. Open questions

Resolved during scoping (2026-06-19, via questionnaire):
- **Comptabilité depth for case 1?** → **Full integration**: the reversed tax appears on the
  `46710000` pass-through line of the export, riding the platform payout (balance entry).
- **SAS itemisation for case 3?** → **Yes**: render an explicit « Taxe de séjour : X € » line in the
  arrival « complément à percevoir » recap.
