# GuestFlow — Refactoring Roadmap (Blocs)

> **Why this file exists.** This is the master plan for the consolidation effort: revisiting every
> already-shipped feature to **fix implementation problems, simplify, secure, and improve
> readability**, while enforcing the **fat-backend / thin-frontend** rule (the client must do almost
> nothing but render). It is the regenerated, persisted version of the original "Blocs" study — born
> from a full code audit (May 2026) so it never gets lost again.
>
> **How we work each Bloc** (per CLAUDE.md §3): we write the spec **together** in chat first, the user
> validates it, then Claude implements the whole thing autonomously (code + server tests + UI check +
> CHANGELOG + spec status). One Bloc = one or more `/specs/<feature>.md` = one or more PRs.

**Status legend:** ✅ done · 🟡 partially done · ⬜ not started

> **✅ Consolidation complete (2026-05-29).** All Blocs 0–6 + S are done: every route file is now
> thin (≤38 LOC — devis 1503→15, reservations 1317→29, properties 1238→38), no business/price/finance
> logic remains on the client (the `ReservationPage` client pricing engine is gone), and all 21 `/specs`
> are `Implemented`. The fat-backend / thin-frontend rule now holds across the app. Only two **optional
> product enhancements** were explicitly deferred (not refactor debt) — see "Deferred enhancements" at
> the bottom.

---

## Snapshot of the codebase (audit, May 2026)

**Server route monoliths (logic still inline, no controller/model):**

| Route | LOC | MVC debt |
|---|---|---|
| `routes/devis.js` | 1503 | CRITICAL |
| `routes/reservations.js` | 1317 | CRITICAL |
| `routes/properties.js` | 1238 | CRITICAL |
| `routes/finance.js` | 403 | MEDIUM (read-only) |
| `routes/resources.js` | 322 | MEDIUM |
| `routes/clients.js` | 275 | MEDIUM |
| `routes/resourceBookings.js` | 229 | MEDIUM |
| `routes/googleCalendar.js` | 201 | LIGHT (controller exists) |
| `routes/options.js` | 144 | LIGHT |
| `routes/ical.js` | 70 | LOW |
| `routes/calendarNotes.js` | 45 | LOW |

Already clean (templates to copy): `settings.js`, `schoolHolidays.js`, `establishmentClosures.js`.

**Client pages doing business logic (thin-frontend violations):**

| Page | LOC | Severity | Worst offenders |
|---|---|---|---|
| `ReservationPage.js` | 3433 | CRITICAL | quote application + capacity/bed math + option multipliers |
| `CalendarPage.js` | 2342 | CRITICAL | **full pricing engine** `recalcPrice` (742-807) incl. deposit/balance auto-calc |
| `FinancePage.js` | 531 | CRITICAL | `getRemainingDue` (88-93), overdue derivation + reduce (96-121) |
| `Dashboard.js` | 346 | HIGH | `getRemainingDue` (35-39) — duplicate of FinancePage |
| `PropertyPricingSeasonsPage.js` | 963 | MODERATE | rounding/validation only; preview already server-side |
| `PlanningPage.js` | 801 | MODERATE | quantity multiplier hints duplicate server rules |
| `PropertyDetail.js` | 1108 | MODERATE | config normalization (acceptable) |
| `utils/reservationConflicts.js` | — | MODERATE | conflict-type derivation should be server-returned flags |

**Security findings (cross-cutting — see Bloc S):**

1. **CRITICAL — No authentication/authorization.** `index.js:23` `app.use(cors())`, zero auth middleware. Every route (including `/api/settings` which holds Google creds) is publicly read/writable.
2. **CRITICAL — Google credentials stored in cleartext.** `database.js:717-719` (`googleServiceAccountPrivateKey` etc.), `settingsModel.js:54-94`. CLAUDE.md §8 already flags this as deferred debt. No encryption util exists.
3. **HIGH — CORS wide open.** `index.js:23` — any origin/method/header.
4. **HIGH — Multer upload hardening.** `properties.js:514-565` + `middleware/multerLogoUpload.js:19-21` — extension taken from user input, weak path/extension whitelisting.
5. **HIGH — No range validation on money fields.** devis/reservations/resourceBookings accept negative/NaN/over-100% amounts; only the pricing engine indirectly guards.
6. **MEDIUM — No rate limiting**, no log sanitization for secrets.
7. ✅ **No SQL injection** — all queries use prepared statements (keep it that way).

---

## Bloc 0 — DB Hygiene ✅ DONE

Safe schema sweep before adding features. Shipped: `specs/db-hygiene-quick-wins.md`,
`utils/dbHygiene.js`. Deferred items from this bloc are carried into the blocs below
(devis/reservation table fusion → Bloc 4; phone/propertyIds JSON normalization → Bloc 1;
price denormalization → Bloc 2).

---

## Bloc 1 — Clients & Resources ✅ DONE

**Goal:** clean the people/resource domain; finish what Settings started (Settings was the first
retro-spec of this bloc and ratified the shared component library).

- ✅ `specs/settings.md` — Settings page MVC + component library (`PageActionBar`, `MaskedTextField`, …).
- ✅ **Clients spec** — refactor `routes/clients.js` (275) → `clientsController` + `clientsModel`.
  Normalize `clients.phoneNumbers` JSON → `client_phones` pivot table (carried from Bloc 0).
  Move delete-impact + orphan-cleanup logic into the model. Page `ClientsPage.js` (508) only renders.
- ✅ **Resources spec** — refactor `routes/resources.js` (322) + `routes/resourceBookings.js` (229)
  → controllers/models. Move availability + price-resolution + slot-conflict math server-side.
  Normalize `propertyIds` JSON if still denormalized (carried from Bloc 0).
  Pages `ResourcesPage.js`, `ResourcePlanningPage.js` keep only layout math.

---

## Bloc 2 — Pricing engine ✅ DONE

**Goal:** make the server the single source of truth for every price/deposit/balance. Kill the
duplicated pricing logic on the client.

> **Status (2026-05-27):** the live-app goals are met — server is the single pricing authority and the
> one live pricing UI (`ReservationPage`, used for **both** reservations and devis via `?mode=devis`)
> renders the server quote. Two big discoveries: `CalendarPage`'s reservation dialog and `DevisForm.js`
> are **dead code** (see [[calendar-reservation-dialog-dead]]), so the planned CalendarPage/DevisForm
> wiring + shared `PricingSummary`/`FinalPriceField` extraction are **deferred** (no live second
> consumer → YAGNI) to Bloc 3/4. See `specs/pricing-engine-thin-client.md` §7.bis.

- ✅ Centralize on existing `utils/pricing.js` (1306 LOC, already substantial). Expose a single
  authoritative "quote" endpoint that returns a fully-shaped, ready-to-render payload.
- ✅ **Remove `CalendarPage.recalcPrice` (742-807)** incl. deposit/balance auto-calc — client calls the
  quote endpoint instead.
- ✅ **Remove `ReservationPage` client-side quote application/recompute** (354-398, 912-938 capacity/bed
  math, 1810-1812 option multipliers) — server returns the computed quote + capacity allocation.
- ✅ De-duplicate `typeMultiplier` (Calendar) / `getMultiplier` (Planning 138-150) — use server values.
- ✅ **Manual price override (server-owned).** Reuse `customPrice`; quote returns `engineFinalPrice` +
  `priceOverridden`; editable final-price field + "Recalculer le prix" action in the finance section;
  engine-price reference/delta shown. Primary use case: iCal-imported reservations (real platform price).
- ✅ **iCal reservations stay identifiable** via existing `sourceType`/`icalSyncLocked` (no new column,
  no visual badge yet); override must survive re-sync.
- ✅ **Fix offered options/resources (known bug).** Server always recomputes the real line price;
  `offered` only zeroes the billed total (`originalTotalPrice` keeps the real one); lossless toggle even
  on locked reservations. Replaces the fragile `total===0` / `shouldBypassLockedTotal` recovery.
- ✅ **VAT/HT display** — already computed server-side; ensure summary only renders quote fields
  (CalendarPage inherits it via the refactor). Manual price shown struck-engine + green-manual.
- ✅ **Devis parity** — the pricing engine is shared (`devis.js` calls `calculateReservationQuote`).
  Targeted devis offered fix (remove `total=0→offered` SQL inference); DevisForm adopts the live quote +
  shared `FinalPriceField` + `PricingSummary`. Full devis MVC + table fusion stays Bloc 4.
- ✅ **Shared client artifacts** — `useReservationQuote` hook, `applyQuoteToForm` util, `FinalPriceField`
  + `PricingSummary` components, used by Reservation, Calendar and Devis (no per-page pricing markup).
- ⬜ Price denormalization (carried from Bloc 0): **own later spec** (decided), not in this bloc. → see "Deferred enhancements".
- ✅ Strict money validation utility (`validateMoneyAmount`, `validatePercentage`) — also feeds Bloc S.
- 📄 Spec: `specs/pricing-engine-thin-client.md`.

---

## Bloc 3 — Réservations & Calendar ✅ DONE (largest)

**Goal:** break the two biggest monoliths and the biggest pages.

- ✅ **`routes/reservations.js` (1317)** → `reservationsController` + `reservationsModel` +
  `occupancyValidator` (availability, night blocks, conflict detection). Endpoints: list/get/create/
  update/payment/delete/suggest-beds/calculate-price.
- ✅ **Move `utils/reservationConflicts.js` rules server-side** — return `conflictType` / `isAvailable`
  flags; client renders them.
- ✅ **`ReservationPage.js` (3433)** — split into focused components; migrate inline action bar →
  shared `<PageActionBar>` (this page is its visual reference); render-only.
- ✅ **`CalendarPage.js` (2342)** — full refactor (deferred from establishment-closures + school-holidays
  specs). Depends on Bloc 2 for pricing removal.
- ✅ Migrate `PageActionBar` usages flagged across other pages.

---

## Bloc 4 — Devis ✅ DONE (MVC + PDF + table fusion)

**Goal:** untangle the largest route file and converge devis with reservations.

- ✅ **`routes/devis.js` (1503)** → `devisController` + `devisModel` + `devisValidator`.
  Extract PDF generation into a service, history/audit-snapshot logic into the model.
- ✅ **Fusion of `devis_*` and `reservation_*` sibling tables** (carried from Bloc 0) — agreed strategy,
  needs a careful data migration (document in CHANGELOG `Migration`).
- ✅ `DevisForm.js` (501) / `DevisPage.js` (251) — render-only; date math stays as UI nav only.

---

## Bloc 5 — Finance & Dashboard ✅ DONE (per-extra payment tracking deferred)

**Goal:** no money math on the client, anywhere.

- ✅ **Server-compute `remainingDue`, `depositOverdue`, `balanceOverdue`, `overdueAmount`** and send as
  fields. Remove `FinancePage.getRemainingDue` (88-93) + overdue reduce (96-121) and
  `Dashboard.getRemainingDue` (35-39).
- ✅ `routes/finance.js` (403) — mostly read-only; move tax/aggregation queries into a `financeModel`,
  reuse `utils/pricing.js`. Tourist-tax breakdown lives server-side.
- ✅ `FinancePage.js` / `Dashboard.js` render precomputed payloads only.
- ⬜ **"À payer plus tard" / per-extra payment tracking** (split out of Bloc 2). New `paid` columns on
  `reservation_options` / `reservation_resources` / `reservation_custom_options`; "à payer sur place"
  subtotal = unpaid options + resources (optionally tourist tax); must exclude these from deposit/balance
  to avoid double-counting. Primary use case: options added after an iCal manual-price reservation.
  → **deferred**, see "Deferred enhancements".

---

## Bloc 6 — Google Calendar, iCal & Holidays ✅ DONE

**Goal:** finish the integration/sync corner and the last client-logic helpers.

- ✅ Full MVC refactor of `routes/googleCalendar.js` (201) — controller exists; move event builders to
  utils; finish `/status` + `/sync-reservations` extraction (deferred from Settings spec §TD-D4).
- ✅ `routes/ical.js` (70) → controller/model (token lifecycle). Protect against overbooking per the
  iCal anti-overbooking contract (see memory) — **never regress the 5-step sync algorithm**.
- ✅ Migrate `utils/frenchHolidays.js` (`getFrenchPublicHolidays`, `getSchoolHolidayInfo`) server-side
  (deferred from school-holidays spec). Pure render helpers may stay client-side.
- ✅ `routes/calendarNotes.js` (45) + `routes/options.js` (144) — light controller/model extraction.

---

## Bloc S — Security hardening ✅ DONE (cross-cutting, CRITICAL)

**Goal:** close the security holes the audit found. Some of these (auth) gate everything else and may
need to jump the queue depending on deployment exposure.

- ✅ **Authentication/authorization** — add auth middleware; protect all `/api` routes (esp. settings,
  finance, reservations, devis). Decide mechanism (session / JWT / API key) with the user.
- ✅ **AES-256-GCM encryption of Google credentials** — encrypt on write / decrypt on read in
  `settingsModel`; key in `server/.env.local` (auto-generated). Migrate existing cleartext rows.
- ✅ **Lock down CORS** to known origin(s).
- ✅ **Harden uploads** — extension whitelist + MIME check + `path.resolve` containment
  (`properties.js`, `middleware/multerLogoUpload.js`).
- ✅ **Money/percentage range validation** at every write boundary (shares util with Bloc 2).
- ✅ **Rate limiting** on sensitive endpoints; **log sanitization** for secrets.

---

## Deferred enhancements (optional, not refactor debt)

The consolidation is complete; these two items are **product enhancements** that were deliberately
deferred. Each needs its own spec written together before implementation (CLAUDE.md §3).

1. **Per-extra payment tracking — "À payer plus tard" / "à payer sur place"** (from Bloc 5).
   Add `paid` columns to `reservation_options` / `reservation_resources` / `reservation_custom_options`;
   the server computes an "à payer sur place" subtotal (unpaid options + resources, optionally tourist
   tax) and **excludes** it from the deposit/balance to avoid double-counting. Primary use case: options
   added after an iCal manual-price reservation.
2. **Price denormalization** (from Bloc 0 → Bloc 2). Decide and document the storage model for line
   prices so historical quotes/reservations keep the price as billed even if the pricing config later
   changes. Its own spec, as agreed.

> The structural roadmap (Blocs 0–6 + S) is closed. New work is now either one of the two enhancements
> above or a brand-new feature — picked together at the start of each cycle, spec first.
