# WordPress booking widget — unified redesign (calendar-driven dates, steppers, resources)

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/wp-booking-widget-redesign` |
| **Created** | 2026-07-20 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |

---

## 1. Context

The lodging pages of the showcase WordPress site currently stack **two overlapping booking widgets**:

1. The **`guestflow/booking` block** (repo plugin `integrations/wordpress/guestflow-booking`): live quote + Qonto online payment, but native `type=date` inputs, bare `type=number` fields for guests and option quantities, no resources, and an inconsistent option presentation (plain rows vs. framed cards with a yellow « À planifier avec l'hôte » note on every `showsPlanningCard` option).
2. The **`gf-booking.php` mu-plugin** (Pi volume only, un-versioned): a range-select availability calendar + booking popup with steppers and resources — but no online payment, and its own duplicate REST proxy.

User feedback: options presentation is not uniform, too small, not visible enough; quantity inputs are ugly and not user-friendly; resources (notably the **bain nordique**) are missing from the widget; the scheduling note should move from breakfast/trapper-meal options to the bain nordique; dates must be selectable **only** on the calendar (read-only date fields) and must never allow an unavailable range.

## 2. Goal

One single, professional booking widget on each lodging page: pick the dates on an availability calendar, configure the party and the options/supplements with elegant stepper controls, see the live quote, and pay online — with the bain nordique bookable and clearly marked as « à planifier avec l'hôte ».

## 3. Functional rules

### Dates
1. The widget embeds its own 2-month availability calendar (prev/next navigation). Arrival is picked first, then departure; selecting a new range restarts cleanly (same interaction as the current mu-plugin calendar).
2. Blocked dates and past dates are disabled. A departure pick that would span a blocked night is refused client-side (`rangeHasBlocked`), and the server quote remains authoritative: `available === false` or `minNightsBreached` keeps the submit button disabled. **No unavailable range can ever be submitted.**
3. The « Arrivée » and « Départ » fields are **read-only displays** (French long date), filled exclusively from the calendar. No manual typing.
4. Min-nights violations show the server's `minNights` message under the calendar and clear the departure selection.
5. Arrival/departure **time** selects (defaults from the property's `defaultCheckIn`/`defaultCheckOut`) are kept, as in the current popup.

### Guests
6. Adultes (min 1) / Ados (12–18) / Enfants (2–12) / Bébés (0–2) are configured with **stepper controls** (− value +), age range as a small subtitle. No free-text number inputs.

### Options & supplements — one uniform list
7. Options and resources render in **one visually uniform list**, every row with the same layout: **title left (with age/unit subtitle), price + unit label in italic to its right, stepper far right**. No mixed plain/framed rows.
8. Option unit labels (`priceUnitLabel`, `quantityLabel`) keep coming from the backend as-is (existing contract, `specs/public-planning-options.md`).
9. **The « À planifier avec l'hôte — nous vous contacterons pour convenir de l'horaire. » note is no longer shown on options** (petit déjeuner, repas des trappeurs…), even when `showsPlanningCard` is true. Their « Nombre de séances » quantity label stays.
10. **Resources are fetched and displayed** (public API `GET /properties/:id/resources`, live since PR #161). The **bain nordique** (priceType `per_hour`) shows the scheduling note under its row. The note flag is **computed server-side** (`showsSchedulingNote`), not hardcoded in the plugin.
    **Pricing rule (bug discovered & fixed at implementation)**: the engine only priced hourly-scheduled resources (`showsPlanningCard` + `per_hour`) from planned **sessions**, silently dropping a bare quantity — so the site could never bill the bain nordique. Under `planningCardAsQuantity` (public flow) with no sessions, the engine now bills the quantity as hours at the day rate (unscheduled, « à planifier avec l'hôte »), mirroring the existing planning-card **options** rule. Sessions keep precedence when present; the admin/fiche flow is unchanged.
11. Resource unit/quantity labels are computed server-side like options' (`per_hour` → « par heure » / « Nombre d'heures », `per_stay` → « pour le séjour », etc.).
12. The **« Lit bébé » resource is not listed** with the supplements: as in the current popup, a « Lit(s) bébé souhaité(s) ? (gratuit, selon disponibilité) » stepper appears only when Bébés ≥ 1 (max = number of babies) and is sent as the devis `babyBeds` field — not as a resource line.
13. Selected resources are included in `/quote` and `/booking-requests` payloads (`resources: [{resourceId, quantity}]`) and their totals rendered in the summary (`resources[]`, `resourcesTotal`), including the « Offert » case.
14. Options with a `description` keep the ⓘ toggle behavior.

### Design
15. Typography and controls sized for confident reading (~1rem titles, ≥44 px touch targets), consistent with the site's brand green; stepper buttons visibly tappable (the mu-plugin's `.gf-step` look is the starting point, polished).
16. Fully responsive: steppers and price stay on one row on mobile; calendar months stack; no horizontal scroll.

### Consolidation
17. The `guestflow/booking` block becomes the **only** widget: once deployed, the `.gf-book` mu-plugin div is removed from pages 68/69 (Pi content edit) so a single calendar + form remains. The standalone `guestflow/calendar` block and the mu-plugin file itself are untouched (inert without its target div).
18. The Qonto payment flow (full & deposit modes, return-page polling) is unchanged.

**Edge cases:**
- All nights blocked in the visible window → calendar still navigable, no selectable arrival.
- Quantity of a progressive-price option stays capped at the party size (existing rule).
- Babies decreased below requested baby beds → baby-beds quantity clamps down (existing popup rule).
- API unreachable → existing `unavailable` error state.

---

## 4. Architecture

> Fat backend, thin frontend: unit labels and the scheduling-note flag are computed in the server projection; the widget renders server strings verbatim. The calendar/steppers are pure UI state; availability and pricing decisions stay server-side (`/quote`).

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `utils/` | `publicProjections.js` | T | `toPublicResource`: add `priceUnitLabel`, `quantityLabel`, `showsSchedulingNote` (true for `per_hour` resources) |
| `utils/` | `pricing.js` | T | Hourly-scheduled resources: under `planningCardAsQuantity` with no sessions, bill the bare quantity as hours (rule 10) |
| `tests/` | `public-projections.unit.test.js` | T | Resource projection fields (labels + scheduling-note flag, 3 new cases) |
| `tests/` | `planning-card-public-pricing.unit.test.js` | T | Hourly-resource public pricing (4 new cases: quantity billed, qty 0, sessions precedence, admin unchanged) |
| routes/controllers | — | — | (none — `/resources`, `/quote`, `/booking-requests` already support resources) |

### 4.2 WordPress plugin (`integrations/wordpress/guestflow-booking/`)

| File | T/C | Responsibility |
|---|---|---|
| `includes/class-gf-rest-proxy.php` | T | New cached route `GET /properties/:id/resources` |
| `includes/class-gf-blocks.php` | T | New i18n strings (calendar hints, steppers, supplements, baby beds) |
| `blocks/booking/view.js` | T | Embedded availability calendar (range select, ported from the mu-plugin), read-only date displays, time selects, steppers, unified option+resource rows, resources in quote/booking payloads, `babyBeds` |
| `assets/style.css` | T | Redesigned widget styles (calendar, steppers, rows, summary) |
| `readme.txt` / `guestflow-booking.php` | T | Version bump |

### 4.3 WordPress content (Pi, after plugin deploy)

- Pages 68 & 69: remove the `<div class="gf-book" data-property="…">` block (single-widget consolidation).

### 4.4 Client (`client/src/`)

None — GuestFlow app untouched.

## 5. Data model

No schema change.

## 6. UI / UX

- Widget order: calendar → read-only date recap (+ time selects) → Voyageurs (steppers) → Options & suppléments (uniform rows, bain nordique with scheduling note) → summary (with Suppléments line) → contact → pay button.
- Mobile (≤600 px): months stack vertically; each row keeps title on the left and stepper on the right, subtitle wrapping under the title; totals bar full-width.
- Desktop reference: current mu-plugin popup + Valsoyo booking pages for the level of polish.

## 7. Test plan

- **Server unit tests** (suite: 2096 pass): resource projection labels + `showsSchedulingNote` (3 cases) and hourly-resource public pricing (4 cases — quantity billed at day rate, qty 0 dropped, sessions precedence, admin flow unchanged).
- **Manual (WP on the Pi, plugin copied via docker cp)**:
  1. Dates only selectable on the calendar; date fields not editable; blocked range refused; min-nights message.
  2. Bain nordique visible with note + hourly label; petit déjeuner & repas des trappeurs without note; quote updates with resources; « Offert » rendering.
  3. Baby-beds stepper appears only with Bébés ≥ 1, capped, sent as `babyBeds`.
  4. Qonto payment button states (full & deposit) unchanged.
  5. Mobile + tablet + desktop rendering.

## 8. Out of scope

- Any GuestFlow app UI change.
- Retiring the `gf-booking.php` mu-plugin file or its REST namespace (left inert).
- The standalone `guestflow/calendar` block and the availability search banner.
- OTA listings copy.

## 9. Open questions

1. ~~Bain nordique quantity unit~~ — **Resolved 2026-07-20**: `per_hour` → « Nombre d'heures », 30 € / heure (live data).
2. ~~Single-widget consolidation~~ — **Resolved 2026-07-20**: validated; the inline block becomes the only widget, the popup flow is removed from the pages.
