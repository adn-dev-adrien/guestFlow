# Property capacity — one total instead of three additive buckets

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/property-capacity-single-total` |
| **Created** | 2026-08-14 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |

---

## 1. Context

A property declares its capacity as **three independent maxima** — `maxAdults`, `maxChildren`
(2–18 years), `maxBabies` (0–2 years) — and every guard treats them as separate buckets **whose sum
is the total capacity**:

- `server/src/controllers/reservationsController.js:158` (`checkCapacity`) — one check per bucket,
  `totalMax = maxAdults + maxChildren + maxBabies`.
- `client/src/pages/ReservationPage.jsx:1246-1278` — the same formula, mirrored client-side.
- `server/src/controllers/public/publicBookingRequestController.js:20` — same buckets, hard 409.
- `integrations/wordpress/guestflow-booking/blocks/properties/view.js:40` — the public property card
  advertises `maxAdults + maxChildren + maxBabies` as "capacité".

This model is wrong in both directions and it bit in production:

1. **False rejections.** `Aventura lodge` is configured `maxAdults 5 / maxChildren 0 / maxBabies 1`
   — "5 personnes" as the operator understands it. Booking **1 adult + 1 child** trips the children
   bucket (`1 > 0`): the back-office turns the field red and demands a "Forcer l'enregistrement",
   and the **public site refuses the request outright** with `409 OVER_CAPACITY` — no override
   possible, the guest simply cannot book. Two people in a five-person lodge.
2. **False acceptances / wrong advertising.** For `Gite` (`10 / 8 / 3`) the additive total is **21
   people**, which is what the WordPress property card currently advertises and what the back-office
   would accept without a warning.

Nobody can configure "5 people, whatever their age" with three buckets: any per-age split either
blocks legitimate mixes or inflates the total.

## 2. Goal

An operator declares **one number** — how many people the property sleeps — plus a separate baby
allowance, and any age mix that fits under that number is accepted everywhere (back-office, public
site, WordPress widget) without a forced override.

## 3. Functional rules

**Capacity model**

1. A property declares exactly two capacity numbers:
   - **`maxGuests`** — maximum number of guests aged **over 2** (adults + teens + children).
   - **`maxBabies`** — maximum number of babies (**0–2 years**), which do **not** consume a
     `maxGuests` slot.
2. Occupancy is valid when **both** hold:
   - `adults + children + teens ≤ maxGuests`
   - `babies ≤ maxBabies`
   There is no per-age sub-limit and no additive total any more.
3. `adults ≥ 1` on every reservation (unchanged).
4. Babies are excluded from the guest total because the pricing engine already counts
   `persons = adults + children + teens` (`server/src/utils/pricing.js:1276`) and bills babies at
   zero. Capacity and price now agree on who counts as a guest.
5. A child sleeping in a baby bed **still consumes a `maxGuests` slot**. The former relief
   (`childrenSleepingInBabyBeds` subtracted from the children bucket, `ReservationPage.jsx:1273` /
   `reservationsController.js:166`) disappears from the *people* check: `maxGuests` counts people in
   the property, not regular beds. The bed-side nuance is unaffected — it lives in
   `requiredRegularBeds` / `bedsCapacityMismatch` (bed-linen card) and in `checkBabyBeds`, both
   untouched by this spec.

**Enforcement — same guards, new formula**

6. **Back-office (reservation fiche)** — exceeding capacity stays a **warning that can be forced**:
   red field + `Capacité du logement dépassée` confirm dialog + `forceCapacity` (unchanged
   mechanics, single message).
7. **Public API (`POST /public/v1/booking-requests`)** — exceeding capacity stays a hard
   `409 OVER_CAPACITY`, no override.
8. **Both sides run the same pure function** (`server/src/utils/capacity.js`). The client mirrors it
   only to render the inline warning; the server decision is authoritative.

**Existing data**

9. **No existing reservation is re-validated, altered or blocked by this change.** Capacity is
   checked only when the occupancy actually changes — server-side via the existing
   `occupancyUnchanged` guard (`reservationsController.js:738-764`), client-side via its twin
   (`ReservationPage.jsx:1956`). A legacy reservation that would breach the new `maxGuests` stays
   editable (dates, price, options, payments) without any capacity prompt as long as its guest
   counts are untouched.
10. Migration derives `maxGuests` from the existing `maxAdults` (see §5). No property becomes more
    permissive than it is today on the adults axis, and every property stops rejecting children.

**Public surface**

11. The public property payload exposes `maxGuests` and `maxBabies`. `maxAdults` is kept as a
    **deprecated alias equal to `maxGuests`** so the manually-deployed `gf-seo-*` mu-plugins keep
    reporting the right `capacite` until they are redeployed. `maxChildren` is **removed** from the
    payload: under the new model it has no correct value, and its only consumer is fixed here.
12. The WordPress property card advertises `maxGuests` (+ babies mentioned separately), not a sum.
13. The WordPress booking widget **caps its guest steppers** at `maxGuests` (adults + teens +
    children combined) and `maxBabies`, so a visitor can no longer compose an occupancy the API will
    reject at submit time.

**Edge cases**

- **The two zeros are NOT symmetric** (decided during implementation, 2026-08-14):
  - `maxGuests = 0` (never set) → "capacity not configured": the guest guard is off and the section
    shows no capacity caption, so a half-configured property is never unbookable — precisely the
    failure mode this spec exists to kill.
  - `maxBabies = 0` → an explicit "no babies accepted" (no cot), enforced exactly as before. Reading
    it as "not configured" would have silently lifted a guard properties rely on today.
- Occupancy exactly at `maxGuests` → accepted, no warning.
- `babies > maxBabies` → own message, independent of the guest total.
- Both breached → one confirm dialog listing both parts (`voyageurs: 7/5 • bébés: 2/1`).
- Property changed on an existing reservation → occupancy is considered changed (property is part of
  the `occupancyUnchanged` comparison), so the new property's capacity applies. Unchanged behaviour.

---

## 4. Architecture

> Fat backend: the capacity rule is one pure server function consumed by the back-office controller
> and the public controller. The client re-computes it **only** to render the inline warning before
> submit (pure UX), exactly as it does today — the server remains the only authority.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `utils/` | `capacity.js` | C | Pure `checkGuestCapacity({ maxGuests, maxBabies }, { adults, children, teens, babies })` → `null \| { parts, message }`. Single source of the rule + of the French message. |
| `controllers/` | `reservationsController.js` | T | `checkCapacity` drops the three-bucket logic and delegates to `utils/capacity.js`; keeps the bed-count checks and the `forceCapacity` escape hatch. |
| `controllers/public/` | `publicBookingRequestController.js` | T | Local `checkCapacity` replaced by the shared util; still answers `409 OVER_CAPACITY`. |
| `models/` | `propertiesModel.js` | T | INSERT/UPDATE column lists: `maxAdults, maxChildren` → `maxGuests`. |
| `models/` | `reservationsModel.js` | T | `getPropertyCapacity` selects `maxGuests, maxBabies` (+ beds). |
| `utils/` | `publicProjections.js` | T | `toPublicProperty` exposes `maxGuests`, keeps `maxAdults` as deprecated alias, drops `maxChildren`. |
| `database.js` | `database.js` | T | Idempotent migration block: add `maxGuests`, backfill, drop `maxAdults`/`maxChildren`. |
| `schema.sql` | `schema.sql` | T | Fresh-install definition of the `properties` table. |
| `routes/` | — | — | (none — no per-field validation there) |

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `pages/` | `PropertyDetail.jsx` | T | Capacity block: two fields (`Max voyageurs`, `Max bébés`) instead of three. |
| `pages/` | `PropertiesPage.jsx` | T | Card summary line: `N voyageurs · N bébés`. |
| `pages/` | `ReservationPage.jsx` | T | Capacity computation reduced to `maxGuestsAllowed` / `exceedsGuestsCapacity` / `exceedsBabiesCapacity`; confirm-dialog message; context payload. |
| `components/reservation/` | `GuestsBedsSection.jsx` | T | `(max N)` hint moves from "Adultes" to the section, `max` attributes, single error state. |
| `components/reservation/` | `mockReservationForm.js` | T | Mock context keys follow the new names. |
| `hooks/` `services/` `utils/` `constants/` `styles/` | — | — | (none) |

**Component reuse declaration:**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing generic)** | `PageActionBar`, `ConfirmDialog`/`DialogProvider` (`confirm`), MUI `TextField` | No new dialog or field wrapper — the capacity block is two plain `TextField`s in the existing "Capacité" grid. |
| **Created (new generic)** | — | None. |
| **Specific (kept feature-local)** | — | None. |

### 4.3 WordPress (`integrations/wordpress/`)

| File | T/C | Responsibility |
|---|---|---|
| `guestflow-booking/blocks/properties/view.js` | T | Card capacity = `maxGuests` (fallback `maxAdults` alias), babies shown separately. |
| `guestflow-booking/blocks/booking/view.js` | T | Guest steppers capped: `adults + teens + children ≤ maxGuests`, `babies ≤ maxBabies`; capacity line under the "Voyageurs" section. |
| `guestflow-booking/includes/class-gf-blocks.php` | T | New i18n strings (`guestsUnit`, `babiesUnit`) for the capacity hint. |
| `solio-site/mu-plugins/gf-seo-facts.php` | **not touched** | That directory is not versioned in this repo (never committed, not ignored), so it cannot ship in this PR. It reads `maxAdults`, which the public API keeps as an alias of `maxGuests` (rule 11) — the SEO facts stay correct with **no redeploy needed**. Point it at `maxGuests` whenever the directory gets versioned. |

### 4.4 API contract

| Method | Endpoint | Request body | Response | Notes |
|---|---|---|---|---|
| GET | `/api/properties`, `/api/properties/:id` | — | property row with `maxGuests`, `maxBabies` | `maxAdults`/`maxChildren` gone (admin API, client updated in the same PR). |
| POST/PUT | `/api/properties[/:id]` | `{ …, maxGuests, maxBabies }` | property | `maxGuests` defaults to `2` when absent (previous `maxAdults` default). |
| GET | `/public/v1/properties[/:id]` | — | `{ …, maxGuests, maxBabies, maxAdults (deprecated alias) }` | `maxChildren` removed (rule 11). |
| POST | `/public/v1/booking-requests` | unchanged | `409 OVER_CAPACITY` when rule 2 fails | Message unchanged. |
| POST/PUT | `/api/reservations[/:id]` | unchanged (+ `forceCapacity`) | `400 { error }` when rule 2 fails and `forceCapacity` is falsy | Only when occupancy changed (rule 9). |

---

## 5. Data model

```sql
-- properties
+ maxGuests INTEGER DEFAULT 2      -- guests over 2 years old (adults + teens + children)
  maxBabies INTEGER DEFAULT 0      -- unchanged
- maxAdults INTEGER DEFAULT 2      -- dropped
- maxChildren INTEGER DEFAULT 0    -- dropped
```

**Idempotent migration block in `server/src/database.js`** (mirrors the existing add → backfill →
drop pattern used for the per-property VAT columns, `database.js:387-395`):

1. If `maxGuests` is absent → `ALTER TABLE properties ADD COLUMN maxGuests INTEGER DEFAULT 2`.
2. If `maxAdults` is still present → `UPDATE properties SET maxGuests = COALESCE(NULLIF(maxAdults, 0), 2)`.
3. Drop `maxAdults` then `maxChildren` when present.

Backfill rationale: `maxAdults` is the number the operator actually used as "how many people fit"
(`Gite` 10 = the "gîte 10 personnes" of the public site; `Aventura lodge` 5 = the lodge's advertised
capacity). It never widens a property beyond what it accepts today on the adults axis, and it is
editable in one click afterwards.

Re-running on an old restored backup is safe: the block is driven by `PRAGMA table_info`, so it
re-adds and re-backfills `maxGuests` before dropping the legacy columns again.

**Data impact:** properties only. **No reservation row is read, rewritten or re-validated** — the
historical guest counts stay exactly as they are (rule 9). Dropping two columns is irreversible on a
given database file; the nightly backup covers the rollback path.

## 6. UI / UX

**Fiche logement — `PropertyDetail.jsx`, "Capacité" block**

```
Avant                                   Après
┌────────────┬────────────┬───────────┐ ┌──────────────────┬──────────────────┐
│Max adultes │Max enfants │Max bébés  │ │Max voyageurs     │Max bébés         │
│     5      │     0      │     1     │ │        5         │        1         │
│            │ 2 à 18 ans │ 0 à 2 ans │ │ + de 2 ans       │ 0 à 2 ans, hors  │
└────────────┴────────────┴───────────┘ │ (adultes, ados,  │ capacité         │
                                        │  enfants)        │                  │
                                        └──────────────────┴──────────────────┘
```
- Helper texts: `Max voyageurs` → « Adultes, ados et enfants de plus de 2 ans » ; `Max bébés` →
  « 0 à 2 ans, ne comptent pas dans la capacité ».
- Same grid as today, one column less. Responsive: the existing grid already stacks on `xs`
  (`repeat(auto-fit, minmax(…))`), so two fields sit side by side from `sm` and stack on mobile.

**Liste des logements — `PropertiesPage.jsx`**
- `10 adultes · 8 enfants · 3 bébés` → `10 voyageurs · 3 bébés` (singulier/pluriel accordés :
  `5 voyageurs · 1 bébé`).

**Fiche réservation — `GuestsBedsSection.jsx`**
- The `(max N)` hint leaves the "Adultes" label and becomes a section-level caption next to
  « Voyageurs » : `Capacité : 5 voyageurs · 1 bébé`, hidden when `maxGuests` is 0/not configured.
- The four counters (Adultes / Enfants / Ados / Bébés) stay. `Adultes`, `Enfants`, `Ados` all turn
  red together when the total is breached (they share one rule now); `Bébés` keeps its own error.
- Over-capacity line under the counters:
  `Capacité dépassée : 7/5 voyageurs.` (and/or `2/1 bébés.`)
- Confirm dialog on save (unchanged mechanics, new copy):
  « Le nombre de personnes dépasse la capacité configurée (voyageurs: 7/5 • bébés: 2/1). Voulez-vous
  forcer l'enregistrement ? » → `Forcer l'enregistrement` / `Annuler`.
- Responsive: counters keep their `xs: 2 columns / md: 4 columns` grid.

**Sticky action bar:** both pages already render `PageActionBar` (`PropertyDetail` save/cancel +
delete, `ReservationPage` its full bar). No action added or removed by this spec.

**WordPress widget**
- Under the « Voyageurs » section title: `Capacité : 5 voyageurs · 1 bébé`.
- `+` becomes inert once `adults + teens + children` reaches `maxGuests` (same visual as the existing
  baby-bed cap, which already uses a dynamic `max`).

## 7. Test plan

### Server unit tests — **2791 pass / 0 fail** (`cd server && npm test`)
- [x] `tests/property-capacity.unit.test.js` (C, 9 tests) — pure util: 1 adult + 1 child under
      `maxGuests 5` passes (the production bug); exact-fit passes; `adults+teens+children >
      maxGuests` fails; babies breach independently; both breached → both parts in the message;
      `maxGuests = 0` disables the guest guard while `maxBabies = 0` still refuses babies; a child in
      a baby bed still counts (rule 5).
- [x] `tests/reservations-controller-capacity.unit.test.js` (C, 5 tests) — create rejects `400` over
      capacity, passes with `forceCapacity`; update with **unchanged** occupancy on an
      over-capacity legacy reservation saves without any capacity error (rule 9).
- [x] `tests/public-booking-request-controller.unit.test.js` (T, +1) — `409 OVER_CAPACITY` on the new
      rule; 1 adult + 1 child accepted under `maxGuests 5`.
- [x] `tests/public-projections.unit.test.js` (T) — payload key set: `maxGuests` present,
      `maxAdults` mirrors it, `maxChildren` absent.
- [x] Existing suites mocking `getPropertyCapacity` (`reservations-controller-edit-overlap`,
      `…-platform-normalisation`, `…-bed-linen-invariant`) updated to the new shape.

### Client tests (vitest) — **898 pass / 0 fail** (`cd client && npx vitest run`)
- [x] `pages/__tests__/PropertyDetail.test.jsx` (T) — two capacity fields, old ones absent.
- [x] `components/reservation/__tests__/GuestsBedsSection.test.jsx` (T, +4) — capacity caption,
      caption hidden when unconfigured, over-capacity line, babies line independent.
- [x] `components/__tests__/GuestsBedsSection.{no-beds,baby-bed}.test.jsx` (T) — new mock keys.

### E2E (Playwright) — **59 pass / 1 skipped** (`npm run test:e2e`)
- [x] `specs/tariff/*.spec.js` fixtures (T) — `maxAdults: 5` → `maxGuests: 5`.

### Manual verification (2026-08-14, dev server + real `guestflow.db`)
- [x] Migration on the real dev DB: `Gite` → 10 voyageurs, `Aventura lodge` → 5, `maxAdults` /
      `maxChildren` dropped.
- [x] API: **1 adulte + 1 enfant** on the lodge → created (the production bug is gone);
      4+1+1 → `400 … (voyageurs: 6/5)`; 2 bébés → `400 … (bébés: 2/1)`.
- [x] Fiche réservation: caption `Capacité : 5 voyageurs · 1 bébé`; 1 adulte + 1 enfant → no red
      field, no warning; 6 adultes + 1 enfant → Adultes/Enfants/Ados red together, Bébés neutral,
      `Capacité dépassée : 7/5 voyageurs.`
- [x] Fiche logement: `Max voyageurs 5` / `Max bébés 1`, `Max adultes` and `Max enfants` gone.
      Liste: `5 voyageurs · 1 bébé`.
- [x] Mobile (390 px): capacity fields stack, counters keep 2 columns, no horizontal scroll.
- [ ] **Not verified:** the WordPress widget/card in a live WP instance (no local WP running in this
      session). Covered by code review + the unchanged public API contract; worth an eyeball on the
      site after deploy.

## 8. Out of scope

- Bed-count logic (`singleBeds`/`doubleBeds`, `bedsCapacityMismatch`, `requiredRegularBeds`) and the
  bed-linen card — untouched.
- Baby-bed **resource availability** (`checkBabyBeds`) — untouched.
- Tourist tax exemptions by age, pricing, extra-guest tiers, tariff recipes — untouched
  (`persons` already excludes babies).
- Per-season or per-period capacity.
- Backfilling / re-validating historical reservations (explicitly excluded, rule 9).
- Removing the deprecated `maxAdults` public alias — a later cleanup once the `gf-seo-*` mu-plugins
  are redeployed.

## 9. Open questions

- Q: Does a child (2–12) sleeping in a baby bed consume a `maxGuests` slot?
  - A (2026-08-14): **Yes** — rule 5. `maxGuests` counts people, not beds; the bed-side relief stays
    in the bed/linen checks. Slightly stricter than the old bucket relief, but the new totals are far
    more permissive overall.
- Q: Migration value for `maxGuests`?
  - A (2026-08-14): `maxAdults` (Gîte → 10, Lodge → 5). Existing reservations are never re-checked.
- Q: Public payload — break or alias?
  - A (2026-08-14): `maxGuests` + deprecated `maxAdults` alias; `maxChildren` dropped; the WordPress
    plugin **and** the `solio-site` mu-plugins are updated in the same PR.
