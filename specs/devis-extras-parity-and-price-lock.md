# Devis ↔ reservation parity — extras, planning cards, and price lock

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `fix/devis-extras-parity` _(Claude-managed)_ |
| **Created** | 2026-08-14 |
| **Author** | Adrien |
| **Related PR** | https://github.com/adn-dev-adrien/guestFlow/pull/423 |
| **Bloc** | Bloc 4 — Devis. See `specs/ROADMAP.md`. |

---

## 1. Context

Since `specs/devis-reservation-fusion.md`, a devis **is** a `reservations` row (`kind='devis'`) whose lines
live in the very same `reservation_options` / `_custom_options` / `_resources` / `_nights` children, and the
form is the very same page (`ReservationPage` in `?mode=devis`). Yet the devis domain kept its **own**
persistence stack (`devisModel.computeQuote` / `persistLines` / `copyLineGraph`), its own row INSERT/UPDATE
column list, and its own client hydration branch. Every extras feature shipped since the fusion landed in the
reservation stack only. The devis stack silently drifted.

**Measured on a copy of the dev database** (same payload, same property, same dates, 8–11 March 2027, 2 adults:
« Ménage » 80 € + « Petit déjeuner » 3 occurrences + « Bain nordique » 18 h–20 h):

| | via the reservation path | via the devis path |
|---|---|---|
| Total | **458 €** | **380 €** |
| Ménage (plain option) | 80 € | 80 € ✅ |
| Petit déjeuner (planning-card option) | 48 € — 3 occurrences | **line dropped entirely** ❌ |
| Bain nordique (hourly resource) | 30 € — 1 session | **line dropped entirely** ❌ |
| `breakfastTime` sent by the fiche | persisted | **dropped** ❌ |
| `extraGuestSurchargeOffered` sent by the fiche | persisted | **dropped** ❌ |

**Root causes, all confirmed by reading the code and by the repro above:**

1. **The option list is empty on « Nouveau devis ».** `DevisPage` navigates to `/reservations/new?mode=devis`
   with no `propertyId` and no dates. In `ReservationPage.jsx` the init effect preselects the first property
   (`props[0].id`) and then **explicitly blanks the catalogue** (`setPropertyOptions([])`,
   `setPropertyOptionGroups(null)`) — the branch that actually loads it
   (`else if (initialPropId && startDate && endDate)`) never runs because there are no dates. Result: the
   « Options et ressources » card renders with **no catalogue option, no category, no resource**, no property
   option default, the property's caution amount (500 €) and its check-in/check-out defaults are not seeded
   either. The Logement select already shows a property, so the operator has no reason to re-pick one — and
   re-picking is the only thing that would repair the state (`handleReservationPropertyChange` does load
   everything). **This is exactly what the report describes.** The same dead-end is reachable for a
   reservation via `/reservations/new` and via the Dashboard/Calendar « + » (`?startDate=…` without
   `endDate`).
2. **`devisModel.computeQuote` strips `cardOccurrences` and `sessions`** when it re-maps the payload for the
   pricing engine. The engine treats an occurrence-less planning-card option and a session-less hourly
   resource as *not taken* and returns `null` for the line — so the option vanishes, silently, with its money.
3. **`devisModel.persistLines` / `copyLineGraph` write a narrower column set** than
   `reservationsModel.insertOptions` / `insertResourceLine`: no `cardOccurrences`, no `sessions`, no
   `inComplement`, no contributions.
4. **The devis row INSERT/UPDATE is missing columns** the reservation INSERT writes: `breakfastTime`,
   `extraGuestSurchargeOffered`, `touristTaxInComplement`, `tariffSnapshot`.
5. **The client devis-load branch hydrates a subset** of what the reservation branch hydrates: no
   `cardOccurrences` rebuild (`buildCardGridFromStored`), no resource `sessions` / `billedUnits` / `priceType`
   / `originalTotalPrice`, no `customOptionId`, no per-line `inComplement`, and
   `extraGuestSurchargeOffered` is hard-coded to `false`.
6. **`convertToReservation` loses the same fields**, so accepting a devis produces a reservation without its
   breakfast planning cards, without its resource sessions, and without the tariff it was sold under.

Two secondary consequences worth naming: a devis is **re-priced at the current tariffs on every save** (a
reservation freezes its unit prices), and the per-line « Compl. » switches are rendered on the devis fiche but
never stored.

## 2. Goal

A devis behaves like the reservation it is about to become: the same option catalogue on screen, the same
lines saved (planning-card occurrences and resource sessions included), the same money — and the price the
guest was quoted holds for as long as the quote is valid.

## 3. Functional rules

### A. The option catalogue on a new devis

1. Opening « Nouveau devis » preselects the first property **as today** and loads its **full context**:
   option catalogue (flat list + collapsible categories), resources, per-property option defaults, default
   check-in / check-out times and default caution amount. What the « Options et ressources » card shows is
   identical to a new reservation on that property.
2. Rule 1 applies to **every** entry point that lands on the form without a complete
   `propertyId + startDate + endDate` triple — `/reservations/new`, `/reservations/new?startDate=…`
   (Dashboard, Calendar « + »), `/reservations/new?mode=devis` — through one shared code path, not three.
3. Changing the Logement select keeps its current behaviour: lines reset, the new property's context loads,
   its option defaults re-apply.
4. Per-property option defaults (bed linen…) are visible on the fiche from the start of a new devis, exactly
   as on a new reservation. (The server already re-merges them at save; the fiche stops lying about it.)
5. **The welcome pack applies to a blank new devis** exactly as it does to a blank new reservation:
   same own channel, same rate, same promise. On Aventura Lodge a fresh devis therefore arrives with
   « Jus de pomme 1L » and the first morning's « Petit déjeuner » already ticked at 0 €
   (decision 2026-08-14 — it amends `specs/welcome-pack-auto-options.md` §3.2 rules 4-5, updated in
   the same commit). A **saved** devis and a fiche prefilled from one keep their own option set.

### B. What a devis persists (parity with a reservation)

6. **Planning-card options** (« Petit déjeuner », « Le repas des trappeurs ») keep their occurrence grid: the
   checked `{date, time}` occurrences are sent, priced (`billedUnits = occurrences × persons` for a
   per-person option) and stored in `reservation_options.cardOccurrences`.
7. **Hourly-scheduled resources** (« Bain nordique ») keep their sessions: the `{date, start, end}[]` are
   sent, priced from the time-banded grid and stored in `reservation_resources.sessions`.
8. `breakfastTime` is persisted on the devis row and re-read on load.
9. `extraGuestSurchargeOffered` is persisted on the devis row and re-read on load (today the fiche sends it
   and the loader hard-codes `false`).
10. `touristTaxInComplement` and the per-line `inComplement` flags are persisted (see rules 17-18).
11. `tariffSnapshot` is written **at devis creation**, exactly like a reservation
    (`specs/tariff-recipes/spec.md` §3.2 rule 12bis) — it is what makes rule 13 auditable.
12. Re-opening a saved devis restores every line as saved: occurrences, sessions, quantities, unit prices,
    `offered`, `inComplement`, custom-option ids.

### C. Price lock tied to the validity date

13. A devis whose `validUntil` is **today or later** is **price-locked**: re-opening it, editing an unrelated
    field and saving keeps the unit prices, the nightly breakdown and the tariff snapshot captured at
    creation. The live preview on the fiche shows those same locked prices — preview and saved value never
    disagree.
14. A devis whose `validUntil` is **past** — or a legacy devis with no `validUntil` — is **re-priced at the
    current tariffs**, on load and on save. Saving it re-issues a validity window
    (`min(today + quoteValidityDays, startDate − 2 days)`), so an expired quote that is worked on becomes a
    fresh, locked quote again.
15. « Actualiser les tarifs » (already present in devis mode) stays the manual way to force current tariffs on
    a still-valid devis — unchanged.
16. The fiche says which state it is in, from a **server-provided** flag, never derived client-side:
    « Devis valide jusqu'au JJ/MM/AAAA » or « Devis périmé — tarifs actualisés ».

### D. Complément routing on a devis

17. On a devis the per-line « Compl. » switch defaults to **OFF**, *including on a non-direct platform* — every
    extra is billed inside the acompte/solde split by default. (This is a deliberate devis-only exception to
    `specs/force-extras-complement-on-platform.md` §3 rule 1: a quote shows the guest one total, not a
    payment plan.)
18. A « Compl. » the operator explicitly switches ON is persisted on the devis line and carried **verbatim**
    into the reservation at conversion. The reservation's own platform rule then applies from its next save,
    unchanged.

### E. Conversion

19. `POST /devis/:id/convert-to-reservation` carries over everything the devis holds: the full line graph
    (occurrences, sessions, `inComplement`, contributions), `breakfastTime`,
    `extraGuestSurchargeOffered`, `touristTaxInComplement`, `tariffSnapshot`, and `pdfLanguage` →
    `emailLanguage`.
20. The resulting reservation produces the same planning cards (petit déjeuner, repas) and the same resource
    sessions as a hand-typed reservation with the same basket. No re-entry after acceptance.

**Edge cases:**

- Planning-card option enabled but **zero** occurrence checked → not billed, not stored (engine rule,
  unchanged); the fiche shows the empty checklist and the caption « Renseignez les dates du séjour… ».
- Devis created from the public WordPress site → unchanged: `planningCardAsQuantity` makes the quantity stand
  in for the occurrences and the line stays « à planifier avec l'hôte » (`specs/public-planning-options.md`).
- Legacy devis with `validUntil = NULL` → treated as expired (rule 14); the first save re-prices it and
  stamps a new validity window.
- Property with no option at all → the card shows only « Options personnalisées ».
- Devis already `converted` → read-only, unchanged.
- Resource no longer available on the devis dates → same warning as on a reservation; the devis still saves
  (a quote does not hold stock).

---

## 4. Architecture

> The whole point of this spec is to stop maintaining **two** persistence stacks over **one** pair of tables.
> Everything below moves logic *out* of the two models into one shared store; nothing new is computed on the
> client. The client's only additions are a property-context loader and a pure row→form mapper — rendering
> preparation, not business logic.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `routes/` | `devis.js` | — | (none — already thin) |
| `routes/` | `reservations.js` | — | (none) |
| `controllers/` | `reservationsController.js` | T | `calculatePrice` accepts `devisId` and asks the model for the locked snapshot when that devis is still valid (rule 13) |
| `controllers/` | `devisController.js` | T | PDF re-quote passes the locked lines so the PDF shows the quoted price, not today's |
| `models/` | `bookingLinesModel.js` | **C** | **The** line-graph store over `reservation_options` / `_custom_options` / `_resources` / `_nights`: `replaceOptions`, `replaceCustomOptions`, `replaceResources`, `replaceNights`, `copyLineGraph`, `getPricingSnapshot`. Single writer, so a new line column can never again land on one side only |
| `models/` | `devisModel.js` | T | delegates all line persistence to `bookingLinesModel`; forwards `cardOccurrences` / `sessions` / `inComplement` to the engine; writes `breakfastTime`, `extraGuestSurchargeOffered`, `touristTaxInComplement`, `tariffSnapshot`; resolves the price lock; `convertToReservation` carries the full row + graph |
| `models/` | `reservationsModel.js` | T | its `insertOptions` / `insertCustomOptions` / `insertResourceLine` / `insertNights` / `getPricingSnapshot` become thin delegates to `bookingLinesModel` — **no behaviour change**, pinned by the existing suites |
| `utils/` | `devisValidity.js` | **C** | pure: `computeValidUntil` (moved out of `devisModel`), `isDevisExpired(validUntil, todayIso)`, `resolveDevisPricingLock(row, todayIso)` |
| `utils/` | `pricing.js` | — | (none — the engine already handles occurrences, sessions and locked lines) |
| `scheduledTasks.js` | — | — | (none) |
| `database.js` | — | — | **no migration** — every column already exists (§5) |

**Notes**

- `bookingLinesModel` is a `createModel(db)` factory like its two callers, so the existing test style
  (in-memory DB + `buildModel`) keeps working.
- No circular require: `bookingLinesModel` depends on nothing but `database`.
- The price lock is decided **server-side** (`resolveDevisPricingLock`) and applied inside
  `devisModel.computeQuote` via the existing `lockedOptionLines` / `lockedResourceLines` /
  `lockedNightlyBreakdown` / `lockedTariff` engine inputs — the same mechanism a reservation already uses.

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `pages/` | `ReservationPage.jsx` | T | one property-context loader for all five init paths (fixes rules 1-4); devis branch uses the shared hydrator; passes `devisId` to `calculate-price`; surfaces `pricingLocked` / `validUntil` in the action-bar subtitle |
| `pages/` | `ReservationPage.jsx` → `loadPropertyContext` | T | the single place that knows how to populate the extras card, called by all five init paths + the Logement select. Kept as a page-level `useCallback` rather than the hook this spec first planned: the four state slots it writes are also written by the availability endpoint, so a hook would have had to leak its setters straight back out |
| `utils/` | `bookingFormHydration.js` | **C** | pure `row → form` mapper (options incl. `cardOccurrences`, custom options incl. `customOptionId`, resources incl. `sessions`, money + flags), shared by the reservation and devis load branches — kills root cause 5 |
| `components/reservation/` | `ExtrasSection.jsx`, `OptionRow.jsx` | T | « Compl. » defaults OFF in devis mode (rule 17) |
| `components/reservation/` | `ReservationFormContext.jsx` | T | carries `isDevisMode`-aware complement default + `pricingLocked` |
| `pages/` | `DevisPage.jsx` | — | (none) |
| `constants/`, `styles/` | — | — | (none) |
| `api.js` | — | — | none: `calculatePrice(data)` forwards the whole body, so `devisId` needed no signature change |

**Component reuse declaration**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing generic)** | `PageActionBar`, `StatusBadge`, `QuantityField`, `ArithmeticTextField`, `DateField` | Pre-existing; no visual change. |
| **Created (new generic)** | — | No new UI component: the extras card already renders everything once the data arrives. |
| **Specific (kept feature-local)** | `bookingFormHydration` | A pure module, reservation-form-specific; it exists to be shared by the two load branches of the same page, not by other pages. |

### 4.3 API contract

| Method | Endpoint | Request body | Response | Notes |
|---|---|---|---|---|
| POST | `/api/reservations/calculate-price` | `+ devisId?: number` | unchanged | When set and that devis is still valid, the engine is fed its locked lines (rule 13). Ignored for an expired devis. |
| GET | `/api/devis/:id` | — | `+ validUntil` (never null — backfilled), `+ expired: boolean`, `+ pricingLocked: boolean` | Feeds rule 16; the client only renders them. |
| POST / PUT | `/api/devis` `/api/devis/:id` | `selectedOptions[].cardOccurrences`, `selectedResources[].sessions`, per-line `inComplement`, `breakfastTime`, `extraGuestSurchargeOffered`, `touristTaxInComplement` | unchanged shape | The fiche **already sends** all of these; the server starts honouring them. Backward-compatible: absent → today's behaviour. |
| POST | `/api/devis/:id/convert-to-reservation` | — | unchanged | Richer copy (rule 19). |

Auth: unchanged (session-bound, admin/operator as today).

---

## 5. Data model

**No schema change, no migration.** Every column the devis stack must start writing already exists on the
unified tables:

| Table | Columns already there, unused by the devis stack |
|---|---|
| `reservations` | `breakfastTime`, `extraGuestSurchargeOffered`, `touristTaxInComplement`, `tariffSnapshot`, `emailLanguage`, `validUntil` |
| `reservation_options` | `cardOccurrences`, `inComplement`, `acompteContribTtc`, `soldeContribTtc` |
| `reservation_resources` | `sessions`, `inComplement`, `acompteContribTtc`, `soldeContribTtc` |
| `reservation_custom_options` | `inComplement`, `acompteContribTtc`, `soldeContribTtc` |

**Data impact.** Existing devis rows are untouched by the deploy itself. On their **first save** after the
change: a devis with `validUntil` in the future keeps its prices (rule 13); a devis with a past or `NULL`
`validUntil` is re-priced at current tariffs and gets a fresh validity window (rule 14) — intentional, visible
in the fiche chip and in the devis history. No risk of loss: the re-price is a normal save, audited like any
other. The dev/prod devis volume is small (1 in dev, a handful in prod).

## 6. UI / UX

**Fiche devis — « Options et ressources ».** No redesign. Today the card is empty on a new devis; after the
fix it renders the same three blocks as a reservation: the flat option list, the collapsible categories
(Animations / Boissons / Restauration), « Options personnalisées », then « Ressources ». Planning-card options
show their occurrence checklist, hourly resources their session editor — the components are already there.

**Action-bar subtitle.** Next to the title, one `Chip` reflecting the server flags (rule 16):

- valid → outlined `info`, « Valide jusqu'au 12/09/2026 »
- expired → outlined `warning`, « Devis périmé — tarifs actualisés »

It sits beside the existing « Tarifs actuels appliqués (non sauvegardé) » chip; both can show at once.

**Copy (French).** « Valide jusqu'au {date} » · « Devis périmé — tarifs actualisés » · tooltip on the « Compl. »
switch unchanged.

**Empty / error / loading states.** Unchanged: `LoadingState` while the page initialises, `ErrorAlert` on a
failed load, « Aucune option personnalisée. » for the empty custom block. A property with no catalogue option
simply hides the « Options » block, as today.

**Responsive.** No new layout. The extras card is already `xs`-stacked / `sm`+-inline (option cards stack their
`[Qté | Compl. | Total]` row on `xs`); the new chip lives in `PageActionBar`'s `subtitle` slot, which already
wraps on `xs`. Verification is required at the three breakpoints anyway (§7).

**Sticky action bar.** `ReservationPage` already renders `PageActionBar` with the devis actions (statut, PDF,
supprimer, Enregistrer/Annuler). This spec only adds the `subtitle` chip — no action added or removed.

## 7. Test plan

### Server unit tests — **25 added, whole suite green at 2800**

- [x] `tests/booking-lines-model.unit.test.js` (7) — the shared store writes every column for options /
      custom options / resources / nights, degrades on a minimal schema, keeps the SAS-origin marker,
      never materialises an internal linen option, and `copyLineGraph` carries `cardOccurrences`,
      `sessions` and `inComplement`
- [x] `tests/devis-extras-parity.unit.test.js` (9) — rules 6-12 and 17-20: the devis prices the §1 basket
      to the same cent as the reservation path (458 € both sides), stores the mornings and the booked
      hours, carries the four row columns through create + update, keeps an unflagged extra out of the
      Complément on a platform devis, and hands the fiche parsed arrays
- [x] `tests/devis-price-lock.unit.test.js` (9) — rules 13-16: unchanged total while valid, re-priced +
      re-dated once expired, « Actualiser les tarifs » override, placement change drops the lock, legacy
      NULL `validUntil` treated as expired, plus the two pure helpers
- [x] Regression, green untouched: `devis-model*.unit.test.js`, `devis-quote.unit.test.js`,
      `devis-pdf*.unit.test.js`, `public-devis-options-persist.unit.test.js`,
      `reservation-option-immutability.unit.test.js`, `pricing-option-planning-card.unit.test.js`,
      `reservation-devis-isolation.unit.test.js`

### Client tests (`cd client && npx vitest run`) — **17 added, suite green at 912**

- [x] `utils/__tests__/bookingFormHydration.test.js` (13) — rule 12, the pure mappers
- [x] `components/reservation/__tests__/ExtrasSection.devis-complement.test.jsx` (4) — rule 17, including
      the reservation counter-case (the platform default still applies there)

### E2E (`npm run test:e2e`)

- [x] `e2e/specs/reservations/devis-extras.spec.js` — « Nouveau devis » shows the catalogue + categories,
      then a save/reopen round trip keeps the ticked option, its total and the validity chip

### Manual UI verification (browser, dev server, 2026-08-14)

- [x] Devis → « Nouveau devis » → catalogue, categories (Animations / Boissons / Restauration), property
      defaults « Inclus », caution 400 € and the logement's 16:00/10:00 all present immediately
- [x] Welcome pack on Aventura Lodge: « Jus de pomme 1L » + first-morning « Petit déjeuner » ticked at
      0 €, tagged « Pack de bienvenue » (rule 5)
- [x] Save → reopen: breakfast still ticked, occurrence checklist restored (« Mar. 11 Mai » checked,
      « Quantité : 1 (1 × 1 pers.) »), category badge « 1 », total unchanged
- [x] Chip « Valide jusqu'au 29/08/2026 » on the reopened devis (rule 16)
- [x] No line pre-routed to the Complément on a direct devis (rule 17)
- [x] Responsive: `xs` 390 px — no horizontal scroll, chip shortened to « Valide 29/08/2026 » so it stops
      colliding with the FR/EN toggle; `lg` 1440 px — nominal. At `md` ~900 px the fiche overflows by
      ~170 px, but **identically on a plain reservation** (pre-existing, out of scope, reported)

## 8. Out of scope

- Platform commission / brut / virement fields on a devis (`platformCommissionAmount` & co.) — a devis is a
  direct-channel artefact; unchanged.
- `depositAmountOverride` and `depositDisabled` on a devis (the fiche already hides them in devis mode).
- Refunds, SAS, mid-stay notes, end-of-stay complement — reservation-only by design.
- The welcome pack on devis (deliberately excluded, rule 5).
- Any change to the devis PDF **layout** (it will simply print the lines it was missing).
- The public/WordPress booking-request flow beyond keeping it working as-is.
- A codebase-wide `roundMoney` consolidation (noted in `specs/devis.md`, still deferred).

## 9. Open questions

**Resolved 2026-08-14** (all three implemented as proposed):

- Q: When an expired devis is re-priced and saved, should it get a **new** validity window from today?
  - A: **Yes** — a quote you are actively editing is a quote you intend to send again. `update` re-issues
    `min(today + quoteValidityDays, startDate − 2)` when the stored window had lapsed (rule 14).
- Q: Should conversion map `pdfLanguage` → `emailLanguage` on the new reservation?
  - A: **Yes** — the operator already told us the guest reads English (rule 19).
- Q: Should the price lock also freeze the tourist tax?
  - A: **Yes, implicitly** — the lock replays the whole stored quote (`lockedNightlyBreakdown` +
    `lockedOptionLines` + `lockedResourceLines` + `lockedTariff`), and the tax follows the frozen stay.
    `specs/tourist-tax-freeze-past-with-refresh.md` keeps owning the reservation side.

**Still open**

- Q: At the `md` breakpoint (~900 px) the reservation/devis fiche overflows its viewport by ~170 px — the
  two-column grid (`1fr 320px`) switches on before there is room for it. Pre-existing, identical on a
  reservation, so it was left alone here. Worth its own one-line fix?

## 10. Implementation plan

Phased; each phase is independently verifiable and leaves the app working.

| # | Phase | Content | Verification |
|---|---|---|---|
| 1 | **Client — unblock the catalogue** | `usePropertyContext` + single property-context load path for all init branches; seed caution / check-in / check-out; apply property option defaults | Rules 1-4; new vitest + manual check. Fixes the reported symptom on its own |
| 2 | **Server — one line store** | Extract `bookingLinesModel`; `reservationsModel` delegates to it (behaviour-identical) | Full server suite green, no new behaviour |
| 3 | **Server — devis parity** | `devisModel` uses the store; forwards occurrences / sessions / `inComplement`; writes the four missing row columns | Rules 6-12; new unit tests, the repro above must invert (380 € → 458 €) |
| 4 | **Server — price lock** | `devisValidity` util, lock resolution in `computeQuote`, `devisId` on `calculate-price`, flags in `GET /devis/:id` | Rules 13-16 |
| 5 | **Client — hydration + UI** | `bookingFormHydration` shared by both branches; « Compl. » default OFF in devis mode; validity chip | Rules 12, 16, 17 |
| 6 | **Conversion** | `convertToReservation` carries the full row + graph | Rules 19-20 |
| 7 | **Docs** | `changelog.d/fixed--devis-extras-parity.md`, this spec → `Implemented`, `specs/welcome-pack-auto-options.md` amended (rule 5) | CLAUDE.md §4.1 checklist |

All seven phases shipped in one PR on `fix/devis-extras-parity`. The §1 measurement, re-run against the
patched code on a fresh copy of the dev database, now reads **458 € on both sides**, with the breakfast
occurrences and the nordic-bath session stored and carried into the converted reservation.
