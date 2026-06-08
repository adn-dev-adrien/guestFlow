# Public API for the WordPress showcase site

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/public-api` _(user-managed)_ |
| **Created** | 2026-06-08 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |

---

## 1. Context

A public WordPress showcase site is being built. A visitor must be able to:

1. browse a per-property availability calendar,
2. pick dates and get a **quote** (with options),
3. send a **booking request** (NOT a firm reservation).

WordPress will **not** call GuestFlow from the visitor's browser. A trusted
**server-to-server proxy** (WordPress backend → GuestFlow) makes the calls. The
caller is a confidential backend, not the public, so it can hold a secret API key.

Today the entire GuestFlow API lives under `/api/*` and is **fail-closed behind a
session guard** ([index.js:117-130](server/src/index.js#L117-L130)): every route except
`/api/auth/*`, `/api/version`, and the public iCal export requires a logged-in admin
session cookie. The SPA is the only consumer. There is **no API versioning** and **no
machine-to-machine credential**.

We therefore need a **separate PUBLIC API surface**, distinct from the INTERNAL admin
API, with its own authentication (a dedicated API key), its own rate limiting, its own
uniform error format, and a read-only posture except for the booking-request endpoint.

The pricing engine ([utils/pricing.js](server/src/utils/pricing.js),
`calculateReservationQuote`) is the source of truth for money and **must be reused, never
reimplemented**. Availability already consolidates platform blocks because iCal imports
land in the `reservations` table as rows with `sourceType='ical'`; the existing
occupied-dates computation already folds them in together with establishment closures.

## 2. Goal

Expose a small, versioned, key-authenticated **public API** (`/public/v1/*`) that lets the
trusted WordPress proxy list properties, read consolidated availability and proposable
options per property, compute a quote through the existing pricing engine, and submit a
booking request that lands as a **pending** record in the admin app — without ever exposing
the internal admin API, guest PII of other bookings, or any write capability beyond the
single booking-request endpoint.

## 3. Functional rules

### Inventory & classification of existing endpoints

Before specifying, here is the inventory of the existing INTERNAL endpoints/engines relevant
to the public surface, each classified as **[REUSE]** (call as-is internally),
**[PUBLIC VARIANT]** (expose a new read-only public projection backed by the same data/logic),
or **[CREATE]** (genuinely new logic).

| # | Existing internal asset | File | Classification | Public counterpart |
|---|---|---|---|---|
| 1 | `calculateReservationQuote(db, …)` pricing engine | [pricing.js:829](server/src/utils/pricing.js#L829) | **[REUSE] as-is** | Backs `POST /public/v1/quote`. Never reimplemented. |
| 2 | `POST /api/reservations/calculate-price` | [reservationsController.js:195](server/src/controllers/reservationsController.js#L195) | **[PUBLIC VARIANT] read-only** | `POST /public/v1/quote` — same engine, public input projection in, public quote projection out. |
| 3 | `GET /api/properties` (list) | [propertiesController.js:17](server/src/controllers/propertiesController.js#L17) | **[PUBLIC VARIANT] read-only** | `GET /public/v1/properties` — public field projection only. |
| 4 | `GET /api/properties/:id` (detail + pricingRules/icalSources/documents) | [propertiesController.js:21](server/src/controllers/propertiesController.js#L21) | **[PUBLIC VARIANT] read-only** | `GET /public/v1/properties/:id` — public projection; **strips** iCal URLs/tokens, internal tax config, sync state. |
| 5 | `GET /api/options` + per-property applicability (`propertyIds`) | [optionsController.js:5](server/src/controllers/optionsController.js#L5) | **[PUBLIC VARIANT] read-only** | `GET /public/v1/properties/:id/options` — only options applicable to that property, public projection. |
| 6 | `GET /api/reservations/occupied-dates/:propertyId` (reservations incl. `sourceType='ical'` platform blocks + closures) | [reservationsController.js:169](server/src/controllers/reservationsController.js#L169), [occupancy.js](server/src/utils/occupancy.js) | **[PUBLIC VARIANT] read-only** | `GET /public/v1/properties/:id/availability` — consolidated blocked dates, **no source attribution / no PII**. |
| 7 | `GET /api/establishment-closures` | [establishmentClosuresController.js](server/src/controllers/establishmentClosuresController.js) | **[REUSE] internally** | Not exposed directly; folded into availability (#6). |
| 8 | iCal sync (imports become `reservations` rows) | [routes/ical.js](server/src/routes/ical.js), [icalParser.js](server/src/utils/icalParser.js) | **[REUSE] internally** | Not exposed; platform blocks already visible via availability (#6). |
| 9 | `POST /api/devis` (devis create, lifecycle draft→sent→accepted→converted) | [devisController.js:51](server/src/controllers/devisController.js#L51) | **[REUSE] internally** | Backs `POST /public/v1/booking-requests`: a booking request is persisted as a **draft devis** flagged `requestOrigin='public'`. |
| 10 | `POST /api/reservations` (firm reservation create) | [reservationsController.js:257](server/src/controllers/reservationsController.js#L257) | **NOT exposed** | A public booking request must never create a confirmed reservation. Admin converts later via existing devis→reservation flow. |
| 11 | Client create/lookup | [clientsController.js](server/src/controllers/clientsController.js) | **[REUSE] internally** | Booking request resolves/creates a client from the guest's contact details. |
| 12 | Session auth guard + role guard | [index.js:117-130](server/src/index.js#L117-L130) | **[REUSE] untouched** | Public API mounts on a separate tree, never behind this guard. |
| 13 | `apiLimiter` / `loginLimiter` | [rateLimiters.js](server/src/middleware/rateLimiters.js) | **[PUBLIC VARIANT]** | New `publicApiLimiter` + `bookingRequestLimiter` added to the same module. |

### Core functional rules

1. **Separate surface.** All public endpoints live under `/public/v1/*`. This tree is mounted
   **before** and **outside** the `/api` session guard. The internal `/api/*` API is **not
   modified** — the SPA keeps working unchanged.
2. **Key auth on every public endpoint**, including reads. The proxy sends
   `Authorization: Bearer <PUBLIC_API_KEY>` (or `X-API-Key: <PUBLIC_API_KEY>`). A missing/invalid
   key → `401 UNAUTHENTICATED`. The key is a single shared secret for the WordPress proxy,
   **distinct** from any admin user credential, stored in `server/.env.local`
   (`PUBLIC_API_KEY=…`). No key, no access — fail closed.
3. **Read-only except booking requests.** Only `POST /public/v1/booking-requests` writes. All
   other public endpoints are `GET` (plus `POST /public/v1/quote`, which **computes** but does
   **not persist**).
4. **No sensitive data in URLs.** The API key travels in a header, never in the query string or
   path. Guest PII (name/email/phone/message) travels only in a `POST` body, never in a URL.
5. **Public projections only.** Public responses expose a deliberately reduced field set. They
   **never** include: iCal source URLs/tokens, sync status, accounting buckets
   (`acompteContribTtc`/`soldeContribTtc`), payment state, internal notes, client PII of other
   bookings, platform names attached to availability blocks, or VAT-internal net breakdowns
   unless explicitly listed.
6. **Quote = engine.** `POST /public/v1/quote` calls `calculateReservationQuote(db, …)` with a
   sanitized parameter set and returns a **public projection** of its output. It never trusts a
   client-sent price: `customPrice`, `discountPercent`, payment flags, locked snapshots, and
   accounting params from the body are **ignored/forbidden** on the public path.
7. **Booking request is pending, never confirmed.** A successful `POST
   /public/v1/booking-requests` creates a **draft devis** (`kind='devis'`, `devisStatus='draft'` —
   the natural "awaiting admin review" state of the existing devis lifecycle; the new
   `requestOrigin='public'` marker is set by a post-create UPDATE) with server-computed pricing,
   attached to a resolved-or-created client, plus the guest's free-text message. The
   visitor-facing receipt reports `status: "pending"`. It does **not** block the calendar (see
   Rule 11) and is **not** a reservation.
8. **Strict input validation at the public boundary.** Every field is validated for type, range,
   and format before any engine/DB call. `propertyId` must exist; `startDate < endDate`; dates
   are ISO `YYYY-MM-DD`; guest counts are non-negative integers within the property capacity;
   option ids must be applicable to the property; email is RFC-valid; phone is non-empty. On
   failure → `422 VALIDATION_FAILED` with a `details` array.
9. **Rate limiting + anti-spam on writes.** `/public/v1/*` reads use a dedicated
   `publicApiLimiter` (default 600/15 min/IP). `POST /public/v1/booking-requests` adds a stricter
   `bookingRequestLimiter` (default 5/hour/IP **and** 20/hour/API-key) plus a honeypot field
   (`_hp` must be empty). No CAPTCHA: the WordPress proxy owns bot filtering; GuestFlow relies on
   honeypot + rate limit only. Over limit → `429 TOO_MANY_REQUESTS`.
10. **Uniform error envelope.** Every public error is `{ "error": { "code", "message", "details"? } }`
    (see §4.3). `message` is generic/non-fingerprinting; `code` is a stable machine string.
11. **No temporary hold (this version).** A booking request does **not** block the calendar; dates
    stay available until the admin accepts/converts the pending devis. The hold design is kept in §8
    as a reference for a possible later addition (decision Q9).

**Edge cases:**

- Property id unknown → `404 PROPERTY_NOT_FOUND` (same generic shape for list/detail/options/availability/quote/request).
- Availability range too large (`to - from > 365 days`) or inverted → `422 VALIDATION_FAILED`.
- Availability range omitted → default window = today … today + 12 months.
- Quote with dates fully/partially overlapping blocked dates → quote still computes (price is date-driven), but response includes `"available": false` so the proxy can refuse the request UI-side. The booking-request endpoint **re-checks** availability server-side and rejects with `409 DATES_UNAVAILABLE` if blocked at submit time.
- Quote breaching minimum nights → engine returns `minNightsBreached: true`; public quote surfaces `available`/`minNights` info and the booking-request endpoint rejects with `409 MIN_NIGHTS` unless within rules.
- Booking request for a guest whose email already exists → reuse the existing client row (match on normalized email); never duplicate, never overwrite their stored name/phone silently (append request as a new pending devis).
- Honeypot filled (`_hp` non-empty) → respond `201` shaped like a success receipt **without** persisting anything (don't help spammers distinguish a block from a pass).
- Option id sent that is not applicable to the property → `422 VALIDATION_FAILED` (`details` names the offending option), never silently dropped.
- Unknown/extra body fields → ignored (forward-compatible), except forbidden pricing-override fields which, if present, are ignored (not an error) and logged.

---

## 4. Architecture

> **Fat backend, thin frontend.** WordPress is the "frontend" here and gets **ready-to-render
> payloads**: prices, availability, option catalogs, and quote breakdowns are all computed
> server-side. WordPress renders; it never computes a price, derives availability, or re-shapes a
> quote. There is **no GuestFlow React client change** in this spec.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `routes/` | `routes/public/index.js` | C | Mounts the `/public/v1` sub-router; applies public API-key auth + `publicApiLimiter` to the whole tree. |
| `routes/` | `routes/public/properties.js` | C | `GET /properties`, `GET /properties/:id`, `GET /properties/:id/options`, `GET /properties/:id/availability`. Thin: validate → controller → project. |
| `routes/` | `routes/public/quote.js` | C | `POST /quote`. Thin: validate → controller. |
| `routes/` | `routes/public/bookingRequests.js` | C | `POST /booking-requests`. Thin: honeypot + `bookingRequestLimiter` → controller. |
| `controllers/` | `controllers/public/publicCatalogController.js` | C | Orchestrates property list/detail/options/availability via existing models; applies public projections. |
| `controllers/` | `controllers/public/publicQuoteController.js` | C | Sanitizes input, calls `calculateReservationQuote`, returns public quote projection. **Reuses the engine, no price logic here.** |
| `controllers/` | `controllers/public/publicBookingRequestController.js` | C | Validates + honeypot, resolves/creates client by email, re-checks availability, creates a pending devis via the devis model. |
| `models/` | `models/propertiesModel.js`, `models/optionsModel.js`, `models/reservationsModel.js` (occupied-dates), `models/devisModel.js`, `models/clientsModel.js`, `models/establishmentClosuresModel.js` | T/REUSE | Called as-is by the public controllers. `devisModel`/`reservationsModel` gain awareness of the new `requestOrigin` column. |
| `middleware/` | `middleware/requirePublicApiKey.js` | C | Constant-time compare of `Authorization: Bearer`/`X-API-Key` against `PUBLIC_API_KEY`; 401 on miss. |
| `middleware/` | `middleware/rateLimiters.js` | T | Add `publicApiLimiter` + `bookingRequestLimiter`. |
| `utils/` | `utils/publicProjections.js` | C | Pure functions: `toPublicProperty`, `toPublicPropertyDetail`, `toPublicOption`, `toPublicAvailability`, `toPublicQuote`. Unit-testable. |
| `utils/` | `utils/publicInputValidation.js` | C | Pure validators for public query/body params (dates, counts, ids, email, phone). Unit-testable. |
| `utils/` | `pricing.js` | REUSE | **Untouched.** Called by `publicQuoteController` and indirectly by the devis create path. |
| `scheduledTasks.js` | `scheduledTasks.js` | T (only if hold enabled) | Releases expired holds (see §8). |
| `database.js` | `database.js` | T | Idempotent migration: add `reservations.requestOrigin TEXT` (NULL); if hold enabled, add hold columns/table. |
| `index.js` | `index.js` | T | Mount `app.use('/public/v1', require('./routes/public'))` **before** the `/api` guard block; add `trust proxy` already present. |

**Notes:**
- The public tree is mounted on a **separate path** (`/public/v1`), so the existing `/api`
  session guard ([index.js:117-130](server/src/index.js#L117-L130)) is **not touched** and cannot
  accidentally expose or block public routes. This is the safety crux of the no-break guarantee.
- Public controllers **only read through existing models** and **only write through the existing
  devis create path**, so business rules (capacity, min-nights, pricing, tax) stay in one place.
- New dependency: none.

### 4.2 Client side (`client/src/`)

**No GuestFlow React client changes in this spec.** The consumer is the external WordPress site,
out of this repo. The admin SPA is unaffected.

The only admin-side follow-up (separate spec, out of scope here) is surfacing
`requestOrigin='public'` pending devis in the existing Devis list so the admin can review/accept
them. The data already flows through the existing Devis UI; a visual badge is a later nicety.

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| (all) | — | — | None. |

**Component reuse declaration:** N/A (no React change).

### 4.3 API contract

**Base path:** `/public/v1`  ·  **Auth (all routes):** `Authorization: Bearer <PUBLIC_API_KEY>`
(or `X-API-Key`).  ·  **Content type:** `application/json`.

**Uniform error envelope** (all non-2xx):
```json
{ "error": { "code": "VALIDATION_FAILED", "message": "One or more fields are invalid.",
             "details": [ { "field": "endDate", "issue": "must be after startDate" } ] } }
```
`details` is present only when useful (validation). `message` is generic and safe to display.

| Method | Endpoint | Scope | Auth | Body | Response | Notes |
|---|---|---|---|---|---|---|
| GET | `/public/v1/properties` | public | key | — | `{ data: [PublicProperty] }` | List of bookable properties. |
| GET | `/public/v1/properties/:id` | public | key | — | `{ data: PublicPropertyDetail }` | 404 if unknown. |
| GET | `/public/v1/properties/:id/options` | public | key | — | `{ data: [PublicOption] }` | Only options applicable to the property. |
| GET | `/public/v1/properties/:id/availability?from=&to=` | public | key | — | `{ data: PublicAvailability }` | Consolidated blocked dates; defaults today…+12mo; max 365d. |
| POST | `/public/v1/quote` | public | key | `QuoteRequest` | `{ data: PublicQuote }` | Computes via engine; no persistence. |
| POST | `/public/v1/booking-requests` | public | key | `BookingRequest` | `201 { data: BookingRequestReceipt }` | Pending devis; rate-limited + anti-spam. |

HTTP codes used: `200`, `201`, `401 UNAUTHENTICATED`, `404 PROPERTY_NOT_FOUND`,
`409 DATES_UNAVAILABLE` / `409 MIN_NIGHTS` / `409 OVER_CAPACITY`, `422 VALIDATION_FAILED`,
`429 TOO_MANY_REQUESTS`, `500 INTERNAL_ERROR` (generic message).

---

#### Endpoint detail

##### GET `/public/v1/properties`

- **Params:** none.
- **Response 200:**
```json
{
  "data": [
    {
      "id": 1,
      "name": "Le Nid",
      "nameArticle": "le",
      "maxAdults": 4, "maxChildren": 2, "maxBabies": 1,
      "singleBeds": 1, "doubleBeds": 2,
      "basePriceIncludedGuests": 2,
      "defaultCheckIn": "15:00", "defaultCheckOut": "10:00"
    }
  ]
}
```
  - **No image/document URLs** are exposed: the WordPress site hosts its own visuals (Q7). The API
    returns only descriptive/structural fields.
- **Errors:** `401`.

##### GET `/public/v1/properties/:id`

- **Params:** path `id` (integer).
- **Response 200:** `PublicPropertyDetail` = `PublicProperty` + a **display-only** price hint:
```json
{
  "data": {
    "id": 1, "name": "Le Nid", "nameArticle": "le",
    "maxAdults": 4, "maxChildren": 2, "maxBabies": 1,
    "singleBeds": 1, "doubleBeds": 2,
    "basePriceIncludedGuests": 2, "extraGuestPrice": 25,
    "defaultCheckIn": "15:00", "defaultCheckOut": "10:00",
    "fromPricePerNight": 120
  }
}
```
  - `fromPricePerNight` is the lowest active pricing-rule nightly base (a "from €X / night" teaser),
    computed server-side (Q6). **Excluded:** image/document URLs (Q7 — hosted on WordPress), raw
    `pricingRules`, `icalSources`, tax config, deposit percentages, sync state.
- **Errors:** `404 PROPERTY_NOT_FOUND`, `401`.

##### GET `/public/v1/properties/:id/options`

- **Params:** path `id`.
- **Response 200:**
```json
{
  "data": [
    {
      "id": 7, "title": "Petit-déjeuner", "titleEn": "Breakfast",
      "description": "Servi de 8h à 10h.",
      "priceType": "per_person_per_night", "price": 12,
      "progressiveTiers": null
    },
    {
      "id": 9, "title": "Arrivée anticipée", "titleEn": "Early check-in",
      "description": "Selon disponibilité.",
      "priceType": "per_hour", "price": 15,
      "autoOptionType": "early_check_in"
    }
  ]
}
```
  - **Excluded:** linen/towel inventory fields, `countsAsBedLinen`, internal auto-pricing config.
- **Errors:** `404 PROPERTY_NOT_FOUND`, `401`.

##### GET `/public/v1/properties/:id/availability`

- **Params:** path `id`; query `from` (ISO date, optional), `to` (ISO date, optional).
- **Response 200:**
```json
{
  "data": {
    "propertyId": 1,
    "from": "2026-06-08",
    "to": "2027-06-08",
    "blockedDates": ["2026-07-10", "2026-07-11", "2026-07-12"],
    "blockedRanges": [ { "start": "2026-07-10", "end": "2026-07-12" } ]
  }
}
```
  - `blockedDates` = consolidated occupied nights from reservations (incl. `sourceType='ical'`
    platform blocks) **and** establishment closures — **no source, no platform name, no guest
    info**. `blockedRanges` is the same data collapsed into ranges for convenient rendering.
- **Errors:** `404 PROPERTY_NOT_FOUND`, `422 VALIDATION_FAILED` (bad/oversized range), `401`.

##### POST `/public/v1/quote`

- **Body (`QuoteRequest`):**
```json
{
  "propertyId": 1,
  "startDate": "2026-07-20", "endDate": "2026-07-27",
  "checkInTime": "15:00", "checkOutTime": "10:00",
  "adults": 2, "children": 1, "teens": 0, "babies": 0,
  "options": [ { "optionId": 7, "quantity": 2 } ]
}
```
  - **Allowed fields only.** Forbidden/ignored on the public path: `customPrice`,
    `discountPercent`, `depositPaid`/`balancePaid`/`complementPaid`, `*Amount` overrides,
    `locked*` snapshots, `clientGrossAmount`, `offeredOptionIds`, `forceMinNights`,
    `forceCapacity`. `platform` is **not** a public input — it is hard-set to `"direct"`
    server-side (Q8); any `platform` sent in the body is ignored.
- **Response 200 (`PublicQuote`** — projection of the engine output):**
```json
{
  "data": {
    "propertyId": 1,
    "startDate": "2026-07-20", "endDate": "2026-07-27", "nights": 7,
    "persons": 3,
    "available": true,
    "minNights": 3, "minNightsBreached": false,
    "currency": "EUR",
    "nightlyBreakdown": [ { "date": "2026-07-20", "price": 120 } ],
    "accommodationTotal": 840,
    "extraGuestSurcharge": 25,
    "options": [
      { "optionId": 7, "title": "Petit-déjeuner", "quantity": 2, "unitPrice": 12, "total": 168 }
    ],
    "optionsTotal": 168,
    "touristTax": { "total": 33, "label": "Taxe de séjour : 1,10 € × 3 pers. × 7 nuits",
                    "collectedOnArrival": false },
    "subtotal": 1033,
    "finalPrice": 1033,
    "deposit": { "amount": 309.90, "dueDate": "2026-06-20" },
    "balance": { "amount": 723.10, "dueDate": "2026-07-13" },
    "complementOnArrival": 0
  }
}
```
  - Mapped from `calculateReservationQuote` fields (`nights`, `nightlyBreakdown`,
    `totalPrice`/`baseAccommodationPrice`, `extraGuestSurcharge`, `optionLines`, `optionsTotal`,
    `touristTaxTotal`/`touristTaxLabel`/`touristTaxCollectedOnArrival`, `finalPrice`,
    `depositAmount`/`depositDueDate`, `balanceAmount`/`balanceDueDate`, `complementAmount`,
    `minNightsBreached`/`requiredMinNights`). `available` is added by cross-checking the
    requested range against availability (#6).
  - **Excluded:** VAT net breakdowns, accounting contribution buckets, `engineFinalPrice`/override
    flags, resource lines unless a public resource concept is in scope (it is not — see §8).
- **Errors:** `404 PROPERTY_NOT_FOUND`, `422 VALIDATION_FAILED`, `401`, `429`.

##### POST `/public/v1/booking-requests`

- **Body (`BookingRequest`):** the same quote params **plus** guest contact + message:
```json
{
  "propertyId": 1,
  "startDate": "2026-07-20", "endDate": "2026-07-27",
  "checkInTime": "15:00", "checkOutTime": "10:00",
  "adults": 2, "children": 1, "teens": 0, "babies": 0,
  "options": [ { "optionId": 7, "quantity": 2 } ],
  "guest": {
    "firstName": "Marie", "lastName": "Durand",
    "email": "marie.durand@example.com", "phone": "+33 6 12 34 56 78"
  },
  "message": "Bonjour, possible une arrivée vers 16h ?",
  "_hp": ""
}
```
- **Behavior:** validate → honeypot → re-check availability + capacity + min-nights →
  resolve-or-create client by normalized email → compute pricing via the engine → create a
  **draft devis** (`kind='devis'`, `devisStatus='draft'`, then a post-create UPDATE sets
  `requestOrigin='public'`; `notes` = guest message). The platform is forced to `"direct"`.
- **Response 201 (`BookingRequestReceipt`):**
```json
{
  "data": {
    "requestId": 142,
    "status": "pending",
    "reference": "2026-06-00042",
    "propertyId": 1,
    "startDate": "2026-07-20", "endDate": "2026-07-27",
    "finalPrice": 1033, "currency": "EUR"
  }
}
```
  - `reference` is the existing `devisNumber` (YYYY-MM-NNNNN). `requestId` is the devis row id.
    No `hold` field in this version (Q9).
  - **Excluded:** the full pricing breakdown and any client/admin internals. The proxy gets a
    confirmation receipt, not a quote dump (it can re-quote if it needs the breakdown).
- **Errors:** `409 DATES_UNAVAILABLE` / `409 MIN_NIGHTS` / `409 OVER_CAPACITY`,
  `422 VALIDATION_FAILED`, `404 PROPERTY_NOT_FOUND`, `429 TOO_MANY_REQUESTS`, `401`.

---

## 5. Data model

**New column (required):**
- `reservations.requestOrigin TEXT` — `NULL` for everything created today; `'public'` for rows
  created by `POST /public/v1/booking-requests`. Lets the admin filter/badge public-origin pending
  devis. Idempotent migration in [database.js](server/src/database.js):
  `ALTER TABLE reservations ADD COLUMN requestOrigin TEXT` (guarded by the existing
  "column exists?" helper). Default for existing rows: `NULL`. **No data loss/corruption risk** —
  additive nullable column.

**Optional columns/table (only if the hold option is implemented):**
- Either `reservations.holdExpiresAt TEXT` on the pending devis, **or** a dedicated
  `availability_holds` table (`id, propertyId, startDate, endDate, devisId, expiresAt, createdAt`).
  A dedicated table is cleaner (holds are transient and not all requests create one). Released by a
  scheduled task (§8). Default = feature off → no column/table created.

**No other schema change.** Properties, options, pricing rules, clients, devis lifecycle, and iCal
import storage are all reused as-is.

**Data impact:** additive only. Existing records keep `requestOrigin = NULL` and behave exactly as
before. Document under `CHANGELOG.md` → `### Migration`.

## 6. UI / UX

**No GuestFlow UI in this spec** (the consumer is the external WordPress site). The public API
returns ready-to-render JSON; WordPress owns all rendering and is responsible for its own
responsive behavior.

Admin-side, public-origin booking requests appear in the **existing** Devis list as pending devis
(no new screen here). A `requestOrigin` badge in the Devis UI is a **separate, out-of-scope**
follow-up.

`PageActionBar` / responsive rules: **N/A** (no GuestFlow page added or changed).

## 7. Test plan

### Server unit tests
- [x] `tests/public-input-validation.unit.test.js` — date order/format, oversized availability range,
      email/phone, unknown option id, forbidden pricing-override fields dropped. **(11 tests)**
- [x] `tests/public-projections.unit.test.js` — `toPublicProperty`/`Detail`/`Option`/`Availability`/
      `Quote` strip every excluded field (no photo/doc URLs, no accounting buckets, no VAT internals)
      and map engine fields correctly; range collapsing. **(7 tests)**
- [x] `tests/require-public-api-key.unit.test.js` — missing/wrong key → 401; correct key via
      `X-API-Key` and `Bearer` → pass; fail-closed when unconfigured. **(5 tests)**
- The quote + booking-request **controllers** bind to the production `database` module (same pattern
      as the existing `reservationsController`/`devisController`, which are not unit-tested either), so
      their full flow is covered by the manual/integration checks below rather than an isolated DB
      harness. The reusable pricing/validation/projection logic they call is unit-tested above.

### Manual / integration verification (all ✅ 2026-06-08, curl against `localhost:4000`)
- [x] Happy path (server-to-server `curl`): list → detail → options → availability → quote →
      booking request, all with the API key header. The draft devis (`requestOrigin='public'`,
      `devisStatus='draft'`) + its client were created in the DB; honeypot request persisted nothing.
- [x] Auth: every endpoint returns 401 without the key and with a wrong key.
- [x] Read-only: the only public write is the booking request (a draft devis); no public path
      creates/updates a reservation or edits an existing devis.
- [ ] Rate limiting: exceed `bookingRequestLimiter` → 429; reads stay under `publicApiLimiter`.
      *(limiters wired + unit-covered config; not exercised live to avoid tripping the dev limiter.)*
- [x] Regression: internal `/api/*` still returns 401 UNAUTHENTICATED (the `/api` guard is untouched);
      full server test suite green except pre-existing flaky tests (unrelated, vary per run).
- [x] Projection leak check: public responses carry only whitelisted fields (no photo/doc URLs, no
      accounting buckets, no VAT internals, no platform attribution on availability).

## 8. Out of scope

- Any GuestFlow React/SPA UI change (badge for public requests deferred to a follow-up spec).
- The WordPress plugin that consumes this API (PHP proxy, Gutenberg blocks, settings page, caching) —
  specified separately in [wordpress-plugin.md](wordpress-plugin.md). This spec stops at the HTTP
  contract.
- Versioning the **internal** `/api/*` API: it stays unversioned. Public API is born at
  `/public/v1`; a future `/public/v2` is additive and won't touch v1 or the SPA.
- Online payment / firm reservation via the public API (a request is always pending; the admin
  converts it through the existing devis→reservation flow).
- Exposing resources/extras catalog publicly (only `options` are in scope; resources stay internal
  unless a later spec adds them).
- Webhooks/notifications back to WordPress on request status change (could be a later spec).
- **Encryption of the public API key at rest** beyond `.env.local` handling (the key is an env
  secret, not DB data).

**Hold option (described, default OFF):** a booking request may place a temporary hold so the proxy
can show "dates held while we confirm".
- *Design:* on create, insert an `availability_holds` row (or set `holdExpiresAt`) for the requested
  range with `expiresAt = now + HOLD_TTL` (e.g. 30 min). Availability (#6) then treats active,
  non-expired holds as blocked. A `scheduledTasks.js` job (every ~5 min) deletes expired holds.
- *Implications:* (a) holds can be abused to soft-deny a calendar → must be rate-limited and
  capped per property/IP; (b) two near-simultaneous requests for the same dates race → the second
  must re-check and get `409 DATES_UNAVAILABLE`; (c) cleanup must be reliable or stale holds
  block real bookings; (d) the admin must see/clear holds. Given this complexity, **default OFF**;
  ship the request flow first, add holds only if double-requests prove to be a real problem.

## 9. Open questions

### Resolved (2026-06-08)

- **Q1 — Availability attribution → OPAQUE.** `availability` exposes only blocked dates/ranges, no
  reason, no platform, no guest. Privacy-first.
- **Q2 — Booking-request persistence → PENDING DEVIS.** Requests are stored in the `reservations`
  table as `kind='devis'`, `devisStatus='draft'`, `requestOrigin='public'`, reusing the full
  devis lifecycle. No separate `booking_requests` table.
- **Q3 — Client creation → YES, MATCH BY EMAIL.** Create a `clients` row when the normalized email
  is unknown; otherwise reuse the existing client without overwriting their stored name/phone. **No**
  explicit consent flag is required/stored in this version.
- **Q4 — Anti-spam → HONEYPOT + RATE LIMIT ONLY.** No CAPTCHA; the WordPress proxy owns bot
  filtering. GuestFlow enforces the `_hp` honeypot + `bookingRequestLimiter`.
- **Q5 — Key management → SINGLE STATIC KEY.** One `PUBLIC_API_KEY` in `server/.env.local`. Rotation
  = change the value + restart (brief coordinated update with the proxy). Multi-key revocation is
  deferred (additive later).
- **Q6 — `fromPricePerNight` teaser → YES.** Expose the lowest active nightly base on the property
  detail.
- **Q7 — Photos/documents → NONE FOR NOW.** The public API exposes **no** image/document URLs;
  WordPress hosts its own visuals. Zero `/uploads` leak risk. (Can be added later once the upload
  folder is confirmed free of private files.)
- **Q9 — Temporary hold → OMITTED.** No hold columns/table/scheduled job in this version. The §8
  design stands as the reference if double-requests later prove to be a real problem.
- **Q8 — Platforms → ALWAYS `direct`.** Anything coming from WordPress is `platform='direct'`. The
  public input does **not** accept a platform parameter; the value is hard-set server-side. No OTA
  whitelist needed.

### Still open

(none)
