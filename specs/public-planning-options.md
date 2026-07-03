# Planning-card options in the public booking flow (« à planifier »)

| Field | Value |
|---|---|
| **Status** | Implemented _(2026-07-03)_ — engine quantity-billing + all public flows wired + `showsPlanningCard` exposed + admin « à planifier » notification + plugin (label/ⓘ description/hint) + tests (server 1989 green). Sandbox UI verification deferred to the next prod run. |
| **Branch** | `feature/public-planning-options` |
| **Created** | 2026-07-03 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |
| **Related** | [public-online-payment.md](public-online-payment.md) (UC2), [public-api.md](public-api.md) (`/public/v1`), [option-planning-card.md](option-planning-card.md) (the occurrence model), [site-booking-notifications.md](site-booking-notifications.md) (admin new-devis email) |

---

## 1. Context

Some options are **planning-card options** (`options.showsPlanningCard=1`) — a service booked for a
**time slot**, not a quantity: « Petit déjeuner » (8 €/pers), « Le repas des trappeurs » (25 €/pers),
etc. In the back office the operator schedules concrete **occurrences** (dates/times) via the option
planning card; the pricing engine bills `occurrences × (per-person ? persons : 1) × unitPrice`
([pricing.js:1138-1158](../server/src/utils/pricing.js#L1138)).

The **public site can't schedule slots**, so the plugin sends only a *quantity*. The engine's
planning-card branch requires `cardOccurrences` and returns **null** when there are none
([pricing.js:1140](../server/src/utils/pricing.js#L1140)) — so a planning-card option selected on the
site is **silently dropped**: not priced, not recorded, not charged. Found in the 2026-07-02 prod E2E
(the guest ticks « Petit déjeuner » but it never reaches the devis). These options are already visible
and selectable on the site (they are not in the plugin's `HIDDEN_AUTO` set).

## 2. Goal

A website guest can select a planning-card option (with a quantity), it is **priced and recorded on the
devis**, and the operator is **alerted to contact the guest to schedule the slots** — instead of the
option vanishing silently.

## 3. Functional rules

1. **Server prices them — never the client.** _(decision 2026-07-03: handled by the pricing engine.)_
   A new engine input flag **`planningCardAsQuantity`** makes the planning-card branch bill by the
   client's **quantity as the occurrence count**, reusing the existing occurrence formula:
   `billedUnits = quantity × (priceType.includes('per_person') ? persons : 1)`,
   `total = billedUnits × unitPrice`. So « Petit déjeuner » 8 €/pers, 2 adultes, quantity **2** → 4 ×
   8 = **32 €**. The `/nuit` part is **not** multiplied again — the *séance* IS the occurrence.
   _(decision 2026-07-03, option « quantité = nb de séances ».)_
2. **No occurrences are stored** for a publicly-selected planning-card option (`cardOccurrences` stays
   empty). The line is billed but **unscheduled** — the operator fixes the concrete slots later in the
   back office (the existing planning card), after contacting the guest.
3. **The flag is server-set, scoped to the public/site flow** — admin devis/reservations are
   **unchanged** (they keep using the real scheduled occurrences). Set by: the public live quote, the
   booking-request devis creation, and the public devis price recompute (so the quote, the stored
   `finalPrice`, and the online-payment amount all agree).
4. **The site displays them clearly — labels owned by the backend (source of truth).** _(decision
   2026-07-03: the price-basis + quantity labels are computed SERVER-SIDE and rendered as-is by the
   plugin, so adding an option needs NO website change.)_ `toPublicOption` returns `priceUnitLabel`
   (« par personne et par séance », « au séjour »…) and `quantityLabel` (« Nombre de séances » for a
   planning option, else null), derived from `priceType` + `showsPlanningCard`. The plugin has **no**
   hardcoded `priceType` string logic.
   - kept selectable with a **quantity** input (as today), the field labelled by `quantityLabel` when
     present (« Nombre de séances »), and the price shown with `priceUnitLabel`;
   - each option shows its **description** (from `options.description`) via an ergonomic, **responsive**
     affordance — an info (ⓘ) toggle: tooltip on hover (desktop) **and** tap-to-expand (mobile), never
     hover-only;
   - a « **À planifier avec l'hôte** » hint on planning-card options so the guest knows the exact
     time is arranged after booking.
5. **The operator is alerted.** The admin *new site devis* notification
   (`notificationService.notifyNewSiteDevis`) lists the planning-card options « à planifier » (title +
   quantity) so the operator knows to contact the guest and schedule. The devis/reservation also
   surfaces them as **unscheduled planning cards** (existing UI) — no new admin screen.
6. **Amount consistency.** Because the option is now in the stored `finalPrice`, the online full/deposit
   payment (`fullPaymentCents` / `depositPaymentCents` / VAT components) already charges it — no special
   handling; the anti-drift stored-amount rule keeps quote = charge.
7. **Offered / applicability unchanged.** Property-applicability and the offered-default rules apply as
   for any option; a planning-card option with quantity 0 produces no line (unchanged).

**Edge cases:**
- Quantity 0 / not selected → no line, no charge (unchanged).
- A planning-card option that is ALSO a property paid-default → priced by quantity like any default (the
  merge sets a quantity; rule 1 applies).
- Admin later schedules fewer/more occurrences than the billed quantity → the operator adjusts the line
  in the back office if needed (out of scope to auto-reconcile; the billed quantity is the guest's ask).
- Resources with `showsPlanningCard` are **not** selectable on the site (the block lists options only) →
  out of scope here.

---

## 4. Architecture

> **Fat backend, thin frontend.** All pricing lives in the engine; the site only renders the option
> list + description and sends the quantity. The flag is a server decision.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `utils/` | `pricing.js` | T | `calculateReservationQuote` accepts `planningCardAsQuantity`; when set, the `showsPlanningCard` branch bills `quantity × (perPerson ? persons : 1) × unitPrice` (occurrence-count semantics) instead of requiring `cardOccurrences`; `cardOccurrences` left empty. |
| `controllers/public/` | `publicQuoteController.js` | T | Pass `planningCardAsQuantity: true` to the engine (live quote). |
| `controllers/public/` | `publicBookingRequestController.js` | T | Ensure the created devis is priced with the flag (forward through `devisModel.create`). |
| `models/` | `devisModel.js` | T | `create`/recompute accept + forward `planningCardAsQuantity` (only the public path sets it) so the stored `finalPrice` includes the option. |
| `utils/` | `devisQuote.js` | T | `recomputeDevisQuote` (used for `collectedOnArrival` + components) sets the flag for a public devis so the pay amount matches the quote. |
| `utils/` | `publicProjections.js` | T | `toPublicOption` exposes `showsPlanningCard` + computes **`priceUnitLabel`** and **`quantityLabel`** (server-owned display strings from `priceType` + `showsPlanningCard`) so the site renders any option — new ones included — with no plugin change; `description` already exposed. |
| `utils/` | `notificationService.js` | T | `notifyNewSiteDevis` lists planning-card options « à planifier » (title + quantity). |

### 4.2 Client side (`client/src/`)

**None required** for the core flow — the admin already renders unscheduled planning cards. (Optional,
deferred: a small « à planifier » chip on the devis list; not in this spec.)

**Component reuse declaration (mandatory):** no client change — n/a.

**WordPress plugin** (`integrations/wordpress/guestflow-booking/`):

| File | T/C | Responsibility |
|---|---|---|
| `blocks/booking/view.js` | T | Renders each option generically from backend fields — `priceUnitLabel`, `quantityLabel`, `description` (ⓘ toggle, hover + tap, responsive), and the « À planifier avec l'hôte » hint when `showsPlanningCard`. **No hardcoded `priceType` logic** → a new option shows correctly without editing the plugin. |
| `assets/gf-booking.css` (or inline) | T | Styles for the ⓘ toggle / description popover (responsive, tap-friendly ≥44px). |
| `includes/class-gf-blocks.php` | T | New i18n strings (`toBeScheduled`, price-basis labels). |

⚠️ **Deploy reminder:** the plugin is NOT deployed by the `release` pipeline — copy the changed files
into the `wp_app` container (memory `wp-plugin-deploy-gap`).

### 4.3 API contract (`/public/v1`)

| Method | Endpoint | Change |
|---|---|---|
| GET | `/properties/:id/options` | Each option gains `showsPlanningCard: boolean`, `priceUnitLabel: string\|null`, `quantityLabel: string\|null` (description already present). |
| POST | `/quote` | A planning-card option in `options[]` is now priced (billedUnits per rule 1) and appears in `options[]` of the response instead of being dropped. |
| POST | `/booking-requests` | Same option is persisted on the devis (billed, unscheduled). |

No breaking change (additive field + previously-dropped lines now present).

---

## 5. Data model

No schema change. Planning-card options selected publicly are stored as normal `reservation_options`
lines with **empty `cardOccurrences`** (unscheduled) — the operator schedules them later. `finalPrice`
now includes them.

**Data impact:** none on existing rows.

## 6. UI / UX

- **Site (plugin) — option row:** unchanged quantity input; add next to the title an **ⓘ** button that
  reveals `description` (a small popover under the row). Desktop: also on hover. Mobile (`xs`): tap
  toggles the popover (hover is unavailable) — target ≥44×44 px. Price label reflects the basis
  (« 8,00 € / pers. / séance »). Under a selected planning option: caption « À planifier avec l'hôte —
  nous vous contacterons pour convenir de l'horaire. » Responsive: the popover is full-width on `xs`,
  inline under the row on `md+`.
- **Admin:** the new-site-devis notification email gains a line « À planifier : Petit déjeuner ×2, … ».
  The devis/reservation shows the options as unscheduled planning cards (existing UI). No new screen.
- **Copy (FR):** `toBeScheduled` = « À planifier avec l'hôte » ; notification « Options à planifier : %s ».

## 7. Test plan

### Server unit tests
- [x] `planning-card-public-pricing.unit.test.js` — with `planningCardAsQuantity`: per-person option billed `quantity × persons × unitPrice` (32 €) + `cardOccurrences=[]` + `toBeScheduled`; per-group (`per_stay`) billed `quantity × unitPrice`; quantity 0 → no line. **Regression (flag off):** a planning-card option with NO occurrences is still dropped, WITH occurrences prices by occurrence count (admin unchanged). 5 tests.
- [x] `public-projections.unit.test.js` — `toPublicOption` exposes `showsPlanningCard` + `priceUnitLabel` + `quantityLabel` (planning → « par personne et par séance » / « Nombre de séances » ; non-planning per_person_per_night → « par personne et par nuit » ; per_stay → « au séjour » ; progressive → « par participant »).
- [x] `notification-service.unit.test.js` — `notifyNewSiteDevis` lists the « à planifier » options (title × qty) and excludes non-planning options.
- [x] Full suite 1989 green (existing public-quote / booking-request / devisQuote paths exercised by the shared engine change).

### Manual UI verification
- [x] Server tests cover the pricing + notification; the plugin is a build-free view change (syntax-checked).
- [ ] Site sandbox: tick « Petit déjeuner » qty 2 (2 adults) → quote shows the line at 32 € + total; ⓘ shows the description (hover desktop / tap mobile); « À planifier » hint visible (next prod sandbox run).
- [ ] Booking-request → devis carries the option; admin notification lists it « à planifier » (next prod sandbox run).

## 8. Out of scope

- Self-scheduling the exact slot on the website (the operator arranges it — that's the point).
- Changing the back-office planning-card behavior (occurrence-based) for admin devis.
- Planning-card **resources** on the site (not selectable in the booking block).
- Auto-reconciling billed quantity vs later-scheduled occurrence count.

## 9. Open questions

- Q: Pricing basis for the client-entered quantity.
  - A (**Resolved 2026-07-03**): quantity = number of séances → `quantity × (perPerson ? persons : 1) ×
    unitPrice` (reuses the occurrence formula; `/nuit` not re-multiplied). Handled by the engine.
