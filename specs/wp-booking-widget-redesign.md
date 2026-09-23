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
1. The widget embeds its own 2-month availability calendar (prev/next navigation). Arrival is picked first, then departure. *Amended 2026-09-23 (rule 24): a complete range is no longer thrown away by the next click — the arrival anchors the selection until it is clicked again or the dates are cleared.*
2. Past dates and taken nights are disabled. A departure pick that would span a blocked night is refused client-side (`rangeHasBlocked`) — *amended 2026-09-23 (rule 25): refused, not hidden; the date stays clickable and lands a new arrival* — and the server quote remains authoritative: `available === false` or `minNightsBreached` keeps the submit button disabled. **No unavailable range can ever be submitted.**
3. The « Arrivée » and « Départ » fields are **read-only displays**, filled exclusively from the calendar. No manual typing. The date is written **in figures** (`28/09/2026`) — amended 2026-09-23: the two fields sit side by side in a 560 px drawer, where « 28 septembre 2026 » was clipped mid-word.
4. Min-nights violations show the server's `minNights` message under the calendar. **That message must survive the calendar re-render** (rule 19). *Amended 2026-09-23 (rule 26): the refused period stays on screen instead of being cleared.*
5. Arrival/departure **time** selects (defaults from the property's `defaultCheckIn`/`defaultCheckOut`) are kept, as in the current popup.

### Guests
6. Adultes (min 1) / Ados (12–18) / Enfants (2–12) / Bébés (0–2) are configured with **stepper controls** (− value +), age range as a small subtitle. No free-text number inputs.

### Options & supplements — one uniform list
7. Options and resources render in **one visually uniform list**, every row with the same layout: **title left (with age/unit subtitle), price + unit label in italic to its right, stepper far right**. No mixed plain/framed rows.
8. Option unit labels (`priceUnitLabel`, `quantityLabel`) keep coming from the backend as-is (existing contract, `specs/public-planning-options.md`).
9. **The « À planifier avec l'hôte. » note is no longer shown on options** (petit déjeuner, repas des trappeurs…), even when `showsPlanningCard` is true. Their « Nombre de séances » quantity label stays. *(Amended 2026-09-23: the note was shortened from « À planifier avec l'hôte — nous vous contacterons pour convenir de l'horaire. » — two lines of reassurance where the row needed a label.)*
10. **Resources are fetched and displayed** (public API `GET /properties/:id/resources`, live since PR #161). The **bain nordique** (priceType `per_hour`) shows the scheduling note under its row. The note flag is **computed server-side** (`showsSchedulingNote`), not hardcoded in the plugin.
    **Pricing rule (bug discovered & fixed at implementation)**: the engine only priced hourly-scheduled resources (`showsPlanningCard` + `per_hour`) from planned **sessions**, silently dropping a bare quantity — so the site could never bill the bain nordique. Under `planningCardAsQuantity` (public flow) with no sessions, the engine now bills the quantity as hours at the day rate (unscheduled, « à planifier avec l'hôte »), mirroring the existing planning-card **options** rule. Sessions keep precedence when present; the admin/fiche flow is unchanged.
11. Resource unit/quantity labels are computed server-side like options' (`per_hour` → « par heure » / « Nombre d'heures », `per_stay` → « pour le séjour », etc.).
12. The **« Lit bébé » resource is not listed** with the supplements: as in the current popup, a « Lit(s) bébé souhaité(s) ? (gratuit, selon disponibilité) » stepper appears only when Bébés ≥ 1 (max = number of babies) and is sent as the devis `babyBeds` field — not as a resource line.
13. Selected resources are included in `/quote` and `/booking-requests` payloads (`resources: [{resourceId, quantity}]`) and their totals rendered in the summary (`resources[]`, `resourcesTotal`), including the « Offert » case.
14. Options with a `description` keep the ⓘ toggle behavior.

### Refusals must say why (amended 2026-09-23)
19. A refusal written under the calendar **outlives the re-render that follows it**. `renderCal()` resolves availability asynchronously and then writes its own « Sélectionnez votre date de départ » nudge; a caller that set an error first had it wiped one microtask later. The hint is therefore passed INTO `renderCal(hint)` and applied after the months are drawn. Applies to both refusals that clear a selection: `minNightsBreached` and a range containing a blocked night.
> **Sans test** — ordonnancement interne à `view.js`, que ce dépôt n'exécute pas ; vérifié §7 point 6 (le message survit à la re-construction du calendrier).
20. An error hint scrolls itself into view (`block: 'nearest'`). The calendar is two months tall on a phone: a date picked low in the grid can leave the message off-screen, which is the same as not writing it.
> **Sans test** — `scrollIntoView` dans un conteneur défilant, sans harnais ici ; vérifié à l'œil sur l'écran 1, le message reste sous le calendrier.

### What a stay gets for free (added 2026-09-23)
21. An hourly resource whose property offers part of it (`property_resource_prices.freeMinutes` — the nordic bath's hour) **says so on its own row**, above the scheduling note: « 1 h offerte par séjour ». The engine already billed that hour at 0 €; nothing in the funnel said it, so the visitor read « 30,00 € · par heure » and believed every hour was charged.
> **Sans test** — le rendu vit dans `view.js` ; la phrase qu'il affiche est produite et testée côté serveur (`server/src/tests/public-resource-free-allowance.unit.test.js`). Rendu vérifié §7 point 8.
22. The summary names the free share of a partly-offered line (« Bain nordique ×2 · 1 h offerte ») and writes **« Offert »**, not « 0,00 € », for a line that costs nothing.
> **Sans test** — même partage que la règle 21 : `offeredNote` est testé côté serveur, le rendu du récapitulatif est vérifié §7 point 8.
23. Both sentences are **written by the server** (`freeLabel` on the catalogue projection, `offeredNote` on the quote line) — raising the allowance in GuestFlow changes the website copy with no plugin release. The site never derives an allowance from `quantity − billedQuantity` itself.

### Changing your dates without starting over (added 2026-09-23)
24. Once an arrival is set, **every later date is a departure** — whether a departure was already chosen or not. The stay is lengthened or shortened in one click and the arrival never moves on its own. Clicking the **arrival itself** clears both dates and asks for an arrival again; a date **before** the arrival sets a new arrival. Before this, any click on a complete range restarted from the arrival, so extending a stay by one night meant rebuilding the whole selection with nothing on screen saying so.
> **Sans test** — logique de `onPick` dans `view.js`, qu'aucune suite de ce dépôt n'exécute ; vérifiée §7 points 9 et 12 (banc d'essai puis site réel).
25. Only past dates and **nights that are actually taken** are disabled. A date sitting before the arrival, and a date whose range would cross a taken night, stay clickable: the first sets a new arrival, the second sets one too and says why (`rangeBlocked`). Closing them made the calendar look dead from the first taken night onwards, with no visible way back.
> **Sans test** — rendu des cases dans `view.js` ; vérifié §7 point 9 (10 oct. et 22 oct. cliquables, une nuit prise ne l'est pas).
26. A min-nights refusal **keeps the chosen period on screen**: the hint carries the server's `minNights` message followed by « Cliquez une date plus tard pour allonger le séjour. », the summary repeats the server's message, and the submit stays disabled. Clearing the departure moved the page under the visitor 400 ms after their click — and the next click then had to rebuild what they had just chosen.
> **Sans test** — enchaînement devis → rendu dans `view.js` ; vérifié §7 points 9 et 12 (1 nuit sur un minimum de 2, période conservée, bouton refusé).
27. A **« ✕ Effacer » button sits beside the read-only date fields**, disabled while there is nothing to clear. It is the second way out of a selection — the first being a click on the arrival — and the one a visitor can see without guessing.
> **Sans test** — bouton rendu par `view.js` ; vérifié §7 points 9, 11 et 12 (désactivé à vide, vide les deux champs, lisible à 420 px).
28. The hint under the calendar **always says what the next click does**: « Sélectionnez votre date d'arrivée », « Sélectionnez votre date de départ », or « Cliquez une autre date pour changer le départ, ou l'arrivée pour recommencer. » once the range is complete.
> **Sans test** — chaîne d'affichage de `view.js` ; vérifiée §7 points 9 et 12.

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
| `utils/` | `publicProjections.js` | T | `toPublicResource`: add `priceUnitLabel`, `quantityLabel`, `showsSchedulingNote` (true for `per_hour` resources). **2026-09-23**: `freeLabel` on the catalogue, `billedQuantity` + `offeredNote` on the quote line, worded by `hoursLabel` / `resourceFreeLabel` / `resourceOfferedNote` / `offeredAgreement` (rules 21-23) |
| `utils/` | `pricing.js` | T | Hourly-scheduled resources: under `planningCardAsQuantity` with no sessions, bill the bare quantity as hours (rule 10) |
| `tests/` | `public-projections.unit.test.js` | T | Resource projection fields (labels + scheduling-note flag, 3 new cases) |
| `tests/` | `planning-card-public-pricing.unit.test.js` | T | Hourly-resource public pricing (4 new cases: quantity billed, qty 0, sessions precedence, admin unchanged) |
| `tests/` | `public-resource-free-allowance.unit.test.js` | C | **2026-09-23** — the wording of the free allowance and its agreement (9 cases) |
| routes/controllers | — | — | (none — `/resources`, `/quote`, `/booking-requests` already support resources) |

### 4.2 WordPress plugin (`integrations/wordpress/guestflow-booking/`)

| File | T/C | Responsibility |
|---|---|---|
| `includes/class-gf-rest-proxy.php` | T | New cached route `GET /properties/:id/resources` |
| `includes/class-gf-blocks.php` | T | New i18n strings (calendar hints, steppers, supplements, baby beds). **2026-09-23**: `toBeScheduled` shortened (rule 9) |
| `blocks/booking/view.js` | T | Embedded availability calendar (range select, ported from the mu-plugin), read-only date displays, time selects, steppers, unified option+resource rows, resources in quote/booking payloads, `babyBeds`. **2026-09-23**: `frDate` in figures (rule 3), `renderCal(hint)` (rules 19-20), free-allowance rendering (rules 21-22) |
| `assets/style.css` | T | Redesigned widget styles (calendar, steppers, rows, summary). **2026-09-23**: `.gf-line-free` (green, so an offer never reads as the amber warning of `.gf-line-note`) |
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
- **2026-09-23 — changing one's dates (rules 24-28)**, verified twice: in a local harness that loads the plugin's real `view.js`, `runtime.js` and `style.css` against a stubbed API (2-night minimum, nights 17-19 October taken), then against `domainesolio.com/la-granja/` with the engine, the drawer and the new i18n strings substituted locally.
  9. Harness: arrival → departure → a later date lengthens the stay, an earlier one shortens it, a date before the arrival becomes the new arrival, a click on the arrival clears both, the ✕ clears both, a taken night refuses, a range crossing one lands an arrival with its message. No console error.
  10. Harness: a 2-night pick on a 3-night minimum keeps `12/10/2026 → 14/10/2026` on screen with « Séjour trop court (minimum 3 nuits). Cliquez une date plus tard pour allonger le séjour. », the summary showing the same refusal and « Réserver » disabled; clicking the 16th prices 4 nights and enables it.
  11. Harness at 390 px and on the site at 420 px: no horizontal scroll, ✕ button 44 px tall, date fields whole.
  12. Live site (La Granja, 2-night minimum): 1 night refused with both dates still filled and the drawer's « Suivant » grey carrying the engine's sentence; extending to 4 nights enables it; ✕ empties the two fields and greys « Suivant » again.
  13. Live site: the selected period is **visible** — arrival and departure in ocre, nights in between tinted — and the refusal is red (see `specs/site-booking-drawer.md` rules 14-15).
- **2026-09-23 amendments — verified on the live site** (Playwright against `domainesolio.com/la-granja/`, the drawer/engine/API payloads substituted locally):
  6. A 1-night pick on a 2-night minimum leaves « Séjour trop court (minimum 2 nuits). » under the calendar **and** under the drawer's next button, instead of « Sélectionnez votre date de départ ».
  7. Date fields read `28/09/2026` / `03/10/2026`, whole, at 420 px.
  8. The nordic bath row carries « 1 h offerte par séjour »; the summary reads « Bain nordique ×2 · 1 h offerte — 30,00 € », and a fully offered line reads « Offert ».

## 8. Out of scope

- Any GuestFlow app UI change.
- Retiring the `gf-booking.php` mu-plugin file or its REST namespace (left inert).
- The standalone `guestflow/calendar` block and the availability search banner.
- OTA listings copy.

## 9. Open questions

1. ~~Bain nordique quantity unit~~ — **Resolved 2026-07-20**: `per_hour` → « Nombre d'heures », 30 € / heure (live data).
2. ~~Single-widget consolidation~~ — **Resolved 2026-07-20**: validated; the inline block becomes the only widget, the popup flow is removed from the pages.
